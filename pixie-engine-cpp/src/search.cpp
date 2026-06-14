#include "search.h"
#include "tt.h"
#include <algorithm>
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include "zobrist.h"
#include <iostream>

std::atomic<bool> search_stop_flag(false);
extern int current_search_id;

std::string format_move(Move m) {
    if (m.data == 0) return "(none)";
    int from = m.from();
    int to = m.to();
    std::string s = "";
    s += (char)('a' + (from % 8));
    s += (char)('1' + (from / 8));
    s += (char)('a' + (to % 8));
    s += (char)('1' + (to / 8));
    
    if (m.piece() == KNIGHTMARE && from == 63 && to == 63 && m.is_ability() && m.captured() != PIECE_TYPE_NONE) {
        return "h8h8-limbo" + std::to_string(m.promoted()) + "dir" + std::to_string(m.captured());
    } else if (m.piece() == KNIGHTMARE && from == to) {
        if (m.is_ability()) {
            s += "-jump" + std::to_string(m.promoted());
        } else {
            s += "-drop" + std::to_string(m.promoted());
        }
    } else if (m.promoted() != PIECE_TYPE_NONE && !m.is_ability()) {
        // Only real pawn promotions — ability moves reuse promoted field for index data
        int p = m.promoted();
        if (p == QUEEN) s += 'q';
        else if (p == ROOK) s += 'r';
        else if (p == BISHOP) s += 'b';
        else if (p == KNIGHT) s += 'n';
        // Other piece types are custom pixie promotions, no UCI char
    }
    return s;
}

// End of format_move

struct ThreadData {
    Move killer_moves[100][2];
    int history_table[2][64][64];
    
    ThreadData() {
        for (int i = 0; i < 100; i++) {
            killer_moves[i][0] = Move(0,0,0,0,0,0,0);
            killer_moves[i][1] = Move(0,0,0,0,0,0,0);
        }
        for (int c = 0; c < 2; c++) {
            for (int f = 0; f < 64; f++) {
                for (int t = 0; t < 64; t++) {
                    history_table[c][f][t] = 0;
                }
            }
        }
    }
};

// --- MOVE ORDERING ---
void score_moves(MoveList& ml, Move tt_move, ThreadData* td, int ply, Color us) {
    for (int i = 0; i < ml.count; i++) {
        Move m = ml.moves[i];
        if (m.data == tt_move.data && tt_move.data != 0) {
            ml.scores[i] = 100000; // TT move is always first
        } else if (m.is_capture()) {
            int attacker = m.piece();
            int victim = m.captured();
            if (victim != PIECE_TYPE_NONE) {
                // MVV-LVA: Most Valuable Victim, Least Valuable Attacker
                ml.scores[i] = 10000 + (PIECE_VALUES[victim] * 10) - PIECE_VALUES[attacker];
            } else {
                ml.scores[i] = 10000;
            }
        } else {
            if (td && ply < 100) {
                if (m.data == td->killer_moves[ply][0].data) {
                    ml.scores[i] = 9000;
                } else if (m.data == td->killer_moves[ply][1].data) {
                    ml.scores[i] = 8000;
                } else {
                    ml.scores[i] = td->history_table[us][m.from()][m.to()];
                }
            } else {
                ml.scores[i] = 0; // Quiet moves
            }
        }
    }
}

void pick_next_move(MoveList& ml, int start_index) {
    int best_score = -1;
    int best_index = start_index;
    for (int i = start_index; i < ml.count; i++) {
        if (ml.scores[i] > best_score) {
            best_score = ml.scores[i];
            best_index = i;
        }
    }
    // Swap the best move to the start index
    Move temp_move = ml.moves[start_index];
    ml.moves[start_index] = ml.moves[best_index];
    ml.moves[best_index] = temp_move;
    
    int temp_score = ml.scores[start_index];
    ml.scores[start_index] = ml.scores[best_index];
    ml.scores[best_index] = temp_score;
}

// --- QUIESCENCE SEARCH ---
int quiescence(Board& b, int alpha, int beta, int qs_depth = 0) {
    if (search_stop_flag.load(std::memory_order_relaxed)) return 0;
    
    int stand_pat = evaluate(b);
    
    if (qs_depth >= 10) return stand_pat;
    
    if (stand_pat >= beta) return beta;
    if (alpha < stand_pat) alpha = stand_pat;
    
    MoveList ml;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    
    score_moves(ml, Move(0,0,0,0,0,0,0), nullptr, 0, b.side_to_move);
    
    for (int i = 0; i < ml.count; i++) {
        pick_next_move(ml, i);
        Move m = ml.moves[i];
        if (!m.is_capture()) continue; // Only search captures
        
        Color us = b.side_to_move; // side that is making the move
        b.do_move(m);
        if (b.in_check(us)) {
            b.undo_move(m);
            continue; // Illegal move
        }
        
        int score = -quiescence(b, -beta, -alpha, qs_depth + 1);
        b.undo_move(m);
        
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    
    return alpha;
}

// --- ALPHA-BETA MINIMAX WITH TT ---
int alpha_beta(Board& b, int depth, int alpha, int beta, int ply, ThreadData* td) {
    if (search_stop_flag.load(std::memory_order_relaxed)) return 0;

    int tt_score;
    Move tt_move = Move(0,0,0,0,0,0,0);
    if (TT::probe(b.hash, depth, alpha, beta, tt_score, tt_move)) {
        return tt_score;
    }

    if (depth <= 0) {
        int q = quiescence(b, alpha, beta, 0);
        TT::store(b.hash, 0, q, TT_EXACT, Move(0,0,0,0,0,0,0));
        return q;
    }
    
    bool in_check_before_move = b.in_check(b.side_to_move);
    
    // --- CHECK EXTENSION ---
    // Search deeper when in check to avoid horizon effect on forced sequences.
    // Cap at ply < 20 to prevent infinite recursion in perpetual check positions.
    if (in_check_before_move && ply < 20) {
        depth++;
    }
    
    // --- NULL MOVE PRUNING (NMP) ---
    // If not in check, not in endgame (has pieces other than pawn/king), and depth >= 3
    if (!in_check_before_move && depth >= 3) {
        U64 non_pawns = b.occupancies[b.side_to_move] & ~b.pieces[b.side_to_move][PAWN] & ~b.pieces[b.side_to_move][KING] & ~b.pieces[b.side_to_move][ROCKETMAN];
        if (non_pawns) {
            int ep_save = b.en_passant_sq;
            U64 hash_save = b.hash;
            
            b.side_to_move = b.side_to_move == WHITE ? BLACK : WHITE;
            b.en_passant_sq = NO_SQ;
            b.hash ^= Zobrist::side_key;
            
            int null_score = -alpha_beta(b, depth - 1 - 2, -beta, -beta + 1, ply + 1, td);
            
            b.side_to_move = b.side_to_move == WHITE ? BLACK : WHITE;
            b.en_passant_sq = ep_save;
            b.hash = hash_save;
            
            if (null_score >= beta) return beta;
        }
    }
    
    MoveList ml;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    
    score_moves(ml, tt_move, td, ply, b.side_to_move);
    
    int original_alpha = alpha;
    Move best_move = ml.count > 0 ? ml.moves[0] : Move(0,0,0,0,0,0,0);
    int best_score = -INF;
    bool has_legal_moves = false;
    int moves_evaluated = 0;
    
    for (int i = 0; i < ml.count; i++) {
        pick_next_move(ml, i);
        Move m = ml.moves[i];
        
        Color us = b.side_to_move; // side that is making the move
        b.do_move(m);
        if (b.in_check(us)) {
            b.undo_move(m);
            continue; // Illegal move
        }
        
        has_legal_moves = true;
        
        int score;
        if (moves_evaluated == 0) {
            // PVS full window
            score = -alpha_beta(b, depth - 1, -beta, -alpha, ply + 1, td);
        } else {
            // LMR and Zero-Window
            if (depth >= 3 && moves_evaluated >= 4 && !m.is_capture() && !in_check_before_move) {
                score = -alpha_beta(b, depth - 2, -alpha - 1, -alpha, ply + 1, td);
                if (score > alpha && score < beta) {
                    score = -alpha_beta(b, depth - 1, -beta, -alpha, ply + 1, td);
                }
            } else {
                score = -alpha_beta(b, depth - 1, -alpha - 1, -alpha, ply + 1, td);
                if (score > alpha && score < beta) {
                    score = -alpha_beta(b, depth - 1, -beta, -alpha, ply + 1, td);
                }
            }
        }
        
        b.undo_move(m);
        moves_evaluated++;
        
        if (score > best_score) {
            best_score = score;
            best_move = m;
        }
        if (score > alpha) alpha = score;
        if (score >= beta) {
            TT::store(b.hash, depth, score, TT_BETA, best_move);
            if (!best_move.is_capture() && td && ply < 100) {
                if (td->killer_moves[ply][0].data != best_move.data) {
                    td->killer_moves[ply][1] = td->killer_moves[ply][0];
                    td->killer_moves[ply][0] = best_move;
                }
                td->history_table[b.side_to_move][best_move.from()][best_move.to()] += depth * depth;
            }
            return score;
        }
    }
    
    if (!has_legal_moves) {
        if (in_check_before_move) return -MATE_VALUE + ply;
        return 0; // Stalemate
    }
    
    int flag = (best_score <= original_alpha) ? TT_ALPHA : TT_EXACT;
    TT::store(b.hash, depth, best_score, flag, best_move);
    
    return best_score;
}

// --- LAZY SMP THREAD WORKER ---
void search_thread(Board* global_b, int max_depth, std::atomic<bool>& stop_flag, std::vector<std::pair<Move, int>>* results_out, int thread_id, std::vector<uint32_t> exclude_moves, std::vector<uint32_t> include_moves, int multi_pv) {
    // Each thread gets a heap-allocated copy of the board to prevent stack overflow!
    Board* b = new Board(*global_b);
    ThreadData td;
    
    std::vector<std::pair<Move, int>> best_lines;
    
    for (int depth = 1; depth <= max_depth; depth++) {
        if (stop_flag.load() || search_stop_flag.load()) break;
        
        std::vector<std::pair<Move, int>> current_depth_lines;
        std::vector<uint32_t> current_exclude_moves = exclude_moves;
        
        for (int pv = 0; pv < multi_pv; pv++) {
            MoveList ml;
            generate_pseudo_legal_moves(*b, ml);
            generate_pixie_moves(*b, ml);
            
            score_moves(ml, Move(0,0,0,0,0,0,0), &td, 0, b->side_to_move);
            
            int alpha = -INF;
            int beta = INF;
            Move current_best;
            int best_score = -INF;
            int moves_evaluated = 0;
            
            for (int i = 0; i < ml.count; i++) {
                pick_next_move(ml, i);
                Move m = ml.moves[i];
                
                // Skip excluded moves (only for main thread)
                if (thread_id == 0) {
                    bool excluded = false;
                    for (uint32_t ex : current_exclude_moves) {
                        if (m.data == ex) { excluded = true; break; }
                    }
                    if (excluded) continue;
                }
                
                // Skip moves NOT in include_moves (if include_moves is not empty)
                if (!include_moves.empty()) { 
                    bool included = false;
                    for (uint32_t inc : include_moves) {
                        // Check if From and To squares match (ignore flags/promotions)
                        if (m.from() == (inc & 0x3F) && m.to() == ((inc >> 6) & 0x3F)) {
                            included = true;
                            break;
                        }
                    }
                    if (!included) continue;
                }
                
                Color us = b->side_to_move;
                b->do_move(m);
                if (b->in_check(us)) {
                    b->undo_move(m);
                    continue;
                }
                
                // Lazy SMP variation: Helper threads search slightly deeper or shallower randomly
                // to populate different parts of the TT!
                int thread_depth = depth - 1;
                if (thread_id > 0 && (moves_evaluated % 2 == 0)) thread_depth += 1; 
                
                int score;
                if (moves_evaluated == 0) {
                    score = -alpha_beta(*b, thread_depth, -beta, -alpha, 1, &td);
                } else {
                    score = -alpha_beta(*b, thread_depth, -alpha - 1, -alpha, 1, &td);
                    if (score > alpha && score < beta) {
                        score = -alpha_beta(*b, thread_depth, -beta, -alpha, 1, &td);
                    }
                }
                
                b->undo_move(m);
                moves_evaluated++;
                
                if (stop_flag.load() || search_stop_flag.load()) break;
                
                if (score > best_score || (score == best_score && current_best.data == 0)) {
                    best_score = score;
                    current_best = m;
                }
                if (score > alpha) alpha = score;
            }
            
            if (current_best.data != 0) {
                current_depth_lines.push_back({current_best, best_score});
                if (thread_id == 0) {
                    current_exclude_moves.push_back(current_best.data);
                }
            } else {
                break; // No more moves to search
            }
            
            if (stop_flag.load() || search_stop_flag.load()) break;
        }
        
        if (!stop_flag.load() && !search_stop_flag.load()) {
            best_lines = current_depth_lines;
            if (thread_id == 0) {
                if (results_out) *results_out = best_lines;
                
                for (size_t i = 0; i < best_lines.size(); i++) {
                    std::string move_str = "(none)";
                    if (best_lines[i].first.data != 0) {
                        move_str = format_move(best_lines[i].first);
                    }
                    std::cout << "info depth " << depth << " multipv " << (i + 1) << " score cp " << best_lines[i].second << " pv " << move_str << std::endl;
                }
            }
        }
    }
    
    delete b; // Free heap memory
}

// --- ITERATIVE DEEPENING WITH LAZY SMP ---
std::vector<std::pair<Move, int>> search_best_move(Board& b, int max_depth, int threads, int multi_pv, std::vector<uint32_t> include_moves) {
    if (threads < 1) threads = 1;
    if (threads > 8) threads = 8;
    if (multi_pv < 1) multi_pv = 1;
    
    std::vector<std::pair<Move, int>> results;
    std::vector<uint32_t> exclude_moves;
    
    search_stop_flag.store(false);
    
    std::vector<std::thread> workers;
    std::atomic<bool> thread_stop_flag(false);
    
    if (threads == 1) {
        // Single threaded fast-path
        search_thread(&b, max_depth, thread_stop_flag, &results, 0, exclude_moves, include_moves, multi_pv);
    } else {
        // Multi-threaded Lazy SMP
        for (int i = 1; i < threads; i++) {
            workers.emplace_back(search_thread, &b, max_depth + 1, std::ref(thread_stop_flag), nullptr, i, std::vector<uint32_t>(), include_moves, multi_pv);
        }
        
        // Main thread
        search_thread(&b, max_depth, thread_stop_flag, &results, 0, exclude_moves, include_moves, multi_pv);
        
        thread_stop_flag.store(true); // Tell helpers to stop
        for (auto& t : workers) {
            if (t.joinable()) t.join();
        }
    }
    
    return results;
}

// --- PERFT ---
uint64_t perft(Board& b, int depth) {
    if (depth == 0) return 1ULL;
    MoveList ml;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    uint64_t nodes = 0;
    for (int i = 0; i < ml.count; i++) {
        Color us = b.side_to_move;
        b.do_move(ml.moves[i]);
        if (b.in_check(us)) {
            b.undo_move(ml.moves[i]);
            continue;
        }
        nodes += perft(b, depth - 1);
        b.undo_move(ml.moves[i]);
    }
    return nodes;
}
