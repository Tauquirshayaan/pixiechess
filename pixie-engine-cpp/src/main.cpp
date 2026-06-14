#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include "board.h"
#include "movegen.h"
#include "bitboard.h"
#include "rays.h"
#include "pixiegen.h"
#include "search.h"
#include "zobrist.h"
#include "tt.h"
#include "nnue.h"
#include <thread>
#include <chrono>
#include <fstream>
#include <random>
void print_bitboard(U64 bb, const std::string& name) {
    std::cout << "--- " << name << " ---\n";
    for (int r = 7; r >= 0; r--) {
        for (int c = 0; c < 8; c++) {
            int sq = r * 8 + c;
            std::cout << (get_bit(bb, sq) ? "X " : ". ");
        }
        std::cout << "\n";
    }
    std::cout << "-------------------\n\n";
}

int current_search_id = 0;

// Global Board state
Board global_board;

// Serialize Board state to Pixie-FEN string
std::string board_to_pfen(const Board& b) {
    std::string pfen = "";
    for (int sq = 0; sq < 64; sq++) {
        int piece_val = -1;
        // Check all piece types for both colors
        for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
            if (get_bit(b.pieces[WHITE][pt], sq)) {
                piece_val = pt;
                break;
            }
            if (get_bit(b.pieces[BLACK][pt], sq)) {
                piece_val = pt + 100;
                break;
            }
        }
        pfen += std::to_string(piece_val);
        if (sq < 63) pfen += ",";
    }
    pfen += (b.side_to_move == WHITE) ? " w" : " b";
    pfen += " " + std::to_string(b.castling_rights);
    pfen += " " + std::to_string(b.en_passant_sq);
    pfen += " -"; // Dead pieces placeholder for now
    return pfen;
}

// Custom 'Pixie-FEN' Parser
void parse_pfen(const std::string& pfen) {
    global_board.init_from_pfen(pfen);
}

int engine_threads = 1;
int multi_pv = 1;

// ── BASIC UCI LOOP (Phase 1) ──
// This handles standard text-based communication with the Node.js server.
void uciLoop() {
    std::string line;
    
    // Default board position (PFEN format)
    parse_pfen("3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,103,101,102,104,105,102,101,103 w");
    
    // Listen for commands from the Node.js process via standard input
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        
        if (line == "uci") {
            // Acknowledge UCI protocol support
            std::cout << "id name PixieChess Grandmaster Engine v3.2.1" << std::endl;
            std::cout << "id author Shayaan" << std::endl;
            std::cout << "option name Threads type spin default 1 min 1 max 8" << std::endl;
            std::cout << "option name MultiPV type spin default 1 min 1 max 5" << std::endl;
            std::cout << "uciok" << std::endl;
        } 
        else if (line == "isready") {
            // Signal to Node.js that engine is booted and ready
            std::cout << "readyok" << std::endl;
        } 
        else if (line.find("setoption name Threads value ") == 0) {
            engine_threads = std::stoi(line.substr(29));
            if (engine_threads < 1) engine_threads = 1;
            if (engine_threads > 8) engine_threads = 8;
        }
        else if (line.find("setoption name MultiPV value ") == 0) {
            multi_pv = std::stoi(line.substr(29));
            if (multi_pv < 1) multi_pv = 1;
        }
        else if (line == "ucinewgame") {
            // Clear hash tables and reset state for a new game
            Board* empty_board = new Board();
            global_board = *empty_board;
            delete empty_board;
            TT::clear();
        } 
        else if (line.find("position pfen ") == 0) {
            // Parse custom Pixie FEN string
            parse_pfen(line.substr(14));
        } 
        else if (line.find("go") == 0) {
            // Trigger the search tree!
            int target_depth = 5; // Default fallback
            int movetime = 0;
            
            // Parse 'go depth X'
            size_t depth_pos = line.find("depth ");
            if (depth_pos != std::string::npos) {
                target_depth = std::stoi(line.substr(depth_pos + 6));
            }
            
            // Parse 'movetime X'
            size_t time_pos = line.find("movetime ");
            if (time_pos != std::string::npos) {
                movetime = std::stoi(line.substr(time_pos + 9));
            }
            
            // Reset stop flag BEFORE search
            search_stop_flag.store(false);
            current_search_id++;
            int my_search_id = current_search_id;
            
            // Time management thread
            if (movetime > 0) {
                std::thread timer_thread([movetime, my_search_id]() {
                    std::this_thread::sleep_for(std::chrono::milliseconds(movetime));
                    if (current_search_id == my_search_id) {
                        search_stop_flag.store(true);
                    }
                });
                timer_thread.detach();
            }
            
            // Parse 'searchmoves e2e4 d2d4'
            std::vector<uint32_t> include_moves;
            size_t sm_pos = line.find("searchmoves ");
            if (sm_pos != std::string::npos) {
                std::string sm_str = line.substr(sm_pos + 12);
                std::stringstream ss(sm_str);
                std::string token;
                while (ss >> token) {
                    if (token.length() >= 4) {
                        int from_file = token[0] - 'a';
                        int from_rank = token[1] - '1';
                        int to_file = token[2] - 'a';
                        int to_rank = token[3] - '1';
                        int from = from_rank * 8 + from_file;
                        int to = to_rank * 8 + to_file;
                        include_moves.push_back((uint32_t)from | ((uint32_t)to << 6));
                    }
                }
            }
            
            std::vector<std::pair<Move, int>> best_moves = search_best_move(global_board, target_depth, engine_threads, multi_pv, include_moves);
            
            // Reset stop flag for safety
            search_stop_flag.store(false);
            
            std::string main_best_move_str = "";
            
            for (size_t i = 0; i < best_moves.size(); i++) {
                Move best = best_moves[i].first;
                int score = best_moves[i].second;
                
                int from = best.from();
                int to = best.to();
                std::string move_str = "";
                move_str += (char)('a' + (from % 8));
                move_str += (char)('1' + (from / 8));
                move_str += (char)('a' + (to % 8));
                move_str += (char)('1' + (to / 8));
                
                if (best.piece() == KNIGHTMARE && best.from() == 63 && best.to() == 63 && best.is_ability() && best.captured() != PIECE_TYPE_NONE) {
                    move_str = "h8h8-limbo" + std::to_string(best.promoted()) + "dir" + std::to_string(best.captured());
                } else if (best.piece() == KNIGHTMARE && best.from() == best.to()) {
                    if (best.is_ability()) {
                        move_str += "-jump" + std::to_string(best.promoted());
                    } else {
                        move_str += "-drop" + std::to_string(best.promoted());
                    }
                } else if (best.promoted() != PIECE_TYPE_NONE && !best.is_ability()) {
                    // Only real pawn promotions get a promotion character
                    int p = best.promoted();
                    if (p == QUEEN) move_str += 'q';
                    else if (p == ROOK) move_str += 'r';
                    else if (p == BISHOP) move_str += 'b';
                    else if (p == KNIGHT) move_str += 'n';
                    // Custom pixie promotions already handled by piece type
                }
                
                // Print out the alternative line for the frontend is now handled in search.cpp
                
                if (i == 0) main_best_move_str = move_str;
            }
            if (!main_best_move_str.empty()) {
                std::cout << "bestmove " << main_best_move_str << std::endl;
            } else {
                std::cout << "bestmove (none)" << std::endl;
            }
        } 
        else if (line == "quit") {
            // Kill the C++ process
            break;
        }
    }
}

int main(int argc, char* argv[]) {
    // Disable I/O buffering so Node.js receives text instantly
    std::setvbuf(stdin, NULL, _IONBF, 0);
    std::setvbuf(stdout, NULL, _IONBF, 0);
    
    // Initialize bitboard attack masks
    init_leaper_masks();
    init_ray_masks();
    
    // Initialize Zobrist hashing for TT
    Zobrist::init();
    
    // Allocate a 256MB Transposition Table
    TT::init(256);
    
    // Try to load NNUE weights
    if (NNUE::load("pixiechess.nnue")) {
        std::cout << "info string NNUE evaluation loaded successfully." << std::endl;
    } else {
        std::cout << "info string NNUE missing, falling back to Classical evaluation." << std::endl;
    }
    
    // Check for datagen flag
    if (argc > 1 && std::string(argv[1]) == "--datagen") {
        std::cout << "Starting self-play data generation..." << std::endl;
        
        int games_to_play = 10;
        if (argc > 2) games_to_play = std::stoi(argv[2]);
        
        std::ofstream outfile("training_data.jsonl", std::ios::app);
        std::mt19937 rng(std::random_device{}());
        
        for (int i = 0; i < games_to_play; i++) {
            TT::clear();
            std::cout << "Datagen Game " << (i+1) << " initialized..." << std::endl;
            
            // Setup standard board
            parse_pfen("3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,103,101,102,104,105,102,101,103 w");
            
            // PIXIE RANDOMIZER & COMBINATION INJECTION
            std::uniform_int_distribution<int> chance_dist(1, 100);
            
            // Map standard pieces to their Pixie equivalents
            std::vector<int> pixie_pool[5];
            pixie_pool[PAWN]   = {GOLDEN_PAWN, IRONPAWN, BLUEPRINT, EPEE_PAWN, PAWN_KNIFE, HERO_PAWN, SHRIKE, WARP_JUMPER, WAR_AUTOMATON};
            pixie_pool[KNIGHT] = {ELECTROKNIGHT, BANKER, CAMEL, KNIGHTMARE, ANTI_VIOLENCE, PINATA, FISH_KNIGHT};
            pixie_pool[BISHOP] = {ARISTOCRAT, BASILISK, BLADERUNNER, BOUNCER, PILGRIM, DANCER, DJINN, GUNSLINGER, CARDINAL, ICICLE, HORDE_MOTHER, MARAUDER};
            pixie_pool[ROOK]   = {PHASE_ROOK, SUMOROOK};
            pixie_pool[QUEEN]  = {FISSION_REACTOR};
            
            int power_piece_count[2] = {0, 0};
            
            // 25% chance to inject specific Deadly Combinations for training
            int synergy_roll = chance_dist(rng);
            if (synergy_roll <= 25) {
                std::uniform_int_distribution<int> syn_dist(1, 5);
                int syn_type = syn_dist(rng);
                
                if (global_board.pieces[BLACK][KING]) {
                    int ksq = get_lsb(global_board.pieces[BLACK][KING]);
                    int kr = ksq / 8, kc = ksq % 8;
                    
                    if (syn_type == 1) {
                        // Synergy 1: Fission Reactor near Enemy King
                        int spawn_r = (kr >= 2) ? kr - 2 : kr + 2;
                        int spawn_c = (kc >= 2) ? kc - 2 : kc + 2;
                        int spawn_sq = spawn_r * 8 + spawn_c;
                        if (!get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq)) {
                            set_bit(global_board.pieces[WHITE][FISSION_REACTOR], spawn_sq);
                            power_piece_count[WHITE]++;
                        }
                    } else if (syn_type == 2) {
                        // Synergy 2: Horde Swarm (Center board)
                        int spawn_sq = 27; // d4
                        if (!get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq) &&
                            !get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq + 1) &&
                            !get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq - 1)) {
                            set_bit(global_board.pieces[WHITE][HORDE_MOTHER], spawn_sq);
                            set_bit(global_board.pieces[WHITE][HORDELING], spawn_sq + 1);
                            set_bit(global_board.pieces[WHITE][HORDELING], spawn_sq - 1);
                            power_piece_count[WHITE] += 3;
                        }
                    } else if (syn_type == 3) {
                        // Synergy 3: Hero Pawn close to promotion/check
                        int spawn_r = (kr == 0) ? 1 : kr - 1; 
                        int spawn_sq = spawn_r * 8 + kc;
                        if (spawn_sq >= 0 && spawn_sq < 64 && !get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq)) {
                            set_bit(global_board.pieces[WHITE][HERO_PAWN], spawn_sq);
                            power_piece_count[WHITE]++;
                        }
                    } else if (syn_type == 4) {
                        // Synergy 4: Bladerunner diagonal threat
                        int spawn_sq = 18; // c3
                        if (!get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq)) {
                            set_bit(global_board.pieces[WHITE][BLADERUNNER], spawn_sq);
                            power_piece_count[WHITE]++;
                        }
                    } else if (syn_type == 5) {
                        // Synergy 5: Pilgrim
                        int spawn_sq = 12; // e2
                        if (!get_bit(global_board.occupancies[WHITE] | global_board.occupancies[BLACK], spawn_sq)) {
                            set_bit(global_board.pieces[WHITE][PILGRIM], spawn_sq);
                            power_piece_count[WHITE]++;
                        }
                    }
                }
            }

            for (int color = 0; color < 2; color++) {
                Color c = (Color)color;
                for (int sq = 0; sq < 64; sq++) {
                    for (int pt = 0; pt < 5; pt++) { // 0 to 4 (Pawn to Queen)
                        if (get_bit(global_board.pieces[c][pt], sq)) {
                            // strictly max 6 power pieces
                            if (chance_dist(rng) <= 15 && power_piece_count[c] < 6) {
                                // Remove standard piece
                                clear_bit(global_board.pieces[c][pt], sq);
                                // Add random Pixie of the SAME TYPE
                                std::uniform_int_distribution<int> specific_dist(0, pixie_pool[pt].size() - 1);
                                int random_pixie = pixie_pool[pt][specific_dist(rng)];
                                set_bit(global_board.pieces[c][random_pixie], sq);
                                power_piece_count[c]++;
                            }
                        }
                    }
                }
            }
            global_board.update_occupancies();

            
            std::cout << "Datagen Game " << (i+1) << " initialized..." << std::endl;
            
            std::vector<std::string> game_pfens;
            std::vector<int> game_scores;
            
            int ply = 0;
            while (ply < 200) {
                MoveList ml;
                generate_pseudo_legal_moves(global_board, ml);
                generate_pixie_moves(global_board, ml);
                
                std::vector<Move> legal_moves;
                for (int m_idx = 0; m_idx < ml.count; m_idx++) {
                    Move m = ml.moves[m_idx];
                    global_board.do_move(m);
                    if (!global_board.in_check((Color)(global_board.side_to_move ^ 1))) {
                        legal_moves.push_back(m);
                    }
                    global_board.undo_move(m);
                }
                
                if (legal_moves.empty()) break;
                
                Move chosen_move(0,0,0,0,0,0,0);
                int chosen_score = 0;
                
                if (ply < 4) {
                    std::uniform_int_distribution<int> dist(0, legal_moves.size() - 1);
                    chosen_move = legal_moves[dist(rng)];
                } else {
                    search_stop_flag.store(false);
                    std::vector<std::pair<Move, int>> best_moves = search_best_move(global_board, 4, 1, 1, {});
                    if (best_moves.empty()) break;
                    chosen_move = best_moves[0].first;
                    chosen_score = best_moves[0].second;
                }
                
                if (ply >= 4) {
                    game_pfens.push_back(board_to_pfen(global_board));
                    // NNUE expects score from White's perspective
                    int white_score = (global_board.side_to_move == WHITE) ? chosen_score : -chosen_score;
                    game_scores.push_back(white_score);
                }
                
                global_board.do_move(chosen_move);
                ply++;
            }
            
            for (size_t j = 0; j < game_pfens.size(); j++) {
                outfile << "{\"fen\": \"" << game_pfens[j] << "\", \"score\": " << game_scores[j] << "}\n";
            }
        }
        
        std::cout << "Datagen complete." << std::endl;
        return 0;
    }
    
    // Start listening for commands
    uciLoop();
    
    return 0;
}
