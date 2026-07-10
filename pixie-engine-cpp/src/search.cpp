#include "search.h"
#include "tt.h"
#include <algorithm>
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include <cmath>
#include "zobrist.h"
#include "see.h"

std::atomic<bool> search_stop_flag(false);
extern int current_search_id;

#ifdef ENABLE_SEARCH_STATS
thread_local SearchStats search_stats;
#endif

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
        int pt = m.piece();
        if (pt == PAWN || pt == GOLDEN_PAWN || pt == IRONPAWN || pt == EPEE_PAWN || pt == PAWN_KNIFE || pt == HERO_PAWN || pt == WARP_JUMPER) {
            if (p == QUEEN) s += 'q';
            else if (p == ROOK) s += 'r';
            else if (p == BISHOP) s += 'b';
            else if (p == KNIGHT) s += 'n';
        }
        // Other piece types are custom pixie promotions, no UCI char
    }
    return s;
}

// End of format_move

// --- LMR REDUCTION TABLE ---
// Pre-computed logarithmic reductions: R = 1 + log(depth) * log(moveIndex) / 1.75
int lmr_table[64][64];

void init_lmr_table() {
    for (int d = 0; d < 64; d++) {
        for (int m = 0; m < 64; m++) {
            if (d == 0 || m == 0) {
                lmr_table[d][m] = 0;
            } else {
                lmr_table[d][m] = (int)(1.0 + log((double)d) * log((double)m) / 1.75); // Increased aggression from 2.25
                if (lmr_table[d][m] < 1) lmr_table[d][m] = 1;
                // Never reduce more than depth - 1
                if (lmr_table[d][m] >= d) lmr_table[d][m] = d - 1;
            }
        }
    }
}

// --- PERSISTENT HEURISTICS ---
// Shared globally across all searches and threads to maximize pruning.
#include <atomic>
std::atomic<int> global_history[2][64][64];
std::atomic<uint32_t> global_counter_moves[2][64][64];

struct ThreadData {
    Move killer_moves[128][2];
    MoveList move_lists[128]; // Pre-allocated move lists to prevent stack overflow!
    
    // Diagnostics
    uint64_t limbo_moves_generated = 0;
    uint64_t limbo_moves_searched = 0;
    uint64_t limbo_moves_pruned = 0;
    
    ThreadData() {
        for (int i = 0; i < 128; i++) {
            killer_moves[i][0] = Move(0,0,0,0,0,0,0);
            killer_moves[i][1] = Move(0,0,0,0,0,0,0);
        }
    }
};

void clear_heuristics() {
    for (int c = 0; c < 2; c++) {
        for (int f = 0; f < 64; f++) {
            for (int t = 0; t < 64; t++) {
                global_history[c][f][t].store(0, std::memory_order_relaxed);
                global_counter_moves[c][f][t].store(0, std::memory_order_relaxed);
            }
        }
    }
}

// --- MOVE ORDERING ---
void score_moves(Board& b, MoveList& ml, Move tt_move, ThreadData* td, int ply, Color us, Move prev_move = Move(0,0,0,0,0,0,0)) {
    for (int i = 0; i < ml.count; i++) {
        Move m = ml.moves[i];
        if (m.data == tt_move.data && tt_move.data != 0) {
            ml.scores[i] = 100000; // TT move is always first
        } else if (m.promoted() != PIECE_TYPE_NONE && !m.is_ability() && !m.is_capture()) {
            // Queen promotions are extremely valuable — search right after TT move
            if (m.promoted() == QUEEN) {
                ml.scores[i] = 95000;
            } else {
                ml.scores[i] = 90000; // Other promotions (underpromotions)
            }
        } else if (m.is_capture()) {
            int attacker = m.piece();
            int victim = m.captured();
            
            // Fix MVV-LVA for Limbo-to-Limbo leaps where captured() stores the jump direction (0-7)
            if (attacker == KNIGHTMARE && m.is_ability() && victim <= 7) {
                victim = KNIGHTMARE;
            }
            
            if (victim != PIECE_TYPE_NONE) {
                int dyn_victim_val = get_dynamic_piece_value(b, victim, m.to(), (us == WHITE) ? BLACK : WHITE);
                int dyn_attacker_val = get_dynamic_piece_value(b, attacker, m.from(), us);
                
                // MVV-LVA: Most Valuable Victim, Least Valuable Attacker
                int mvv_lva = 10000 + (dyn_victim_val * 10) - dyn_attacker_val;
                
                // Capture promotions get an extra bonus
                if (m.promoted() == QUEEN && !m.is_ability()) {
                    mvv_lva += 85000;
                }
                
                // HIGH-VALUE TARGET CAPTURE OVERRIDE:
                if (attacker == KNIGHTMARE && (victim == QUEEN || victim == BASILISK || victim == FISSION_REACTOR)) {
                    mvv_lva += 85000;
                }
                
                // MARAUDER CAPTURE OVERRIDE:
                // Force the engine to evaluate Marauder captures almost immediately
                // This ensures the engine doesn't prune these moves before seeing the kill bonus.
                // Scaled to 75000 to remain strictly below TT moves (100000) and Queen Promos (95000).
                if (attacker == MARAUDER) {
                    mvv_lva += 75000;
                }
                
                // FISSION REACTOR CAPTURE OVERRIDE:
                // Force early search of Fission Reactor captures to trigger explosion logic before pruning.
                if (attacker == FISSION_REACTOR) {
                    mvv_lva += 70000;
                }
                
                // PARALYZED TARGET OVERRIDE:
                // Force early search of captures on paralyzed high-value targets.
                if (b.ability_tracker[m.to()].frozen_turns > 0 && dyn_victim_val >= 400) {
                    if (dyn_attacker_val <= dyn_victim_val + 150) {
                        mvv_lva += 50000;
                    }
                }
                
                // SEE VALIDATION: Identify LOSING Captures and order them BELOW quiet moves!
                // We only run SEE if the attacker is more valuable than the victim to save time.
                if (dyn_attacker_val > dyn_victim_val) {
                    if (!m.is_ability() && see(b, m) < 0) {
                        mvv_lva -= 15000; // Demote losing captures below killer/quiet moves
                    }
                }
                
                ml.scores[i] = mvv_lva;
            } else {
                ml.scores[i] = 10000;
            }
        } else if (m.is_ability()) {
            // Tactical Ability Move Ordering: Abilities are highly tactical moves (e.g. Knightmare drops)
            // that force responses. Searching them early drastically increases Alpha-Beta cutoffs.
            ml.scores[i] = 15000;
        } else {
            if (td && ply < 100) {
                if (m.data == td->killer_moves[ply][0].data) {
                    ml.scores[i] = 9000;
                } else if (m.data == td->killer_moves[ply][1].data) {
                    ml.scores[i] = 8000;
                } else if (prev_move.data != 0 && m.data == global_counter_moves[us][prev_move.from()][prev_move.to()].load(std::memory_order_relaxed)) {
                    // Counter-move heuristic: score well if this move counters the previous move
                    ml.scores[i] = 7000;
                } else {
                    ml.scores[i] = global_history[us][m.from()][m.to()].load(std::memory_order_relaxed);
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
int quiescence(Board& b, int alpha, int beta, int ply, ThreadData* td = nullptr, int qs_depth = 0) {
    if (search_stop_flag.load(std::memory_order_relaxed)) return 0;
#ifdef ENABLE_SEARCH_STATS
    search_stats.qnodes++;
#endif
    
    // Immediate game over check: missing Kings
    U64 us_king = b.pieces[b.side_to_move][KING];
    U64 them_king = b.pieces[b.side_to_move == WHITE ? BLACK : WHITE][KING];
    if (!us_king) return -MATE_VALUE + ply;
    if (!them_king) return MATE_VALUE - ply;
    
    // Hard cap early to prevent WASM stack overflow
    if (qs_depth >= 6) return evaluate(b);
      bool in_check = b.in_check(b.side_to_move);
    int stand_pat = -INF;
    
    if (!in_check) {
        stand_pat = evaluate(b);
        if (stand_pat >= beta) return beta;
        
        // Delta pruning
        const int DELTA_MARGIN = 2000;
        if (stand_pat + DELTA_MARGIN < alpha && qs_depth >= 2) return alpha;
        
        if (alpha < stand_pat) alpha = stand_pat;
    }
    
    MoveList local_ml;
    MoveList& ml = td ? td->move_lists[std::min(ply, 127)] : local_ml;
    if (td) ml.count = 0;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    
    score_moves(b, ml, Move(0,0,0,0,0,0,0), nullptr, 0, b.side_to_move);
    
    int legal_moves = 0;
    
    for (int i = 0; i < ml.count; i++) {
        pick_next_move(ml, i);
        Move m = ml.moves[i];
        
        // In QS, if in check, search ALL evasions. Otherwise search captures & Queen promotions.
        bool is_promotion = (m.promoted() == QUEEN && !m.is_ability());
        
        if (!in_check && !m.is_capture() && !is_promotion) continue;
        
        // Futility: skip captures of very low-value pieces if we're far below alpha
        if (!in_check && m.is_capture() && !is_promotion && qs_depth >= 1) {
            int victim = m.captured();
            if (victim != PIECE_TYPE_NONE && victim < PIECE_TYPE_COUNT) {
                int dyn_victim_val = get_dynamic_piece_value(b, victim, m.to(), b.side_to_move == WHITE ? BLACK : WHITE);
                if (stand_pat + dyn_victim_val + 200 < alpha) continue;
                
                // SEE Pruning (Hallucination Eradication)
                // If the capture loses material and we are not in check, DO NOT SEARCH IT!
                int dyn_attacker_val = get_dynamic_piece_value(b, m.piece(), m.from(), b.side_to_move);
                if (dyn_victim_val < dyn_attacker_val) {
                    if (!m.is_ability() && see(b, m) < 0) {
                        continue; // Prune losing capture
                    }
                }
            }
        }
        
        b.do_move(m);
        if (!b.last_move_was_legal) {
            b.undo_move(m);
            continue; // Illegal move
        }
        
        legal_moves++;
        int score = -quiescence(b, -beta, -alpha, ply + 1, td, qs_depth + 1);
        b.undo_move(m);
        
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    
    // If we are in check and have no legal evasions, it's checkmate!
    if (in_check && legal_moves == 0) {
        return -MATE_VALUE + ply;
    }
    
    return alpha;
}

// --- ALPHA-BETA MINIMAX WITH TT ---
int alpha_beta(Board& b, int depth, int alpha, int beta, int ply, ThreadData* td) {
    if (search_stop_flag.load(std::memory_order_relaxed)) return 0;
#ifdef ENABLE_SEARCH_STATS
    search_stats.nodes++;
    if (ply > search_stats.seldepth) search_stats.seldepth = ply;
#endif

    // Immediate game over check: missing Kings
    U64 us_king = b.pieces[b.side_to_move][KING];
    U64 them_king = b.pieces[b.side_to_move == WHITE ? BLACK : WHITE][KING];
    if (!us_king) return -MATE_VALUE + ply;
    if (!them_king) return MATE_VALUE - ply;
    
    // Draw check: Threefold repetition or 50-move rule
    if (b.is_repetition() || b.half_move_clock >= 100) return -10; // Contempt factor: prefer fighting over drawing

    int tt_score;
    Move tt_move = Move(0,0,0,0,0,0,0);
    if (TT::probe(b.hash, depth, alpha, beta, tt_score, tt_move)) {
#ifdef ENABLE_SEARCH_STATS
        search_stats.tt_hits++;
#endif
        return tt_score;
    }

    if (depth <= 0) {
        int q = quiescence(b, alpha, beta, ply, td, 0);
        TT::store(b.hash, 0, q, TT_EXACT, Move(0,0,0,0,0,0,0));
        return q;
    }
    
    bool in_check_before_move = b.in_check(b.side_to_move);
    
    // --- CHECK EXTENSION & PARALYSIS ---
    // Search deeper when in check to avoid horizon effect on forced sequences.
    // Also extend if the King is paralyzed by a Basilisk, as it is functionally in a mating net.
    bool king_paralyzed = false;
    U64 our_king = b.pieces[b.side_to_move][KING];
    if (our_king) {
        int ksq = get_lsb(our_king);
        U64 enemy_basilisks = b.pieces[b.side_to_move == WHITE ? BLACK : WHITE][BASILISK];
        while (enemy_basilisks) {
            int bsq = pop_lsb(enemy_basilisks);
            if (get_bit(get_sliding_attacks(bsq, b.occupancies[BOTH], true, false), ksq)) {
                king_paralyzed = true; break;
            }
        }
    }
    
    // Cap at ply < 12 to prevent infinite recursion in perpetual check positions.
    if ((in_check_before_move || king_paralyzed) && ply < 12) {
        depth++;
    }
    
    // Pre-compute static evaluation
    int static_eval = evaluate(b);
    
    // --- NULL MOVE PRUNING (NMP) ---
    // Dynamic R based on depth. Disabled in zugzwang-prone positions (only pawns+king).
    // ONLY allowed if our static evaluation is at least beta (meaning we are already "failing high").
    // This prevents NMP blindness to tactical traps where high-value pieces are left hanging.
    if (!in_check_before_move && depth >= 3 && beta > -MATE_VALUE + 100 && static_eval >= beta) {
        // Exclude ALL custom pawn variants to prevent NMP Zugzwang blindness
        U64 all_pawns = 0ULL;
        for (int pt = PAWN; pt <= WAR_AUTOMATON; pt++) {
            all_pawns |= b.pieces[b.side_to_move][pt];
        }
        U64 non_pawns = b.occupancies[b.side_to_move] & ~all_pawns & ~b.pieces[b.side_to_move][KING];
        if (non_pawns) {
            // Dynamic R: deeper searches get more aggressive reductions
            int R = 3 + depth / 4;
            if (R > depth - 1) R = depth - 1;
            
            int ep_save = b.en_passant_sq;
            U64 hash_save = b.hash;
            
            b.side_to_move = b.side_to_move == WHITE ? BLACK : WHITE;
            b.en_passant_sq = NO_SQ;
            b.hash ^= Zobrist::side_key;
            
            int null_score = -alpha_beta(b, depth - 1 - R, -beta, -beta + 1, ply + 1, td);
            
            b.side_to_move = b.side_to_move == WHITE ? BLACK : WHITE;
            b.en_passant_sq = ep_save;
            b.hash = hash_save;
            
            if (null_score >= beta) {
#ifdef ENABLE_SEARCH_STATS
                search_stats.null_move_prunes++;
#endif
                // Don't return unproven mate scores from NMP
                if (null_score >= MATE_VALUE - 100) return beta;
                return null_score;
            }
        }
    }
    
    // --- REVERSE FUTILITY PRUNING (Static Null Move Pruning) ---
    // If our position is so good that even with a big margin we exceed beta, prune.
    if (!in_check_before_move && depth <= 3 && beta > -MATE_VALUE + 100) {
        int margin = 100 * depth;
        if (static_eval - margin >= beta) return static_eval - margin;
    }
    
    // --- INTERNAL ITERATIVE DEEPENING (IID) ---
    // If we have no TT move for this position and depth is high enough,
    // do a quick shallow search to find a good first move.
    // Restricted to PV nodes (beta - alpha > 1) to prevent tree explosion
    // and avoid storing garbage moves from zero-window fail-lows.
    if (tt_move.data == 0 && depth >= 4 && !in_check_before_move && (beta - alpha > 1)) {
        int iid_depth = depth - 3;
        if (iid_depth < 1) iid_depth = 1;
        alpha_beta(b, iid_depth, alpha, beta, ply, td);
        // Now re-probe the TT — the shallow search should have stored a best move
        int dummy_score;
        TT::probe(b.hash, 0, -INF, INF, dummy_score, tt_move);
    }
    
    MoveList local_ml;
    MoveList& ml = td ? td->move_lists[std::min(ply, 127)] : local_ml;
    if (td) ml.count = 0;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    
    score_moves(b, ml, tt_move, td, ply, b.side_to_move);
    
    // Pre-compute eval for futility pruning is already done (static_eval)
    bool can_futility_prune = (!in_check_before_move && depth <= 2 && beta > -MATE_VALUE + 100);
    
    int original_alpha = alpha;
    Move best_move = ml.count > 0 ? ml.moves[0] : Move(0,0,0,0,0,0,0);
    int best_score = -INF;
    bool has_legal_moves = false;
    int moves_evaluated = 0;
    
    for (int i = 0; i < ml.count; i++) {
        pick_next_move(ml, i);
        Move m = ml.moves[i];
        
        Color us = b.side_to_move; // side that is making the move
        
        bool is_limbo = (m.piece() == KNIGHTMARE && (m.from() == m.to() || m.from() == 63));
        if (is_limbo && td != nullptr) td->limbo_moves_generated++;
        
        b.do_move(m);
        if (!b.last_move_was_legal) {
            b.undo_move(m);
            continue; // Illegal move
        }
        
        if (is_limbo && td != nullptr) td->limbo_moves_searched++;
        
        has_legal_moves = true;
        
        // Removed Limbo Wander Pruning: it broke flanking and restricted Knightmares.
        // Instead, we now allow Limbo-to-Limbo jumps but apply heavy LMR to prevent tree explosion.

        
        // --- FUTILITY PRUNING ---
        // At shallow depths, skip quiet moves that can't possibly raise alpha
        if (can_futility_prune && moves_evaluated > 0 && !m.is_capture() 
            && m.promoted() == PIECE_TYPE_NONE
            && !b.in_check(b.side_to_move == WHITE ? BLACK : WHITE)) { // move doesn't give check
            int futility_margin = 120 * depth;
            if (static_eval + futility_margin <= alpha) {
                b.undo_move(m);
                if (is_limbo && td != nullptr) td->limbo_moves_pruned++;
                continue;
            }
        }
        
        int score;
        if (moves_evaluated == 0) {
            // PVS full window
            score = -alpha_beta(b, depth - 1, -beta, -alpha, ply + 1, td);
        } else {
            // LMR: Dynamic Late Move Reductions
            bool gives_check = b.in_check(b.side_to_move); // Does this move give check?
            bool is_quiet_limbo_to_limbo = (is_limbo && m.from() == 63 && !m.is_capture());
            bool can_lmr = ((!m.is_ability() || (m.piece() == KNIGHTMARE && !m.is_capture())) && m.promoted() == PIECE_TYPE_NONE) || is_quiet_limbo_to_limbo;
            
            if (depth >= 3 && moves_evaluated >= 2 && !m.is_capture() 
                && !in_check_before_move && !gives_check && can_lmr) {
                // Use pre-computed LMR table for logarithmic reductions
                int d = depth < 64 ? depth : 63;
                int mi = moves_evaluated < 64 ? moves_evaluated : 63;
                int reduction = lmr_table[d][mi];
                
                if (is_quiet_limbo_to_limbo) {
                    reduction += 1; // Extra penalty for quiet Limbo wandering to prevent explosion
                }
                
                // Reduce less for killer moves
                if (td && ply < 128) {
                    if (m.data == td->killer_moves[ply][0].data || m.data == td->killer_moves[ply][1].data) {
                        reduction = reduction > 1 ? reduction - 1 : 0;
                    }
                }
                
                int reduced_depth = depth - 1 - reduction;
#ifdef ENABLE_SEARCH_STATS
                if (reduction > 0) search_stats.lmr_reductions++;
#endif
                if (reduced_depth < 1) reduced_depth = 1;
                
                score = -alpha_beta(b, reduced_depth, -alpha - 1, -alpha, ply + 1, td);
                
                // Re-search at full depth if LMR failed high
                if (score > alpha) {
                    score = -alpha_beta(b, depth - 1, -alpha - 1, -alpha, ply + 1, td);
                    if (score > alpha && score < beta) {
                        score = -alpha_beta(b, depth - 1, -beta, -alpha, ply + 1, td);
                    }
                }
            } else {
                // PVS zero-window search
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
#ifdef ENABLE_SEARCH_STATS
            search_stats.beta_cutoffs++;
#endif
            TT::store(b.hash, depth, score, TT_BETA, best_move);
            if (!best_move.is_capture() && td && ply < 128) {
                if (td->killer_moves[ply][0].data != best_move.data) {
                    td->killer_moves[ply][1] = td->killer_moves[ply][0];
                    td->killer_moves[ply][0] = best_move;
                }
                // History bonus with clamping to prevent overflow
                int bonus = depth * depth;
                int current_hist = global_history[b.side_to_move][best_move.from()][best_move.to()].load(std::memory_order_relaxed);
                global_history[b.side_to_move][best_move.from()][best_move.to()].store(current_hist + bonus, std::memory_order_relaxed);
                
                if (current_hist + bonus > 400000) {
                    // Age all history values to prevent saturation
                    for (int f = 0; f < 64; f++)
                        for (int t = 0; t < 64; t++) {
                            int h = global_history[b.side_to_move][f][t].load(std::memory_order_relaxed);
                            global_history[b.side_to_move][f][t].store(h / 2, std::memory_order_relaxed);
                        }
                }
                // Counter-move heuristic
                if (ply > 0) {
                    // Store this move as a counter to whatever the opponent just played
                    global_counter_moves[b.side_to_move][m.from()][m.to()].store(best_move.data, std::memory_order_relaxed);
                }
            }
#ifdef ENABLE_SEARCH_STATS
            search_stats.fail_highs++;
#endif
            return score;
        }
    }
    
    if (!has_legal_moves) {
        if (in_check_before_move) return -MATE_VALUE + ply;
        return -10; // Stalemate: Contempt factor (prefer avoiding stalemates if we are winning)
    }
    
    int flag = (best_score <= original_alpha) ? TT_ALPHA : TT_EXACT;
    TT::store(b.hash, depth, best_score, flag, best_move);
    
#ifdef ENABLE_SEARCH_STATS
    if (best_score <= original_alpha) {
        search_stats.fail_lows++;
    }
    search_stats.branching_factor_sum += ml.count;
#endif

    return best_score;
}

// --- LAZY SMP THREAD WORKER ---
void search_thread(Board* global_b, int max_depth, std::atomic<bool>& stop_flag, std::vector<std::pair<Move, int>>* results_out, int thread_id, std::vector<uint32_t> exclude_moves, std::vector<uint32_t> include_moves, int multi_pv) {
    // Each thread gets a heap-allocated copy of the board to prevent stack overflow!
    Board* b = new Board(*global_b);
    ThreadData* td = new ThreadData();
    
    std::vector<std::pair<Move, int>> best_lines;
    
    for (int depth = 1; depth <= std::min(max_depth, 40); depth++) {
        if (stop_flag.load() || search_stop_flag.load()) break;
        
        std::vector<std::pair<Move, int>> current_depth_lines;
        std::vector<uint32_t> current_exclude_moves = exclude_moves;
        
        for (int pv = 0; pv < multi_pv; pv++) {
            MoveList& ml = td->move_lists[0];
            ml.count = 0;
            generate_pseudo_legal_moves(*b, ml);
            generate_pixie_moves(*b, ml);
            
            score_moves(*b, ml, Move(0,0,0,0,0,0,0), td, 0, b->side_to_move);
            
            int window_alpha = -INF;
            int window_beta = INF;
            int delta = 25;
            
            // --- ASPIRATION WINDOWS ---
            if (depth >= 4 && !best_lines.empty() && pv < best_lines.size()) {
                int prev_score = best_lines[pv].second;
                if (prev_score > -MATE_VALUE + 1000 && prev_score < MATE_VALUE - 1000) {
                    window_alpha = prev_score - delta;
                    window_beta = prev_score + delta;
                }
            }
            
            Move current_best;
            int best_score = -INF;
            
            while (true) {
                best_score = -INF;
                int moves_evaluated = 0;
                int alpha = window_alpha;
                int beta = window_beta;
                
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
                if (!b->last_move_was_legal) {
                    b->undo_move(m);
                    continue;
                }
                
                // Lazy SMP variation: Helper threads search slightly deeper/shallower with offsets
                // to populate different parts of the TT!
                int thread_depth = depth - 1;
                if (thread_id > 0) {
                    if (thread_id % 2 == 1) thread_depth += 1; // Odd threads search 1 deeper
                    if (thread_id % 4 == 2) thread_depth += (moves_evaluated % 2); // Some threads scatter on evens
                    if (thread_depth > max_depth) thread_depth = max_depth;
                } 
                
                bool is_limbo_candidate = (thread_id == 0 && m.piece() == KNIGHTMARE && (m.from() == m.to() || m.from() == 63));
                int static_eval_before = is_limbo_candidate ? evaluate(*b) : 0;
                
                int score;
                if (moves_evaluated == 0) {
                    score = -alpha_beta(*b, thread_depth, -beta, -alpha, 1, td);
                } else {
                    score = -alpha_beta(*b, thread_depth, -alpha - 1, -alpha, 1, td);
                    if (score > alpha && score < beta) {
                        score = -alpha_beta(*b, thread_depth, -beta, -alpha, 1, td);
                    }
                }
                
                if (is_limbo_candidate) {
                    std::cout << "info string AUDIT [Depth " << depth << "] Limbo Move: " << format_move(m)
                              << " | Static Eval: " << static_eval_before
                              << " | Search Eval: " << score
                              << " | Rank: " << moves_evaluated
                              << " | Pruned: NO (Root moves are always searched in PVS)"
                              << " | Entered PV: " << (score > alpha ? "YES" : "NO")
                              << std::endl;
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
            
            if (stop_flag.load() || search_stop_flag.load()) break;
            
            // Aspiration window widening
            if (best_score <= window_alpha) {
                // Fail low: score is worse than expected. Widen lower bound.
                window_alpha -= delta;
                delta += delta / 2;
            } else if (best_score >= window_beta) {
                // Fail high: score is better than expected. Widen upper bound.
                window_beta += delta;
                delta += delta / 2;
            } else {
                // Exact score found within the window!
                break;
            }
        } // End of aspiration window loop
        
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
#ifdef ENABLE_SEARCH_STATS
            if (depth > 1 && !best_lines.empty() && !current_depth_lines.empty() && thread_id == 0) {
                if (best_lines[0].first.data != current_depth_lines[0].first.data) {
                    search_stats.pv_changes++;
                }
            }
#endif
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
                
                std::cout << "info string DIAGNOSTICS [Depth " << depth << "]: Limbo Moves Generated=" 
                          << td->limbo_moves_generated << " Searched=" 
                          << td->limbo_moves_searched << " Pruned=" 
                          << td->limbo_moves_pruned << std::endl;
                          
                if (depth == max_depth || stop_flag.load() || search_stop_flag.load()) {
                    std::cout << "info string --- DECISION EXPLANATION MODE ---" << std::endl;
                    EvaluationBreakdown best_brk;
                    for (size_t i = 0; i < std::min(best_lines.size(), (size_t)100); i++) {
                        Move m = best_lines[i].first;
                        if (m.data == 0) continue;
                        
                        b->do_move(m);
                        int actual_eval = evaluate(*b);
                        EvaluationBreakdown brk = explain_evaluation(*b);
                        b->undo_move(m);
                        
                        if (i == 0) {
                            best_brk = brk;
                            std::cout << "info string 1. " << format_move(m) << " (Score: " << best_lines[i].second << ")" << std::endl;
                            std::cout << "info string   Why " << format_move(m) << "?" << std::endl;
                            std::cout << "info string   > Material: " << brk.material << std::endl;
                            std::cout << "info string   > Mobility: " << brk.mobility << std::endl;
                            std::cout << "info string   > King Safety: " << brk.king_safety << std::endl;
                            std::cout << "info string   > Center Control: " << brk.center_control << std::endl;
                            std::cout << "info string   > Threats: " << brk.threats << std::endl;
                            std::cout << "info string   > Development: " << brk.development << std::endl;
                            std::cout << "info string   > Power Potential: " << brk.power_potential << std::endl;
                            std::cout << "info string   > TOTAL (Static): " << brk.total() << " | Engine Classical: " << actual_eval << std::endl;
                        } else {
                            std::cout << "info string " << i+1 << ". " << format_move(m) << " (Score: " << best_lines[i].second << ")" << std::endl;
                            std::cout << "info string   Why not " << format_move(m) << "?" << std::endl;
                            std::cout << "info string   > Material Delta: " << (brk.material - best_brk.material) << std::endl;
                            std::cout << "info string   > Mobility Delta: " << (brk.mobility - best_brk.mobility) << std::endl;
                            std::cout << "info string   > King Safety Delta: " << (brk.king_safety - best_brk.king_safety) << std::endl;
                            std::cout << "info string   > Center Delta: " << (brk.center_control - best_brk.center_control) << std::endl;
                            std::cout << "info string   > Threats Delta: " << (brk.threats - best_brk.threats) << std::endl;
                            std::cout << "info string   > Development Delta: " << (brk.development - best_brk.development) << std::endl;
                            std::cout << "info string   > Power Potential Delta: " << (brk.power_potential - best_brk.power_potential) << std::endl;
                            std::cout << "info string   > Net Difference: " << (brk.total() - best_brk.total()) << std::endl;
                            
                            int cp_diff = std::abs(best_lines[0].second - best_lines[i].second);
                            std::string conf = (cp_diff <= 20) ? "Low" : (cp_diff <= 50 ? "Medium" : "High");
                            std::cout << "info string   > Decision Confidence: " << conf << " (" << cp_diff << " cp)" << std::endl;
                        }
                    }
                }
            }
        }
    }
    
    delete b; // Free heap memory
    delete td;
}

// --- ITERATIVE DEEPENING WITH LAZY SMP ---
std::vector<std::pair<Move, int>> search_best_move(Board& b, int max_depth, int threads, int multi_pv, std::vector<uint32_t> include_moves) {
#ifdef ENABLE_SEARCH_STATS
    search_stats.clear();
#endif
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
    
#ifdef ENABLE_SEARCH_STATS
    std::cout << "info string STATS nodes " << search_stats.nodes
              << " seldepth " << search_stats.seldepth
              << " tt_hits " << search_stats.tt_hits 
              << " beta_cutoffs " << search_stats.beta_cutoffs 
              << " lmr_reductions " << search_stats.lmr_reductions 
              << " null_move_prunes " << search_stats.null_move_prunes 
              << " qnodes " << search_stats.qnodes 
              << " fail_highs " << search_stats.fail_highs
              << " fail_lows " << search_stats.fail_lows
              << " branching_factor_sum " << search_stats.branching_factor_sum
              << " pv_changes " << search_stats.pv_changes << std::endl;
#endif

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
