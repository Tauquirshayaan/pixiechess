#include "evaluate.h"
#include "bitboard.h"
#include "pst.h"
#include "nnue.h"
#include "movegen.h"
#include "rays.h"

// Material Values (centipawns)
// Calibrated with Grandmaster Deadly Ranking (★ System)
const int PIECE_VALUES[39] = {
    100,  // PAWN
    320,  // KNIGHT (Stockfish)
    330,  // BISHOP (Stockfish)
    500,  // ROOK
    900,  // QUEEN
    20000, // KING (Infinity)
    
    // 9 Pixie Pawns
    200,  // GOLDEN_PAWN
    100,  // IRONPAWN
    100,  // BLUEPRINT
    150,  // EPEE_PAWN
    120,  // PAWN_KNIFE
    150,  // HERO_PAWN
    150,  // SHRIKE
    130,  // WARP_JUMPER
    100,  // WAR_AUTOMATON

    // 7 Pixie Knights
    380,  // ELECTROKNIGHT
    330,  // BANKER
    310,  // CAMEL
    360,  // KNIGHTMARE
    250,  // ANTI_VIOLENCE
    300,  // PINATA
    280,  // FISH_KNIGHT

    // 12 Pixie Bishops
    400,  // ARISTOCRAT
    450,  // BASILISK
    340,  // BLADERUNNER
    330,  // BOUNCER
    400,  // PILGRIM
    360,  // DANCER
    350,  // DJINN
    340,  // GUNSLINGER
    350,  // CARDINAL
    420,  // ICICLE
    350,  // HORDE_MOTHER
    650,  // MARAUDER

    // 2 Pixie Rooks
    550,  // PHASE_ROOK
    480,  // SUMOROOK

    // 1 Pixie Queen
    1100, // FISSION_REACTOR

    // 1 Pixie King
    20000, // ROCKETMAN — FIX: was 600! Losing Rocketman = checkmate!
    
    // Horde summon
    100    // HORDELING
};

int evaluate(const Board& b) {
    int nnue_score = 0;
    if (NNUE::is_loaded()) {
        nnue_score = NNUE::evaluate(b);
    }
    
    // Classical Evaluation
    int classical_score = 0;
    
    // Simple endgame detection (if total non-pawn material is low)
    int non_pawn_material = 0;
    
    // Calculate non-pawn material for endgame detection
    for (int pt = KNIGHT; pt < PIECE_TYPE_COUNT; pt++) {
        if (pt == KING || pt == ROCKETMAN) continue;
        non_pawn_material += popcount(b.pieces[WHITE][pt]) * PIECE_VALUES[pt];
        non_pawn_material += popcount(b.pieces[BLACK][pt]) * PIECE_VALUES[pt];
    }
    non_pawn_material += b.num_knightmares_limbo[WHITE] * PIECE_VALUES[KNIGHTMARE];
    non_pawn_material += b.num_knightmares_limbo[BLACK] * PIECE_VALUES[KNIGHTMARE];
    if (b.dissipated_djinn_sqs[WHITE] != NO_SQ) non_pawn_material += PIECE_VALUES[DJINN];
    if (b.dissipated_djinn_sqs[BLACK] != NO_SQ) non_pawn_material += PIECE_VALUES[DJINN];
    
    bool is_endgame = non_pawn_material < 3000;
    
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        Color them = (c == WHITE) ? BLACK : WHITE;
        
        // Restore dissipated DJINN base material value
        if (b.dissipated_djinn_sqs[c] != NO_SQ) {
            classical_score += PIECE_VALUES[DJINN] * color_sign;
            classical_score += 150 * color_sign; // Bonus for being safely dissipated (untargetable) and ready to respawn
        }
        
        // ============================================================
        //  PHASE 1: Material + PST (with dynamic ability scaling)
        // ============================================================
        for (int pt = 0; pt < 39; pt++) {
            U64 bb = b.pieces[c][pt];
            const int* pst = get_pst(pt, is_endgame);
            
            while (bb) {
                int sq = pop_lsb(bb);
                
                // Base Material score
                int piece_val = PIECE_VALUES[pt];
                
                // ---- MARAUDER SNOWBALL (Fix 4) ----
                // +100cp per kill (was +50). After 3 kills it's worth more than a Queen.
                if (pt == MARAUDER) {
                    piece_val += (b.ability_tracker[sq].marauder_kills * 100);
                }
                
                // ---- BASILISK PRESERVATION ----
                // Prioritize preserving the Basilisk until the endgame
                if (pt == BASILISK) {
                    if (!is_endgame) {
                        piece_val += 250; // Treat it as highly valuable in early/mid game so we don't trade it
                        
                        // Penalize pushing it too far forward early on (keep it safe in our territory)
                        int r = sq / 8;
                        bool overextended = (c == WHITE) ? (r < 4) : (r > 3); // Ranks 5-8 for White, 1-4 for Black
                        if (overextended) {
                            classical_score -= 80 * color_sign;
                        }
                    } else {
                        // In endgame, Basilisk becomes a highly active hunter
                        piece_val += 100; 
                    }
                }
                
                // Pawn promotion priority when no Pilgrim is alive (to respawn Queen/Rook)
                if ((pt == PAWN || (pt >= GOLDEN_PAWN && pt <= WAR_AUTOMATON)) && popcount(b.pieces[c][PILGRIM]) == 0) {
                    bool has_dead_queen = b.dead_pieces_count[c][QUEEN] > 0;
                    bool has_dead_rook = b.dead_pieces_count[c][ROOK] > 0;
                    
                    if (has_dead_queen || has_dead_rook) {
                        int r = sq / 8;
                        if (c == WHITE) {
                            if (r >= 4) { // Rank 5, 6, 7
                                int advance_bonus = (r - 3) * (has_dead_queen ? 40 : 20);
                                classical_score += advance_bonus * color_sign;
                            }
                        } else {
                            if (r <= 3) { // Rank 5, 6, 7 from Black's view (Row 3, 2, 1)
                                int advance_bonus = (4 - r) * (has_dead_queen ? 40 : 20);
                                classical_score += advance_bonus * color_sign;
                            }
                        }
                    }
                }
                
                classical_score += piece_val * color_sign;
                
                // PST score
                if (pst != nullptr) {
                    // For White, flip the rank to map bottom-up coords to top-down PST array.
                    // For Black, Black's natural perspective is already top-down.
                    int pst_sq = (c == WHITE) ? sq ^ 56 : sq;
                    classical_score += pst[pst_sq] * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 2: ★ STAR-SYSTEM SAFETY NET (Fix 2)
        //  Uses is_square_attacked() which correctly handles ALL 31 Pixies.
        //  Replaces the old broken QUEEN SAFETY that only checked standard pieces.
        // ============================================================
        
        // ★★★★★ Game-Enders: -40cp if hanging (Search tree handles real material loss)
        const int five_star[] = { FISSION_REACTOR, MARAUDER };
        for (int i = 0; i < 2; i++) {
            U64 pbb = b.pieces[c][five_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    classical_score -= 40 * color_sign;
                }
            }
        }
        
        // ★★★★ High-Threat: -25cp if hanging
        const int four_star[] = { QUEEN, PHASE_ROOK, ROOK, SUMOROOK, BASILISK, ICICLE, ARISTOCRAT, PILGRIM };
        for (int i = 0; i < 8; i++) {
            U64 pbb = b.pieces[c][four_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    classical_score -= 25 * color_sign;
                }
            }
        }
        
        // ★★★ Solid Anchors: -10cp if hanging
        const int three_star[] = { ELECTROKNIGHT, KNIGHTMARE, DANCER, DJINN, CARDINAL, HORDE_MOTHER, 
                                    BLADERUNNER, GUNSLINGER, BISHOP, BOUNCER, BANKER, KNIGHT, CAMEL };
        for (int i = 0; i < 13; i++) {
            U64 pbb = b.pieces[c][three_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    classical_score -= 10 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 2B: MISSING PIECE POSITIONAL EVALUATION
        // ============================================================
        
        // ANTI_VIOLENCE: Bonus for central placement (blocks enemy captures in a wider area)
        U64 anti_v = b.pieces[c][ANTI_VIOLENCE];
        while (anti_v) {
            int sq = pop_lsb(anti_v);
            int r = sq / 8, fc = sq % 8;
            if ((r >= 2 && r <= 5) && (fc >= 2 && fc <= 5)) {
                classical_score += 30 * color_sign; // Central aura is more impactful
            }
            // Count how many enemy pieces are in the aura
            U64 aura = KING_ATTACKS[sq] & b.occupancies[them];
            classical_score += popcount(aura) * 15 * color_sign;
        }
        
        // BANKER: Bonus for each enemy pawn in knight-jump range (can bank/steal them)
        U64 bankers = b.pieces[c][BANKER];
        while (bankers) {
            int sq = pop_lsb(bankers);
            U64 targets = KNIGHT_ATTACKS[sq] & b.pieces[them][PAWN];
            // Also count pixie pawns
            for (int pt = GOLDEN_PAWN; pt <= WAR_AUTOMATON; pt++) {
                targets |= KNIGHT_ATTACKS[sq] & b.pieces[them][pt];
            }
            int pawn_count = popcount(targets);
            classical_score += pawn_count * 50 * color_sign;
        }
        
        // CAMEL: Mobility bonus (3,1 leaper has unique reach)
        U64 camels = b.pieces[c][CAMEL];
        while (camels) {
            int sq = pop_lsb(camels);
            int r = sq / 8, fc = sq % 8;
            // Camel attacks: (3,1) and (1,3) jumps
            int camel_mobility = 0;
            int camel_offsets[][2] = {{-3,-1},{-3,1},{-1,-3},{-1,3},{1,-3},{1,3},{3,-1},{3,1}};
            for (int i = 0; i < 8; i++) {
                int nr = r + camel_offsets[i][0], nc = fc + camel_offsets[i][1];
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    int nsq = nr * 8 + nc;
                    if (!get_bit(b.occupancies[c], nsq)) camel_mobility++;
                }
            }
            classical_score += camel_mobility * 5 * color_sign;
        }
        
        // IRONPAWN: Bonus for invulnerability — safe advanced pawn
        U64 ironpawns = b.pieces[c][IRONPAWN];
        while (ironpawns) {
            int sq = pop_lsb(ironpawns);
            int rank = sq / 8;
            int advancement = (c == WHITE) ? rank : (7 - rank);
            classical_score += advancement * 10 * color_sign; // More valuable as it advances
        }
        
        // FISH_KNIGHT: Bonus if it just moved (earns a bonus king-step)
        U64 fish_kn = b.pieces[c][FISH_KNIGHT];
        while (fish_kn) {
            int sq = pop_lsb(fish_kn);
            // Center control bonus
            int r = sq / 8, fc = sq % 8;
            if (r >= 2 && r <= 5 && fc >= 2 && fc <= 5) {
                classical_score += 15 * color_sign;
            }
        }
        
        // SUMOROOK: Strategic Physics Evaluator
        U64 sumorooks = b.pieces[c][SUMOROOK];
        while (sumorooks) {
            int sq = pop_lsb(sumorooks);
            int r = sq / 8, fc = sq % 8;
            
            // 4 push directions: UP, DOWN, LEFT, RIGHT
            int dirs[4][2] = {{1,0}, {-1,0}, {0,1}, {0,-1}};
            for (int i = 0; i < 4; i++) {
                int dr = dirs[i][0];
                int dc = dirs[i][1];
                int cur_r = r + dr;
                int cur_c = fc + dc;
                
                // Find first piece in ray
                int hit_sq = -1;
                while (cur_r >= 0 && cur_r < 8 && cur_c >= 0 && cur_c < 8) {
                    int check_sq = cur_r * 8 + cur_c;
                    if (get_bit(b.occupancies[BOTH], check_sq)) {
                        hit_sq = check_sq;
                        break;
                    }
                    cur_r += dr;
                    cur_c += dc;
                }
                
                if (hit_sq != -1) {
                    int p1_type = b.get_piece_on_square(hit_sq);
                    if (p1_type == IRONPAWN) continue; // Cannot push Ironpawns
                    
                    // CHECK IF PUSH IS VALID
                    int next_r = cur_r + dr;
                    int next_c = cur_c + dc;
                    bool push_valid = true;
                    int hit2_sq = -1;
                    
                    // Does a second piece exist?
                    while (next_r >= 0 && next_r < 8 && next_c >= 0 && next_c < 8) {
                        int check2_sq = next_r * 8 + next_c;
                        if (get_bit(b.occupancies[BOTH], check2_sq)) {
                            hit2_sq = check2_sq;
                            break;
                        }
                        next_r += dr;
                        next_c += dc;
                    }
                    
                    // If second piece is immediately behind the first piece, check third square
                    if (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc))) {
                        int third_r = next_r + dr;
                        int third_c = next_c + dc;
                        if (third_r >= 0 && third_r < 8 && third_c >= 0 && third_c < 8) {
                            int third_sq = third_r * 8 + third_c;
                            if (get_bit(b.occupancies[BOTH], third_sq)) {
                                push_valid = false; // Blocked by third piece!
                            }
                        }
                    }
                    
                    if (push_valid) {
                        bool p1_is_ours = get_bit(b.occupancies[c], hit_sq);
                        
                        // 3. Double-Push Disruption
                        bool is_double_push = (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc)));
                        if (is_double_push && !p1_is_ours) {
                            // Only give disruption bonus if we are pushing ENEMY pieces
                            // If we push our own pieces, we rely on the search tree to find the value
                            classical_score += 40 * color_sign; // Disruption bonus
                        }
                    }
                }
            }
        }
        
        // 4. Enemy SumoRook Avoidance (Penalty for standing in push rays)
        U64 enemy_sumorooks = b.pieces[them][SUMOROOK];
        while (enemy_sumorooks) {
            int sq = pop_lsb(enemy_sumorooks);
            int r = sq / 8, fc = sq % 8;
            int dirs[4][2] = {{1,0}, {-1,0}, {0,1}, {0,-1}};
            for (int i = 0; i < 4; i++) {
                int dr = dirs[i][0];
                int dc = dirs[i][1];
                int cur_r = r + dr;
                int cur_c = fc + dc;
                
                int hit_sq = -1;
                while (cur_r >= 0 && cur_r < 8 && cur_c >= 0 && cur_c < 8) {
                    int check_sq = cur_r * 8 + cur_c;
                    if (get_bit(b.occupancies[BOTH], check_sq)) {
                        hit_sq = check_sq;
                        break;
                    }
                    cur_r += dr;
                    cur_c += dc;
                }
                
                if (hit_sq != -1) {
                    int p1_type = b.get_piece_on_square(hit_sq);
                    if (p1_type == IRONPAWN) continue; // Cannot push Ironpawns
                    
                    int next_r = cur_r + dr;
                    int next_c = cur_c + dc;
                    bool push_valid = true;
                    int hit2_sq = -1;
                    
                    while (next_r >= 0 && next_r < 8 && next_c >= 0 && next_c < 8) {
                        int check2_sq = next_r * 8 + next_c;
                        if (get_bit(b.occupancies[BOTH], check2_sq)) {
                            hit2_sq = check2_sq;
                            break;
                        }
                        next_r += dr;
                        next_c += dc;
                    }
                    
                    if (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc))) {
                        int third_r = next_r + dr;
                        int third_c = next_c + dc;
                        if (third_r >= 0 && third_r < 8 && third_c >= 0 && third_c < 8) {
                            int third_sq = third_r * 8 + third_c;
                            if (get_bit(b.occupancies[BOTH], third_sq)) {
                                push_valid = false;
                            }
                        }
                    }
                    
                    if (push_valid && get_bit(b.occupancies[c], hit_sq)) {
                        // Our piece is the first target of an enemy SumoRook AND push is valid!
                        classical_score -= 30 * color_sign; // Apply danger penalty
                    }
                }
            }
        }
        // BASILISK: Paralyzing the King is a huge advantage!
        U64 basilisks = b.pieces[c][BASILISK];
        while (basilisks) {
            int sq = pop_lsb(basilisks);
            U64 attacks = get_sliding_attacks(sq, b.occupancies[BOTH], true, false);
            U64 enemy_king = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
            if (attacks & enemy_king) {
                // Massive bonus for paralyzing the enemy King
                classical_score += 300 * color_sign;
            }
            
            // Trap Strategy: Bonus for paralyzing other enemy pieces
            U64 paralyzed_enemies = attacks & b.occupancies[them];
            while (paralyzed_enemies) {
                int p_sq = pop_lsb(paralyzed_enemies);
                int p_type = PIECE_TYPE_NONE;
                for (int t = 0; t < PIECE_TYPE_COUNT; t++) {
                    if (get_bit(b.pieces[them][t], p_sq)) {
                        p_type = t;
                        break;
                    }
                }
                if (p_type != PIECE_TYPE_NONE && p_type != KING && p_type != ROCKETMAN) {
                    // Base bonus is 10% of the paralyzed piece's value
                    int trap_bonus = PIECE_VALUES[p_type] / 10;
                    
                    // Overextension Penalty: If the paralyzed enemy piece is in our territory, double the bonus!
                    int p_rank = p_sq / 8;
                    bool in_our_territory = (c == WHITE) ? (p_rank > 3) : (p_rank < 4);
                    if (in_our_territory) {
                        trap_bonus *= 2;
                        // Massive TRAP Strategy bonus for high-priority pieces (>= 500 value)
                        if (PIECE_VALUES[p_type] >= 500) {
                            trap_bonus += 150;
                        }
                    }
                    
                    classical_score += trap_bonus * color_sign;
                }
            }
        }
        
        // CARDINAL: Small mobility bonus for backward step ability
        U64 card = b.pieces[c][CARDINAL];
        while (card) {
            int sq = pop_lsb(card);
            int back = (c == WHITE) ? (sq - 8) : (sq + 8);
            if (back >= 0 && back < 64 && !get_bit(b.occupancies[BOTH], back)) {
                classical_score += 10 * color_sign; // Can retreat
            }
        }

        // ============================================================
        //  PHASE 3: QUEEN / FISSION REACTOR MOBILITY BONUS
        // ============================================================
        U64 q2 = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
        while (q2) {
            int qsq = pop_lsb(q2);
            U64 occ = b.occupancies[BOTH];
            U64 q_moves = get_sliding_attacks(qsq, occ, true, true);
            q_moves &= ~b.occupancies[c]; // Remove squares occupied by own pieces
            int mobility = popcount(q_moves);
            // +3cp per legal queen move (max ~27 moves)
            classical_score += mobility * 3 * color_sign;
        }
        
        // ============================================================
        //  PHASE 4: FISSION REACTOR COUNTDOWN BONUS (Fix 3)
        //  When captures >= 3, the nuke is almost ready. Bonus for proximity to enemy King.
        // ============================================================
        U64 fission_bb = b.pieces[c][FISSION_REACTOR];
        while (fission_bb) {
            int fsq = pop_lsb(fission_bb);
            int captures = b.ability_tracker[fsq].fission_captures;
            if (captures >= 3) {
                // Escalating bonus as it approaches detonation
                classical_score += captures * 200 * color_sign;
                
                // Proximity bonus: if enemy King is within 3 squares, nuclear strike imminent!
                U64 enemy_king = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
                if (enemy_king) {
                    int ksq = get_lsb(enemy_king);
                    int fr = fsq / 8, fc = fsq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = fr - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = fc - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c; // Chebyshev distance
                    if (dist <= 3) {
                        classical_score += 400 * color_sign; // Nuclear strike imminent!
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 5: PARALYSIS / FREEZE VALUE (Fix 5)
        //  Bonus for our Basilisks/Icicles paralyzing enemy pieces.
        // ============================================================
        U64 occ_all = b.occupancies[BOTH];
        
        // Basilisk: paralyzes all enemies in diagonal line of sight
        U64 our_basilisks = b.pieces[c][BASILISK];
        while (our_basilisks) {
            int bsq = pop_lsb(our_basilisks);
            U64 diag_vision = get_sliding_attacks(bsq, occ_all, true, false);
            U64 paralyzed_enemies = diag_vision & b.occupancies[them];
            int num_paralyzed = popcount(paralyzed_enemies);
            classical_score += num_paralyzed * 30 * color_sign;
        }
        
        // Icicle: freezes all adjacent enemies
        U64 our_icicles = b.pieces[c][ICICLE];
        while (our_icicles) {
            int isq = pop_lsb(our_icicles);
            U64 adj_squares = KING_ATTACKS[isq];
            U64 frozen_enemies = adj_squares & b.occupancies[them];
            int num_frozen = popcount(frozen_enemies);
            classical_score += num_frozen * 30 * color_sign;
        }
        
        // ============================================================
        //  PHASE 6: PILGRIM DISTANCE TRACKING (Fix 6)
        //  Continuous scaling bonus when Pilgrim is accumulating distance to resurrect a dead piece.
        // ============================================================
        U64 pilgrims = b.pieces[c][PILGRIM];
        while (pilgrims) {
            int psq = pop_lsb(pilgrims);
            if (!b.ability_tracker[psq].ability_used) {
                int dist = b.ability_tracker[psq].pilgrim_dist;
                bool has_dead_queen = b.dead_pieces_count[c][QUEEN] > 0;
                bool has_dead_rook = b.dead_pieces_count[c][ROOK] > 0;
                bool has_dead_minor = b.dead_pieces_count[c][BISHOP] > 0 || b.dead_pieces_count[c][KNIGHT] > 0;
                bool has_dead_pawn = b.dead_pieces_count[c][PAWN] > 0;
                
                int multiplier = 2; // Default baseline multiplier
                if (has_dead_queen) multiplier = 15;
                else if (has_dead_rook) multiplier = 10;
                else if (has_dead_minor) multiplier = 6;
                else if (has_dead_pawn) multiplier = 3;
                
                classical_score += dist * multiplier * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 6B: ENEMY PILGRIM TRACKING
        //  Penalize opponent's Pilgrim distance and reward threatening/attacking
        //  enemy Pilgrims that are close to resurrection.
        // ============================================================
        U64 enemy_pilgrims = b.pieces[them][PILGRIM];
        while (enemy_pilgrims) {
            int epsq = pop_lsb(enemy_pilgrims);
            if (!b.ability_tracker[epsq].ability_used) {
                int edist = b.ability_tracker[epsq].pilgrim_dist;
                bool enemy_dead_queen = b.dead_pieces_count[them][QUEEN] > 0;
                bool enemy_dead_rook = b.dead_pieces_count[them][ROOK] > 0;
                
                int emultiplier = 1;
                if (enemy_dead_queen) emultiplier = 6;
                else if (enemy_dead_rook) emultiplier = 4;
                
                // Penalize enemy's distance (which is a relative penalty of edist * emultiplier * color_sign)
                classical_score -= edist * emultiplier * color_sign;
                
                // If enemy Pilgrim is close to resurrection, reward us for attacking it!
                if (edist >= 10 && b.is_square_attacked(epsq, (Color)c)) {
                    classical_score += 100 * color_sign; // Extra incentive to target it!
                }
            }
        }
        
        // ============================================================
        //  PHASE 7: HORDE INTEGRITY PENALTY (Fix 7)
        //  If ANY Hordeling or the Horde Mother is hanging, the ENTIRE swarm is at risk.
        // ============================================================
        U64 horde_mother = b.pieces[c][HORDE_MOTHER];
        if (horde_mother) {
            int num_hordelings = popcount(b.pieces[c][HORDELING]);
            bool chain_death_risk = false;
            
            // Check if the Horde Mother herself is under attack (chain death!)
            int msq = get_lsb(horde_mother);
            if (b.is_square_attacked(msq, them)) {
                chain_death_risk = true;
            }
            
            // Check if any Hordeling is under attack
            if (!chain_death_risk) {
                U64 hordelings = b.pieces[c][HORDELING];
                while (hordelings) {
                    int hsq = pop_lsb(hordelings);
                    if (b.is_square_attacked(hsq, them)) {
                        chain_death_risk = true;
                        break;
                    }
                }
            }
            
            if (chain_death_risk && num_hordelings > 0) {
                // Losing ANY hordeling or the Mother kills the Mother + ALL hordelings
                classical_score -= (350 + num_hordelings * 100) * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 8: HERO PAWN CHECK PROXIMITY (Fix 8)
        //  If a Hero Pawn can deliver check, it instantly becomes a Queen!
        // ============================================================
        U64 hero_pawns = b.pieces[c][HERO_PAWN];
        while (hero_pawns) {
            int hsq = pop_lsb(hero_pawns);
            int hr = hsq / 8, hc = hsq % 8;
            int dir = (c == WHITE) ? 1 : -1;
            
            // Check if pawn attack squares can reach enemy King
            U64 enemy_king = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
            if (enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                
                // Pawn attacks diagonally forward
                int attack_r = hr + dir;
                if (attack_r >= 0 && attack_r < 8) {
                    if ((hc - 1 >= 0 && attack_r == kr && hc - 1 == kc) ||
                        (hc + 1 < 8  && attack_r == kr && hc + 1 == kc)) {
                        // Hero Pawn can check the King = instant Queen promotion!
                        classical_score += 200 * color_sign;
                    }
                }
                
                // Also bonus for being within 2 squares of King (close to check range)
                int dist_r = hr - kr; if (dist_r < 0) dist_r = -dist_r;
                int dist_c = hc - kc; if (dist_c < 0) dist_c = -dist_c;
                if (dist_r <= 2 && dist_c <= 2) {
                    classical_score += 50 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 9: ELECTROKNIGHT CHARGE BONUS
        //  When fully charged, it can chain-lightning a nearby high-value piece on its next capture.
        // ============================================================
        U64 electroknights = b.pieces[c][ELECTROKNIGHT];
        while (electroknights) {
            int esq = pop_lsb(electroknights);
            int charges = b.ability_tracker[esq].electro_charges;
            if (charges >= 2) {
                // Charged and dangerous — bonus if near enemy clusters
                classical_score += charges * 40 * color_sign;
                
                // Proximity bonus: if enemy King is within 3 squares, zap imminent!
                U64 enemy_king = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
                if (enemy_king) {
                    int ksq = get_lsb(enemy_king);
                    int er = esq / 8, ec = esq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = er - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = ec - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c; // Chebyshev distance
                    if (dist <= 3) {
                        classical_score += 300 * color_sign; // Zap imminent!
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 10: BLADERUNNER PATH BONUS
        //  Bonus for Bladerunner on diagonals with multiple enemy pieces (can destroy all in path).
        // ============================================================
        U64 bladerunners = b.pieces[c][BLADERUNNER];
        while (bladerunners) {
            int bsq = pop_lsb(bladerunners);
            // Bladerunner slides through enemies using OUR pieces as blockers
            U64 blade_vision = get_sliding_attacks(bsq, b.occupancies[c], true, false);
            U64 doomed_enemies = blade_vision & b.occupancies[them];
            int num_doomed = popcount(doomed_enemies);
            if (num_doomed >= 2) {
                // Multi-kill potential!
                classical_score += num_doomed * 80 * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 11: KNIGHTMARE LIMBO BONUS & TRAP DETECTION
        //  Dynamic Threat & Trapping Evaluation for Off-board Knightmares
        // ============================================================
        if (b.num_knightmares_limbo[c] > 0) {
            // Restore Base Material Value!
            classical_score += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
            
            int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
            for (int i = 0; i < b.num_knightmares_limbo[c]; i++) {
                uint8_t encoded = b.knightmare_limbo_coords[c][i];
                int ob_r = (encoded >> 4) - 2;
                int ob_c = (encoded & 0xF) - 2;
                
                int safe_landing_squares = 0;
                bool threatens_high_value = false;
                
                for (int d = 0; d < 8; d++) {
                    int nr = ob_r + km_dirs[d][0];
                    int nc = ob_c + km_dirs[d][1];
                    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                        int to_sq = nr * 8 + nc;
                        
                        // Check if this landing square is safe (not attacked by enemy pawns/bishops/rooks/knights)
                        // A simplified trap detection: is this square attacked by ANY enemy piece?
                        if (!b.is_square_attacked(to_sq, them)) {
                            safe_landing_squares++;
                        }
                        
                        // Check what it threatens
                        if (get_bit(b.pieces[them][KING], to_sq) || 
                            get_bit(b.pieces[them][QUEEN], to_sq) ||
                            get_bit(b.pieces[them][ROCKETMAN], to_sq) ||
                            get_bit(b.pieces[them][PHASE_ROOK], to_sq)) {
                            threatens_high_value = true;
                        }
                    }
                }
                
                if (safe_landing_squares == 0) {
                    // TRAPPED! The Knightmare cannot land anywhere safely!
                    classical_score -= 150 * color_sign;
                } else {
                    // Has safe landings, apply baseline positional pressure based on mobility
                    classical_score += (20 + 10 * safe_landing_squares) * color_sign;
                }
                
                if (threatens_high_value) {
                    // Massive bonus for keeping a high-value piece in check from Limbo
                    classical_score += 150 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 12: GOLDEN PAWN ADVANCEMENT (Fix 8)
        //  Golden Pawn wins the game instantly upon reaching the final rank.
        // ============================================================
        U64 golden_pawns = b.pieces[c][GOLDEN_PAWN];
        while (golden_pawns) {
            int gsq = pop_lsb(golden_pawns);
            int rank = gsq / 8;
            int dist_to_prom = (c == WHITE) ? (7 - rank) : rank;
            
            if (dist_to_prom == 4) classical_score += 100 * color_sign;
            else if (dist_to_prom == 3) classical_score += 250 * color_sign;
            else if (dist_to_prom == 2) classical_score += 500 * color_sign;
            else if (dist_to_prom == 1) classical_score += 1000 * color_sign;
        }
        
        // ============================================================
        //  PHASE 13: SHRIKE TRAP BONUS
        //  Bonus for keeping an unmoved Shrike in its starting position to act as an area-denial trap.
        // ============================================================
        U64 shrikes = b.pieces[c][SHRIKE];
        while (shrikes) {
            int s_sq = pop_lsb(shrikes);
            int r = s_sq / 8;
            if ((c == WHITE && r == 1) || (c == BLACK && r == 6)) {
                classical_score += 40 * color_sign; // Patience bonus: Keep the Shrike loaded!
            }
        }

        // ============================================================
        //  PHASE 14: DEFENSIVE AWARENESS
        //  Penalty for own high-value pieces in enemy Bladerunner diagonals
        //  and enemy Marauder range. Bonus for own Bouncer threatening enemies.
        // ============================================================
        
        // Enemy Bladerunner diagonal threat
        U64 enemy_bladerunners = b.pieces[them][BLADERUNNER];
        while (enemy_bladerunners) {
            int bsq = pop_lsb(enemy_bladerunners);
            // Use our own pieces as blockers (Bladerunner passes through enemies)
            U64 blade_vision = get_sliding_attacks(bsq, b.occupancies[them], true, false);
            U64 our_threatened = blade_vision & b.occupancies[c];
            while (our_threatened) {
                int tsq = pop_lsb(our_threatened);
                int t_type = b.get_piece_on_square(tsq);
                if (t_type != PIECE_TYPE_NONE && PIECE_VALUES[t_type] >= 500) {
                    classical_score -= 60 * color_sign; // High-value piece in blade path!
                }
            }
        }
        
        // Enemy Marauder expanding range threat
        U64 enemy_marauders = b.pieces[them][MARAUDER];
        while (enemy_marauders) {
            int msq = pop_lsb(enemy_marauders);
            int kills = b.ability_tracker[msq].marauder_kills;
            int max_range = 1 + kills * 2;
            if (max_range >= 3) {
                // Dangerous marauder — penalty for our King proximity
                U64 our_king = b.pieces[c][KING] | b.pieces[c][ROCKETMAN];
                if (our_king) {
                    int ksq = get_lsb(our_king);
                    int mr = msq / 8, mc = msq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = mr - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = mc - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c;
                    if (dist <= max_range) {
                        classical_score -= 200 * color_sign; // King in marauder range!
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 8: MATING NET / MOP-UP HEURISTICS (Endgame Optimization)
        //  Encourages driving the enemy King to the edges/corners, and bringing
        //  our King close to trap them only after analyzing remaining enemy threat/danger.
        // ============================================================
        int enemy_pieces_count = 0;
        for (int pt = 0; pt < 39; pt++) {
            enemy_pieces_count += popcount(b.pieces[them][pt]);
        }
        
        if (enemy_pieces_count <= 8) {
            U64 our_king_bb = b.pieces[c][KING] | b.pieces[c][ROCKETMAN];
            U64 enemy_king_bb = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
            
            if (our_king_bb && enemy_king_bb) {
                int our_king_sq = get_lsb(our_king_bb);
                int enemy_king_sq = get_lsb(enemy_king_bb);
                
                int ek_r = enemy_king_sq / 8;
                int ek_c = enemy_king_sq % 8;
                int ok_r = our_king_sq / 8;
                int ok_c = our_king_sq % 8;
                
                // 1. Push enemy king to the corners/edges (always safe and encouraged)
                int dist_to_center_r = std::max(3 - ek_r, ek_r - 4);
                int dist_to_center_c = std::max(3 - ek_c, ek_c - 4);
                int corner_dist = dist_to_center_r + dist_to_center_c; // 0 (center) to 6 (corners)
                
                // Only reward mop-up if we have a material advantage
                int our_material = 0;
                int enemy_material = 0;
                for (int pt = 0; pt < 39; pt++) {
                    our_material += popcount(b.pieces[c][pt]) * PIECE_VALUES[pt];
                    enemy_material += popcount(b.pieces[them][pt]) * PIECE_VALUES[pt];
                }
                
                if (our_material > enemy_material + 200) {
                    // Always reward cornering the enemy King
                    classical_score += corner_dist * 20 * color_sign;
                    
                    // Analyze danger of left enemy pieces before bringing our King closer
                    bool enemy_has_queen = b.pieces[them][QUEEN] > 0 || b.pieces[them][FISSION_REACTOR] > 0;
                    bool enemy_has_rook = b.pieces[them][ROOK] > 0 || b.pieces[them][PHASE_ROOK] > 0 || b.pieces[them][SUMOROOK] > 0;
                    
                    // Dangerous if they have a Queen/Reactor, or a Rook with other pieces
                    bool king_danger = enemy_has_queen || (enemy_has_rook && enemy_pieces_count > 3);
                    
                    if (!king_danger || (our_material > enemy_material + 600)) {
                        int king_dist = std::abs(ek_r - ok_r) + std::abs(ek_c - ok_c); // 1 to 14
                        classical_score += (14 - king_dist) * 15 * color_sign;
                    }
                }
            }
        }
        
        // Own Bouncer threatening enemies via bounce-rays
        U64 our_bouncers = b.pieces[c][BOUNCER];
        while (our_bouncers) {
            int bsq = pop_lsb(our_bouncers);
            int br = bsq / 8, bc = bsq % 8;
            int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
            for (int d = 0; d < 4; d++) {
                int cr = br, cc = bc;
                int dr = dirs[d][0], dc = dirs[d][1];
                bool bounced = false;
                while (true) {
                    int nr = cr + dr, nc = cc + dc;
                    if (nr < 0 || nr > 7) {
                        if (bounced) break;
                        dr = -dr; bounced = true; nr = cr + dr;
                    }
                    if (nc < 0 || nc > 7) {
                        if (bounced) break;
                        dc = -dc; bounced = true; nc = cc + dc;
                    }
                    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) break;
                    int nsq = nr * 8 + nc;
                    if (get_bit(b.occupancies[c], nsq)) break;
                    if (get_bit(b.occupancies[them], nsq)) {
                        int t_type = b.get_piece_on_square(nsq);
                        if (t_type != PIECE_TYPE_NONE && PIECE_VALUES[t_type] >= 300) {
                            classical_score += 25 * color_sign; // Bouncer threatens valuable enemy
                        }
                        break;
                    }
                    cr = nr; cc = nc;
                }
            }
        }

        // ============================================================
        //  PHASE 15: PAWN POWER PIECES UTILIZATION
        // ============================================================
        // PAWN_KNIFE: Threat bonus if an enemy is in its strike zone (dx=±2, dy=2 forward)
        U64 pawn_knives = b.pieces[c][PAWN_KNIFE];
        while (pawn_knives) {
            int sq = pop_lsb(pawn_knives);
            int r = sq / 8, fc = sq % 8;
            int dir = (c == WHITE) ? -1 : 1;
            int targets_found = 0;
            int dc_offsets[2] = {-2, 2};
            for (int i = 0; i < 2; i++) {
                int er = r + (dir * 2);
                int ec = fc + dc_offsets[i];
                if (er >= 0 && er <= 7 && ec >= 0 && ec <= 7) {
                    int esq = er * 8 + ec;
                    if (get_bit(b.occupancies[them], esq)) {
                        int e_type = b.get_piece_on_square(esq);
                        if (e_type != IRONPAWN) targets_found++;
                    }
                }
            }
            if (targets_found > 0) classical_score += targets_found * 75 * color_sign;
        }

        // HERO_PAWN: Scaling bonus the closer it gets to enemy King
        U64 hero_pawns_prox = b.pieces[c][HERO_PAWN];
        while (hero_pawns_prox) {
            int sq = pop_lsb(hero_pawns_prox);
            int r = sq / 8, fc = sq % 8;
            U64 enemy_king = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
            if (enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                int dist_r = std::abs(r - kr);
                int dist_c = std::abs(fc - kc);
                int dist = std::max(dist_r, dist_c);
                int proximity_bonus = std::max(0, 6 - dist);
                classical_score += proximity_bonus * 40 * color_sign;
            }
        }

        // WARP_JUMPER: Heavy progression bonus on A/H files
        U64 warp_jumpers = b.pieces[c][WARP_JUMPER];
        while (warp_jumpers) {
            int sq = pop_lsb(warp_jumpers);
            int r = sq / 8, fc = sq % 8;
            int wp_rank = (c == WHITE) ? (7 - r) : r;
            if (fc == 0 || fc == 7) {
                classical_score += wp_rank * 40 * color_sign; // Fast track to promotion
            } else {
                classical_score += wp_rank * 10 * color_sign;
            }
        }

        // WAR_AUTOMATON: Bonus if safely waiting behind own pieces
        U64 war_automatons = b.pieces[c][WAR_AUTOMATON];
        while (war_automatons) {
            int sq = pop_lsb(war_automatons);
            int r = sq / 8, fc = sq % 8;
            int front_row = (c == WHITE) ? r - 1 : r + 1;
            if (front_row >= 0 && front_row <= 7) {
                int front_sq = front_row * 8 + fc;
                if (get_bit(b.occupancies[c], front_sq)) {
                    classical_score += 60 * color_sign; // Shielded
                }
            }
        }

        // EPEE_PAWN: Bonus based on how many enemy pawns are left (early/midgame presence)
        U64 epee_pawns = b.pieces[c][EPEE_PAWN];
        while (epee_pawns) {
            int sq = pop_lsb(epee_pawns);
            int enemy_pawns = popcount(b.pieces[them][PAWN]);
            classical_score += enemy_pawns * 10 * color_sign;
        }

        // ============================================================
        //  PHASE 16: BASILISK PARALYSIS THREATS
        // ============================================================
        U64 phase16_our_basilisks = b.pieces[c][BASILISK];
        U64 phase16_their_basilisks = b.pieces[them][BASILISK];
        
        if (phase16_our_basilisks || phase16_their_basilisks) {
            U64 paralyzed_by_us = 0ULL;
            U64 temp_ob = phase16_our_basilisks;
            while (temp_ob) {
                int sq = pop_lsb(temp_ob);
                paralyzed_by_us |= get_sliding_attacks(sq, b.occupancies[BOTH], true, false);
            }
            
            U64 paralyzed_by_them = 0ULL;
            U64 temp_tb = phase16_their_basilisks;
            while (temp_tb) {
                int sq = pop_lsb(temp_tb);
                paralyzed_by_them |= get_sliding_attacks(sq, b.occupancies[BOTH], true, false);
            }
            
            // 1. Enemy High-Value Targets Paralyzed
            U64 enemy_queens = b.pieces[them][QUEEN] | b.pieces[them][FISSION_REACTOR];
            while (enemy_queens) {
                int sq = pop_lsb(enemy_queens);
                if (get_bit(paralyzed_by_us, sq)) {
                    classical_score += 500 * color_sign; // Queen Paralyzed
                    if (b.is_square_attacked(sq, (Color)c)) {
                        classical_score += 400 * color_sign; // And attacked!
                    }
                }
            }
            
            U64 enemy_kings = b.pieces[them][KING] | b.pieces[them][ROCKETMAN];
            while (enemy_kings) {
                int sq = pop_lsb(enemy_kings);
                if (get_bit(paralyzed_by_us, sq)) {
                    classical_score += 800 * color_sign; // King Paralyzed
                    if (b.is_square_attacked(sq, (Color)c)) {
                        classical_score += 2000 * color_sign; // Checkmate threat!
                    }
                }
            }
            
            // 2. Our High-Value Targets Paralyzed
            U64 our_queens = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
            while (our_queens) {
                int sq = pop_lsb(our_queens);
                if (get_bit(paralyzed_by_them, sq)) {
                    classical_score -= 500 * color_sign; 
                    if (b.is_square_attacked(sq, (Color)them)) {
                        classical_score -= 400 * color_sign; 
                    }
                }
            }
            
            U64 our_kings = b.pieces[c][KING] | b.pieces[c][ROCKETMAN];
            while (our_kings) {
                int sq = pop_lsb(our_kings);
                if (get_bit(paralyzed_by_them, sq)) {
                    classical_score -= 800 * color_sign;
                    if (b.is_square_attacked(sq, (Color)them)) {
                        classical_score -= 2000 * color_sign;
                    }
                }
            }
        }
    }
    
    int relative_classical = (b.side_to_move == WHITE) ? classical_score : -classical_score;
    int final_score = relative_classical + nnue_score;
    return final_score;
}
