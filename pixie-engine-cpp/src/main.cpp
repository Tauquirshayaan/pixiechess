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
#include "evaluate.h"
#include "zobrist.h"
#include "tt.h"
#include "nnue.h"
#include "audit_limbo.h"
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
        
        std::cout << "info string Received: " << line << std::endl;
        
        if (line == "uci") {
            // Acknowledge UCI protocol support
            std::cout << "id name PixieChess Grandmaster Engine v3.2.1" << std::endl;
            std::cout << "id author Shayaan" << std::endl;
            std::cout << "option name Threads type spin default 1 min 1 max 8" << std::endl;
            std::cout << "option name MultiPV type spin default 1 min 1 max 5" << std::endl;
            std::cout << "option name Hash type spin default 1024 min 1 max 8192" << std::endl;
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
        else if (line.find("setoption name Hash value ") == 0) {
            int mb = std::stoi(line.substr(26));
            if (mb < 1) mb = 1;
            if (mb > 8192) mb = 8192;
            TT::init(mb);
        }
#ifdef ENABLE_COUNTERFACTUAL
        else if (line.find("setoption name AnalysisMode value ") == 0) {
            analysis_mode = line.substr(34);
        }
        else if (line.find("setoption name CounterfactualTarget value ") == 0) {
            counterfactual_target = line.substr(42);
        }
#endif
        else if (line == "uciclearhash") {
            TT::clear();
        }
        else if (line == "ucinewgame") {
            // Clear hash tables and reset state for a new game
            Board* empty_board = new Board();
            global_board = *empty_board;
            delete empty_board;
            TT::clear(); // Force completely clear TT to grant full resources
            clear_heuristics();
        } 
        else if (line.find("position pfen ") == 0) {
            std::string remaining = line.substr(14);
            size_t moves_pos = remaining.find(" moves ");
            if (moves_pos != std::string::npos) {
                std::string pfen_str = remaining.substr(0, moves_pos);
                parse_pfen(pfen_str);
                
                std::string moves_str = remaining.substr(moves_pos + 7);
                std::stringstream ss(moves_str);
                std::string token;
                while (ss >> token) {
                    MoveList ml;
                    generate_pseudo_legal_moves(global_board, ml);
                    generate_pixie_moves(global_board, ml);
                    bool found = false;
                    for (int i = 0; i < ml.count; i++) {
                        if (format_move(ml.moves[i]) == token) {
                            global_board.do_move(ml.moves[i]);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        std::cout << "info string Warning: Move " << token << " not found!" << std::endl;
                    }
                }
            } else {
                parse_pfen(remaining);
            }
        } 
        else if (line == "eval" || line == "eval json") {
#ifdef ENABLE_EVAL_DASHBOARD
            bool is_json = (line == "eval json");
#ifdef ENABLE_JSON_EXPORT
            if (is_json && !true) is_json = false; // Just to use ENABLE_JSON_EXPORT if needed
#else
            is_json = false;
#endif
            EvaluationBreakdown bd = explain_evaluation(global_board);
            
            int non_pawn_material = 0;
            for (int color = 0; color < 2; color++) {
                for (int pt = KNIGHT; pt < KING; pt++) {
                    non_pawn_material += popcount(global_board.pieces[color][pt]) * PIECE_VALUES[pt];
                }
            }
            float gamePhase = (float)non_pawn_material / 8000.0f;
            if (gamePhase > 1.0f) gamePhase = 1.0f;
            if (gamePhase < 0.0f) gamePhase = 0.0f;
            
            std::string phaseStr = (gamePhase > 0.7f) ? "Opening" : ((gamePhase > 0.3f) ? "Middlegame" : "Endgame");

            auto render_bar = [](int score) {
                int abs_score = std::abs(score);
                int blocks = abs_score / 10;
                if (blocks > 25) blocks = 25;
                if (blocks == 0 && abs_score > 0) blocks = 1; // at least 1 block if not zero
                
                std::string bar = "";
                for (int i = 0; i < blocks; i++) {
                    bar += (score >= 0) ? "█" : "X";
                }
                return bar;
            };
            
            auto pad_num = [](int n) {
                std::string s = std::to_string(n);
                if (n >= 0) s = "+" + s;
                while (s.length() < 4) s = " " + s;
                return "[" + s + "]  ";
            };
            
            auto pad_str = [](std::string s) {
                while (s.length() < 16) s += " ";
                return s;
            };

            if (is_json) {
                std::cout << "{\n";
                std::cout << "  \"schemaVersion\": 2,\n";
                std::cout << "  \"fingerprint\": {\n";
                std::cout << "    \"material_imbalance\": " << bd.fingerprint.material_imbalance << ",\n";
                std::cout << "    \"open_files\": " << bd.fingerprint.open_files << ",\n";
                std::cout << "    \"semi_open_files\": " << bd.fingerprint.semi_open_files << ",\n";
                std::cout << "    \"pawn_islands\": " << bd.fingerprint.pawn_islands << ",\n";
                std::cout << "    \"passed_pawns\": " << bd.fingerprint.passed_pawns << ",\n";
                std::cout << "    \"king_exposure\": " << bd.fingerprint.king_exposure << ",\n";
                std::cout << "    \"doubled_pawns\": " << bd.fingerprint.doubled_pawns << ",\n";
                std::cout << "    \"isolated_pawns\": " << bd.fingerprint.isolated_pawns << ",\n";
                std::cout << "    \"connected_pawns\": " << bd.fingerprint.connected_pawns << ",\n";
                std::cout << "    \"center_occupancy\": " << bd.fingerprint.center_occupancy << ",\n";
                std::cout << "    \"knightmares_in_limbo\": " << bd.fingerprint.knightmares_in_limbo << ",\n";
                std::cout << "    \"alive_knightmare\": " << bd.fingerprint.alive_knightmare << ",\n";
                std::cout << "    \"alive_marauder\": " << bd.fingerprint.alive_marauder << ",\n";
                std::cout << "    \"alive_phaserook\": " << bd.fingerprint.alive_phaserook << ",\n";
                std::cout << "    \"alive_electroknight\": " << bd.fingerprint.alive_electroknight << ",\n";
                std::cout << "    \"alive_djinn\": " << bd.fingerprint.alive_djinn << ",\n";
                std::cout << "    \"alive_basilisk\": " << bd.fingerprint.alive_basilisk << "\n";
                std::cout << "  },\n";
                std::cout << "  \"phase\": " << gamePhase << ",\n";
                std::cout << "  \"material\": " << bd.material << ",\n";
                std::cout << "  \"mobility\": " << bd.mobility << ",\n";
                std::cout << "  \"center_control\": " << bd.center_control << ",\n";
                std::cout << "  \"development\": " << bd.development << ",\n";
                std::cout << "  \"threats\": " << bd.threats << ",\n";
                std::cout << "  \"king_safety\": " << bd.king_safety << ",\n";
                std::cout << "  \"power_potential\": " << bd.power_potential << ",\n";
                std::cout << "  \"total\": " << bd.total() << ",\n";
                std::cout << "  \"power_pieces\": {\n";
                std::cout << "    \"knightmare\": {\n";
                std::cout << "      \"state\": {\n";
                std::cout << "        \"count_in_limbo\": " << bd.km.state.count_in_limbo << ",\n";
                std::cout << "        \"count_on_board\": " << bd.km.state.count_on_board << ",\n";
                std::cout << "        \"legal_drop_count\": " << bd.km.state.legal_drop_count << ",\n";
                std::cout << "        \"safe_drops\": " << bd.km.state.safe_drops << ",\n";
                std::cout << "        \"checking_drop_count\": " << bd.km.state.checking_drop_count << ",\n";
                std::cout << "        \"capture_drop_count\": " << bd.km.state.capture_drop_count << ",\n";
                std::cout << "        \"attacking_king\": " << (bd.km.state.attacking_king ? "true" : "false") << ",\n";
                std::cout << "        \"trapped\": " << (bd.km.state.trapped ? "true" : "false") << "\n";
                std::cout << "      },\n";
                std::cout << "      \"material\": " << bd.km.material << ",\n";
                std::cout << "      \"limbo_persistence\": " << bd.km.limbo_persistence << ",\n";
                std::cout << "      \"ambush_platform\": " << bd.km.ambush_platform << ",\n";
                std::cout << "      \"deployment_readiness\": " << bd.km.deployment_readiness << ",\n";
                std::cout << "      \"behind_king_pressure\": " << bd.km.behind_king_pressure << ",\n";
                std::cout << "      \"trapped_penalty\": " << bd.km.trapped_penalty << ",\n";
                std::cout << "      \"outpost\": " << bd.km.outpost << ",\n";
                std::cout << "      \"total\": " << bd.km.total() << "\n";
                std::cout << "    },\n";
                std::cout << "    \"marauder\": " << bd.marauder_score << ",\n";
                std::cout << "    \"phaserook\": " << bd.phaserook_score << ",\n";
                std::cout << "    \"electroknight\": " << bd.electroknight_score << ",\n";
                std::cout << "    \"djinn\": " << bd.djinn_score << "\n";
                std::cout << "  },\n";
                std::cout << "  \"flags\": {\n";
                std::cout << "    \"supported_center_pawn\": " << (bd.supported_center_pawn ? "true" : "false") << ",\n";
                std::cout << "    \"limbo_active\": " << (bd.limbo_active ? "true" : "false") << ",\n";
                std::cout << "    \"electro_charge_ready\": " << (bd.electro_charge_ready ? "true" : "false") << ",\n";
                std::cout << "    \"passed_pawn_bonus\": " << (bd.passed_pawn_bonus ? "true" : "false") << ",\n";
                std::cout << "    \"king_under_attack\": " << (bd.king_under_attack ? "true" : "false") << "\n";
                std::cout << "  }\n";
                std::cout << "}\n";
            } else {
                std::cout << "info string --------------------------------------" << std::endl;
                std::cout << "info string     EVALUATION INFLUENCE DASHBOARD    " << std::endl;
                std::cout << "info string --------------------------------------" << std::endl;
                std::cout << "info string Phase: " << phaseStr << " (Phase = " << gamePhase << ")" << std::endl;
                std::cout << "info string " << std::endl;
                
                std::cout << "info string " << pad_str("Material")        << pad_num(bd.material)        << render_bar(bd.material) << std::endl;
                std::cout << "info string " << pad_str("Development")     << pad_num(bd.development)     << render_bar(bd.development) << std::endl;
                std::cout << "info string " << pad_str("Center Control")  << pad_num(bd.center_control)  << render_bar(bd.center_control) << std::endl;
                std::cout << "info string " << pad_str("Threats")         << pad_num(bd.threats)         << render_bar(bd.threats) << std::endl;
                std::cout << "info string " << pad_str("Mobility")        << pad_num(bd.mobility)        << render_bar(bd.mobility) << std::endl;
                std::cout << "info string " << pad_str("King Safety")     << pad_num(bd.king_safety)     << render_bar(bd.king_safety) << std::endl;
                std::cout << "info string " << pad_str("Power Potential") << pad_num(bd.power_potential) << render_bar(bd.power_potential) << std::endl;
                std::cout << "info string --------------------------------------" << std::endl;
                std::cout << "info string Power Piece Breakdown" << std::endl;
                std::cout << "info string Knightmare" << std::endl;
                std::cout << "info string " << std::endl;
                std::cout << "info string State" << std::endl;
                std::cout << "info string --------------------------" << std::endl;
                std::cout << "info string " << pad_str("Count in Limbo") << pad_num(bd.km.state.count_in_limbo) << std::endl;
                std::cout << "info string " << pad_str("Count on Board") << pad_num(bd.km.state.count_on_board) << std::endl;
                std::cout << "info string " << pad_str("Legal Drops") << pad_num(bd.km.state.legal_drop_count) << std::endl;
                std::cout << "info string " << pad_str("Safe Drops") << pad_num(bd.km.state.safe_drops) << std::endl;
                std::cout << "info string " << pad_str("Checking Drops") << pad_num(bd.km.state.checking_drop_count) << std::endl;
                std::cout << "info string " << pad_str("Capture Drops") << pad_num(bd.km.state.capture_drop_count) << std::endl;
                std::cout << "info string " << pad_str("Attacking King") << (bd.km.state.attacking_king ? "Yes" : "No") << std::endl;
                std::cout << "info string " << pad_str("Trapped") << (bd.km.state.trapped ? "Yes" : "No") << std::endl;
                std::cout << "info string " << std::endl;
                std::cout << "info string Evaluation" << std::endl;
                std::cout << "info string --------------------------" << std::endl;
                std::cout << "info string " << pad_str("  Material") << pad_num(bd.km.material) << std::endl;
                std::cout << "info string " << pad_str("  Limbo Persist") << pad_num(bd.km.limbo_persistence) << std::endl;
                std::cout << "info string " << pad_str("  Ambush Plat") << pad_num(bd.km.ambush_platform) << std::endl;
                std::cout << "info string " << pad_str("  Deploy Ready") << pad_num(bd.km.deployment_readiness) << std::endl;
                std::cout << "info string " << pad_str("  Behind King") << pad_num(bd.km.behind_king_pressure) << std::endl;
                std::cout << "info string " << pad_str("  Trapped Pen") << pad_num(bd.km.trapped_penalty) << std::endl;
                std::cout << "info string " << pad_str("  Outpost") << pad_num(bd.km.outpost) << std::endl;
                std::cout << "info string " << pad_str("  TOTAL") << pad_num(bd.km.total()) << std::endl;
                std::cout << "info string " << pad_str("Marauder") << pad_num(bd.marauder_score) << std::endl;
                std::cout << "info string " << pad_str("Phaserook") << pad_num(bd.phaserook_score) << std::endl;
                std::cout << "info string --------------------------------------" << std::endl;
                
                int total_static = bd.total() * (global_board.side_to_move == WHITE ? 1 : -1);
                int engine_eval = evaluate(global_board);
                
                std::cout << "info string Total Static Eval: " << total_static << " cp" << std::endl;
                std::cout << "info string " << std::endl;
                std::cout << "info string Consistency Check:" << std::endl;
                std::cout << "info string Buckets Sum = " << total_static << std::endl;
                std::cout << "info string Engine Eval = " << engine_eval << std::endl;
                std::cout << "info string Status = " << (total_static == engine_eval ? "PASS" : "FAIL") << std::endl;
                std::cout << "info string --------------------------------------" << std::endl;
            }
#else
            std::cout << "info string Evaluation Dashboard is disabled in this build." << std::endl;
#endif
        } 
        else if (line.find("audit_limbo_transition") != std::string::npos) {
            std::cout << "info string MATCHED audit_limbo_transition in main.cpp" << std::endl;
            audit_limbo_transition(global_board);
        }
        else if (line.find("go") == 0) {
            // Trigger the search tree!
            int target_depth = 40; // Default fallback for max depth
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
    
    // Initialize LMR reduction table
    init_lmr_table();
    
    // Allocate a 1024MB Transposition Table by default
    TT::init(1024);
    
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
            pixie_pool[PAWN]   = {GOLDEN_PAWN, IRONPAWN, EPEE_PAWN, PAWN_KNIFE, HERO_PAWN, SHRIKE, WARP_JUMPER, WAR_AUTOMATON};
            pixie_pool[KNIGHT] = {ELECTROKNIGHT, BANKER, CAMEL, KNIGHTMARE, ANTI_VIOLENCE, FISH_KNIGHT};
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
                
                // Collect all standard pieces for this color
                struct Target { int sq; int pt; };
                std::vector<Target> targets;
                
                for (int sq = 0; sq < 64; sq++) {
                    for (int pt = 0; pt < 5; pt++) { // 0 to 4 (Pawn to Queen)
                        if (get_bit(global_board.pieces[c][pt], sq)) {
                            targets.push_back({sq, pt});
                        }
                    }
                }
                
                // Shuffle targets to ensure a true random mix of pawns and pieces (no positional bias)
                std::shuffle(targets.begin(), targets.end(), rng);
                
                // Randomly choose how many pieces to convert (up to 6 minus any already spawned from synergy)
                std::uniform_int_distribution<int> count_dist(1, 6);
                int target_count = count_dist(rng);
                int available_slots = 6 - power_piece_count[c];
                int pieces_to_convert = std::min(target_count, available_slots);
                
                int converted = 0;
                for (size_t i = 0; i < targets.size() && converted < pieces_to_convert; i++) {
                    Target t = targets[i];
                    // Remove standard piece
                    clear_bit(global_board.pieces[c][t.pt], t.sq);
                    
                    // Add random Pixie of the SAME TYPE
                    std::uniform_int_distribution<int> specific_dist(0, pixie_pool[t.pt].size() - 1);
                    int random_pixie = pixie_pool[t.pt][specific_dist(rng)];
                    set_bit(global_board.pieces[c][random_pixie], t.sq);
                    
                    converted++;
                    power_piece_count[c]++;
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
