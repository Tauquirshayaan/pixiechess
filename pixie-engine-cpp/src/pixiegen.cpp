#include "pixiegen.h"
#include "rays.h"

void generate_pixie_moves(const Board& b, MoveList& list) {
    Color us = b.side_to_move;
    Color them = (us == WHITE) ? BLACK : WHITE;
    
    U64 invulnerable = b.pieces[WHITE][IRONPAWN] | b.pieces[BLACK][IRONPAWN];
    
    U64 our_pieces = b.occupancies[us] | invulnerable;
    U64 enemy_pieces = b.occupancies[them] & ~invulnerable;
    U64 all_pieces = b.occupancies[BOTH];
    U64 empty_squares = ~all_pieces;

    // Calculate Auras (Paralysis & Freeze)
    U64 paralyzed_squares = 0ULL;
    U64 enemy_basilisks = b.pieces[them][BASILISK];
    while (enemy_basilisks) {
        int b_sq = pop_lsb(enemy_basilisks);
        paralyzed_squares |= get_sliding_attacks(b_sq, all_pieces, true, false);
    }
    // (Icicle only freezes via consecutive turns, which is handled via ability_tracker.frozen_turns)
    
    // Explicitly Frozen Pieces (from ability tracker)
    for (int sq = 0; sq < 64; ++sq) {
        if (b.ability_tracker[sq].frozen_turns > 0) {
            paralyzed_squares |= (1ULL << sq);
        }
    }

    // Anti-Violence Aura: pieces in this aura CANNOT capture
    U64 av_aura = 0ULL;
    U64 enemy_av = b.pieces[them][ANTI_VIOLENCE];
    while (enemy_av) {
        int av_sq = pop_lsb(enemy_av);
        av_aura |= KING_ATTACKS[av_sq];
    }

    // 1. PHASE ROOK (Moves to any empty square in its row/col, but only captures if no pieces are between it and the target)
    U64 phase_rooks = b.pieces[us][PHASE_ROOK] & ~paralyzed_squares;
    while (phase_rooks) {
        int sq = pop_lsb(phase_rooks);
        
        U64 all_targets = get_sliding_attacks(sq, 0ULL, false, true);
        U64 normal_targets = get_sliding_attacks(sq, b.occupancies[BOTH], false, true);
        
        U64 empty_targets = all_targets & ~b.occupancies[BOTH];
        U64 valid_captures = normal_targets & enemy_pieces;
        
        // Anti-Violence: if this piece is in the aura, it cannot capture
        if (get_bit(av_aura, sq)) valid_captures = 0ULL;
        
        while (empty_targets) {
            int to_sq = pop_lsb(empty_targets);
            list.add(Move(sq, to_sq, PHASE_ROOK, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
        
        while (valid_captures) {
            int to_sq = pop_lsb(valid_captures);
            int captured_piece = b.get_piece_on_square(to_sq);
            list.add(Move(sq, to_sq, PHASE_ROOK, captured_piece, PIECE_TYPE_NONE, true, true));
        }
    }

    // 2. BLADERUNNER (Diagonal ray slides through EVERYTHING, damages all)
    U64 bladerunners = b.pieces[us][BLADERUNNER] & ~paralyzed_squares;
    while (bladerunners) {
        int sq = pop_lsb(bladerunners);
        // CRITICAL: our_pieces as blockers. It slides through enemy pieces but stops at friendly.
        U64 attacks = get_sliding_attacks(sq, our_pieces, true, false);
        
        // Cannot land on ANY piece (kills ONLY by passing through)
        attacks &= ~all_pieces;
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            // Note: True Bladerunner logic marks pieces doomed. In move gen, it can just slide anywhere empty or capture the landing square.
            int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
            list.add(Move(sq, to_sq, BLADERUNNER, captured_piece, PIECE_TYPE_NONE, is_capture, true));
        }
    }

    // 3. SHRIKE (First move 2-step capturing move)
    U64 shrikes = b.pieces[us][SHRIKE] & ~paralyzed_squares;
    while (shrikes) {
        int sq = pop_lsb(shrikes);
        int r = sq / 8;
        int c = sq % 8;
        int dir = (us == WHITE) ? 1 : -1;
        
        // 3. First move 2 steps forward
        int start_row = (us == WHITE) ? 1 : 6;
        if (r == start_row) {
            int mid_r = r + dir;
            int to_r = r + 2 * dir;
            int mid_sq = mid_r * 8 + c;
            int to_sq = to_r * 8 + c;
            
            bool mid_has_piece = get_bit(all_pieces, mid_sq);
            bool to_has_piece = get_bit(all_pieces, to_sq);
            
            if (!get_bit(our_pieces, to_sq)) {
                if (mid_has_piece && !to_has_piece) {
                    if (get_bit(enemy_pieces, mid_sq)) {
                        if (!get_bit(av_aura, sq)) {
                            // promoted=0 means capture is on the MID square
                            list.add(Move(sq, to_sq, SHRIKE, b.get_piece_on_square(mid_sq), 0, true, true));
                        }
                    }
                } else if (to_has_piece && !mid_has_piece) {
                    if (get_bit(enemy_pieces, to_sq)) {
                        if (!get_bit(av_aura, sq)) {
                            // promoted=1 means capture is on the DESTINATION square
                            list.add(Move(sq, to_sq, SHRIKE, b.get_piece_on_square(to_sq), 1, true, true));
                        }
                    }
                }
            }
        }
    }

    // 3.5 IRONPAWN
    U64 ironpawns = b.pieces[us][IRONPAWN] & ~paralyzed_squares;
    if (us == WHITE) {
        U64 single_pushes = (ironpawns << 8) & empty_squares & ~0xFF00000000000000ULL;
        while (single_pushes) {
            int to_sq = pop_lsb(single_pushes);
            list.add(Move(to_sq - 8, to_sq, IRONPAWN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
            
            // Double push?
            int sq = to_sq - 8;
            if (sq >= 8 && sq <= 15) { // Rank 2 for White
                int to_sq2 = to_sq + 8;
                if (get_bit(empty_squares, to_sq2)) {
                    list.add(Move(sq, to_sq2, IRONPAWN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                }
            }
        }
    } else {
        U64 single_pushes = (ironpawns >> 8) & empty_squares & ~0x00000000000000FFULL;
        while (single_pushes) {
            int to_sq = pop_lsb(single_pushes);
            list.add(Move(to_sq + 8, to_sq, IRONPAWN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
            
            // Double push?
            int sq = to_sq + 8;
            if (sq >= 48 && sq <= 55) { // Rank 7 for Black
                int to_sq2 = to_sq - 8;
                if (get_bit(empty_squares, to_sq2)) {
                    list.add(Move(sq, to_sq2, IRONPAWN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                }
            }
        }
    }

    // 4. CAMEL ((3,1) and (1,3) leaps)
    U64 camels = b.pieces[us][CAMEL] & ~paralyzed_squares;
    while (camels) {
        int sq = pop_lsb(camels);
        int r = sq / 8;
        int c = sq % 8;
        
        int offsets[8][2] = {{3,1}, {3,-1}, {-3,1}, {-3,-1}, {1,3}, {1,-3}, {-1,3}, {-1,-3}};
        for (int i = 0; i < 8; i++) {
            int nr = r + offsets[i][0];
            int nc = c + offsets[i][1];
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                int to_sq = nr * 8 + nc;
                if (!get_bit(our_pieces, to_sq)) {
                    bool is_cap = get_bit(enemy_pieces, to_sq);
                    if (is_cap && get_bit(av_aura, sq)) continue;
                    list.add(Move(sq, to_sq, CAMEL, is_cap ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE, PIECE_TYPE_NONE, is_cap, false));
                }
            }
        }
    }

    // 5. ANTI-VIOLENCE (Knight that cannot capture)
    U64 anti_v = b.pieces[us][ANTI_VIOLENCE] & ~paralyzed_squares;
    while (anti_v) {
        int sq = pop_lsb(anti_v);
        U64 attacks = KNIGHT_ATTACKS[sq] & ~all_pieces; // Cannot capture ANY piece
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            list.add(Move(sq, to_sq, ANTI_VIOLENCE, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
    }

    // 6. ICICLE (Bishop that cannot capture)
    U64 icicles = b.pieces[us][ICICLE] & ~paralyzed_squares;
    while (icicles) {
        int sq = pop_lsb(icicles);
        U64 attacks = get_sliding_attacks(sq, all_pieces, true, false);
        attacks &= ~all_pieces; // Cannot capture
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            list.add(Move(sq, to_sq, ICICLE, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
    }

    // 7. MARAUDER (Dynamic sliding range in 8 directions based on kills)
    U64 marauders = b.pieces[us][MARAUDER] & ~paralyzed_squares;
    while (marauders) {
        int sq = pop_lsb(marauders);
        int kills = b.ability_tracker[sq].marauder_kills;
        int max_range = 1 + (kills * 2);
        bool marauder_in_aura = get_bit(av_aura, sq);
        
        int r = sq / 8;
        int c = sq % 8;
        
        int dirs[8][2] = {{-1,0},{1,0},{0,-1},{0,1},{-1,-1},{-1,1},{1,-1},{1,1}};
        
        for (int i = 0; i < 8; i++) {
            for (int step = 1; step <= max_range; step++) {
                int cr = r + dirs[i][0] * step;
                int cc = c + dirs[i][1] * step;
                if (cr < 0 || cr > 7 || cc < 0 || cc > 7) break;
                
                int target_sq = cr * 8 + cc;
                if (get_bit(our_pieces, target_sq)) {
                    break; // Blocked by friendly
                }
                
                if (get_bit(enemy_pieces, target_sq)) {
                    if (!marauder_in_aura) {
                        int captured_piece = b.get_piece_on_square(target_sq);
                        list.add(Move(sq, target_sq, MARAUDER, captured_piece, PIECE_TYPE_NONE, true, false));
                    }
                    break; // Blocked by enemy (can capture if not in aura)
                }
                list.add(Move(sq, target_sq, MARAUDER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
            }
        }
    }
    
    // --- BOUNCER ---
    U64 bouncers = b.pieces[us][BOUNCER] & ~paralyzed_squares;
    while (bouncers) {
        int sq = pop_lsb(bouncers);
        int r = sq / 8;
        int c = sq % 8;
        bool bouncer_in_aura = get_bit(av_aura, sq);
        int directions[4][2] = {{-1, -1}, {-1, 1}, {1, -1}, {1, 1}};
        
        for (int i = 0; i < 4; i++) {
            int dr = directions[i][0];
            int dc = directions[i][1];
            int curr_r = r + dr;
            int curr_c = c + dc;
            bool has_bounced = false;
            
            while (true) {
                if (curr_r < 0 || curr_r > 7 || curr_c < 0 || curr_c > 7) {
                    if (has_bounced) break;
                    has_bounced = true;
                    curr_r -= dr;
                    curr_c -= dc;
                    if (curr_r <= 0 || curr_r >= 7) dr = -dr;
                    if (curr_c <= 0 || curr_c >= 7) dc = -dc;
                    curr_r += dr;
                    curr_c += dc;
                    if (curr_r < 0 || curr_r > 7 || curr_c < 0 || curr_c > 7) break;
                }
                
                int target_sq = curr_r * 8 + curr_c;
                if (get_bit(our_pieces, target_sq)) break;
                
                if (get_bit(enemy_pieces, target_sq)) {
                    if (!bouncer_in_aura) {
                        int captured_piece = b.get_piece_on_square(target_sq);
                        list.add(Move(sq, target_sq, BOUNCER, captured_piece, PIECE_TYPE_NONE, true, false));
                    }
                    break;
                }
                
                list.add(Move(sq, target_sq, BOUNCER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                curr_r += dr;
                curr_c += dc;
            }
        }
    }
    
    // --- DJINN DISSIPATE ---
    U64 djinns = b.pieces[us][DJINN] & ~paralyzed_squares;
    while (djinns) {
        int sq = pop_lsb(djinns);
        // Only generate dissipate if not already dissipated
        if (!b.ability_tracker[sq].djinn_dissipated) {
            // Encode dissipate as a move from sq to sq with is_ability = true
            list.add(Move(sq, sq, DJINN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
    }
    
    // --- GUNSLINGER DUEL ---
    U64 gunslingers = b.pieces[us][GUNSLINGER] & ~paralyzed_squares;
    while (gunslingers) {
        int sq = pop_lsb(gunslingers);
        if (b.ability_tracker[sq].gunslinger_mutual_ply >= 2) {
            list.add(Move(sq, sq, GUNSLINGER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, true, true));
        }
    }
    
    // --- KNIGHTMARE LIMBO JUMPS ---
    int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
    U64 knightmares = b.pieces[us][KNIGHTMARE] & ~paralyzed_squares;
    while (knightmares) {
        int sq = pop_lsb(knightmares);
        int r = sq / 8;
        int c = sq % 8;
        
        for (int i = 0; i < 8; i++) {
            int tr = r + km_dirs[i][0];
            int tc = c + km_dirs[i][1];
            if (tr < 0 || tr > 7 || tc < 0 || tc > 7) {
                if (tr >= -2 && tr <= 9 && tc >= -2 && tc <= 9) {
                    list.add(Move(sq, sq, KNIGHTMARE, PIECE_TYPE_NONE, i, false, true));
                }
            }
        }
    }
    
    // --- KNIGHTMARE LIMBO DROPS ---
    for (int idx = 0; idx < b.num_knightmares_limbo[us]; idx++) {
        int8_t encoded = b.knightmare_limbo_coords[us][idx];
        int ob_r = (encoded >> 4) - 2;
        int ob_c = (encoded & 0xF) - 2;
        
        for (int i = 0; i < 8; i++) {
            int tr = ob_r + km_dirs[i][0];
            int tc = ob_c + km_dirs[i][1];
            if (tr >= 0 && tr <= 7 && tc >= 0 && tc <= 7) {
                int to_sq = tr * 8 + tc;
                if (!get_bit(our_pieces, to_sq)) {
                    bool is_capture = get_bit(enemy_pieces, to_sq);
                    int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
                    list.add(Move(to_sq, to_sq, KNIGHTMARE, captured_piece, idx, is_capture, false));
                }
            }
        }
    }
    
    // --- ROCKETMAN TELEPORT ---
    U64 rocketmen = b.pieces[us][ROCKETMAN] & ~paralyzed_squares;
    while (rocketmen) {
        int sq = pop_lsb(rocketmen);
        if (!b.ability_tracker[sq].ability_used) {
            U64 empties = empty_squares;
            while (empties) {
                int to_sq = pop_lsb(empties);
                list.add(Move(sq, to_sq, ROCKETMAN, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
            }
        }
    }
    
    // --- FISH KNIGHT BONUS STEP ---
    U64 fish_knights = b.pieces[us][FISH_KNIGHT] & ~paralyzed_squares;
    while (fish_knights) {
        int sq = pop_lsb(fish_knights);
        bool moved_last_turn = b.ability_tracker[sq].fish_moved;
        // In live game, we can also check the history directly as a fallback if PFEN didn't set it
        if (!moved_last_turn && b.ply > 0 && b.history[b.ply - 1].last_move_dest_sq == sq) {
            moved_last_turn = true;
        }
        
        if (moved_last_turn) {
            U64 bonus_targets = KING_ATTACKS[sq] & empty_squares;
            while (bonus_targets) {
                int to_sq = pop_lsb(bonus_targets);
                list.add(Move(sq, to_sq, FISH_KNIGHT, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
            }
        }
    }
    
    // --- HORDE MOTHER ---
    U64 horde_mothers = b.pieces[us][HORDE_MOTHER] & ~paralyzed_squares;
    while (horde_mothers) {
        int sq = pop_lsb(horde_mothers);
        U64 attacks = get_sliding_attacks(sq, all_pieces, true, false) & ~our_pieces;
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            if (is_capture) {
                int captured_piece = b.get_piece_on_square(to_sq);
                U64 empties = empty_squares;
                bool spawn_generated = false;
                while (empties) {
                    int spawn_sq = pop_lsb(empties);
                    list.add(Move(sq, to_sq, HORDE_MOTHER, captured_piece, spawn_sq, true, false));
                    spawn_generated = true;
                }
                if (!spawn_generated) {
                    list.add(Move(sq, to_sq, HORDE_MOTHER, captured_piece, PIECE_TYPE_NONE, true, false));
                }
            } else {
                list.add(Move(sq, to_sq, HORDE_MOTHER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
            }
        }
    }

    // --- CARDINAL BACKWARDS STEP ---
    U64 cardinals = b.pieces[us][CARDINAL] & ~paralyzed_squares;
    while (cardinals) {
        int sq = pop_lsb(cardinals);
        int back_step = (us == WHITE) ? (sq - 8) : (sq + 8);
        if (back_step >= 0 && back_step < 64 && !get_bit(all_pieces, back_step)) {
            list.add(Move(sq, back_step, CARDINAL, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
        }
    }
    
    // --- EPEE PAWN SNIPER EP ---
    U64 epee_pawns = b.pieces[us][EPEE_PAWN] & ~paralyzed_squares;
    if (epee_pawns && b.en_passant_sq != NO_SQ) {
        int ep_sq = b.en_passant_sq;
        int cap_sq = (us == WHITE) ? (ep_sq - 8) : (ep_sq + 8);
        int captured = b.get_piece_on_square(cap_sq);
        if (captured != PIECE_TYPE_NONE && captured != IRONPAWN) {
            while (epee_pawns) {
                int sq = pop_lsb(epee_pawns);
                list.add(Move(sq, ep_sq, EPEE_PAWN, captured, PIECE_TYPE_NONE, true, true));
            }
        }
    }
    
    // --- PAWN KNIFE JUMP ---
    U64 pawn_knives = b.pieces[us][PAWN_KNIFE] & ~paralyzed_squares;
    while (pawn_knives) {
        int sq = pop_lsb(pawn_knives);
        int r = sq / 8;
        int c = sq % 8;
        int dir = (us == WHITE) ? 1 : -1;
        int extended_r = r + 2 * dir;
        
        int dcs[2] = {-2, 2};
        for (int i = 0; i < 2; i++) {
            int dc = dcs[i];
            int cc = c + dc;
            if (extended_r >= 0 && extended_r <= 7 && cc >= 0 && cc <= 7) {
                int intermediate_sq = (r + dir) * 8 + (c + dc / 2);
                if (!get_bit(all_pieces, intermediate_sq)) {
                    int target_sq = extended_r * 8 + cc;
                    if (get_bit(enemy_pieces, target_sq)) {
                        bool toward_center = (dc < 0) ? (c > 3) : (c < 4);
                        if (toward_center) {
                            int promo_row = (us == WHITE) ? 7 : 0;
                            int captured = b.get_piece_on_square(target_sq);
                            if (extended_r == promo_row && b.pieces[them][ARISTOCRAT] == 0) {
                                list.add(Move(sq, target_sq, PAWN_KNIFE, captured, QUEEN, true, false));
                                list.add(Move(sq, target_sq, PAWN_KNIFE, captured, ROOK, true, false));
                                list.add(Move(sq, target_sq, PAWN_KNIFE, captured, BISHOP, true, false));
                                list.add(Move(sq, target_sq, PAWN_KNIFE, captured, KNIGHT, true, false));
                            } else {
                                list.add(Move(sq, target_sq, PAWN_KNIFE, captured, PIECE_TYPE_NONE, true, false));
                            }
                        }
                    }
                }
            }
        }
    }
    
    // --- WARP JUMPER ---
    U64 warp_jumpers = b.pieces[us][WARP_JUMPER] & ~paralyzed_squares;
    U64 pawns_and_pixies = b.pieces[WHITE][PAWN] | b.pieces[BLACK][PAWN];
    int pawn_types[] = {GOLDEN_PAWN, IRONPAWN, BLUEPRINT, EPEE_PAWN, PAWN_KNIFE, HERO_PAWN, SHRIKE, WARP_JUMPER, WAR_AUTOMATON};
    for (int i=0; i<9; i++) {
        pawns_and_pixies |= b.pieces[WHITE][pawn_types[i]];
        pawns_and_pixies |= b.pieces[BLACK][pawn_types[i]];
    }
    
    while (warp_jumpers) {
        int sq = pop_lsb(warp_jumpers);
        int r = sq / 8;
        int dir = (us == WHITE) ? 1 : -1;
        int push1_sq = sq + 8 * dir;
        
        auto add_warp_move = [&](int to_sq) {
            int promo_row = (us == WHITE) ? 7 : 0;
            if (to_sq / 8 == promo_row && b.pieces[them][ARISTOCRAT] == 0) {
                list.add(Move(sq, to_sq, WARP_JUMPER, PIECE_TYPE_NONE, QUEEN, false, false));
                list.add(Move(sq, to_sq, WARP_JUMPER, PIECE_TYPE_NONE, ROOK, false, false));
                list.add(Move(sq, to_sq, WARP_JUMPER, PIECE_TYPE_NONE, BISHOP, false, false));
                list.add(Move(sq, to_sq, WARP_JUMPER, PIECE_TYPE_NONE, KNIGHT, false, false));
            } else {
                list.add(Move(sq, to_sq, WARP_JUMPER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
            }
        };
        
        if (push1_sq >= 0 && push1_sq < 64) {
            if (get_bit(all_pieces, push1_sq) && get_bit(pawns_and_pixies, push1_sq)) {
                // Blocked by a pawn, can jump over
                int jump_cursor = push1_sq;
                while (true) {
                    jump_cursor += 8 * dir;
                    if (jump_cursor < 0 || jump_cursor > 63) break;
                    if (!get_bit(all_pieces, jump_cursor)) {
                        add_warp_move(jump_cursor);
                        break;
                    } else if (!get_bit(pawns_and_pixies, jump_cursor)) {
                        break; // Blocked by non-pawn
                    }
                }
            }
        }
    }
    
    // --- DANCER FILTER ---
    // IMPORTANT: This filter assumes that generate_pseudo_legal_moves() was called into the SAME
    // MoveList BEFORE generate_pixie_moves(). It filters the cumulative list so that only
    // the active Dancer's non-capture moves survive. If the call order changes, this breaks.
    // See: search.cpp:186-187 where both generators use the same MoveList `ml`.
    if (b.active_dancer_sq != NO_SQ && get_bit(b.pieces[us][DANCER], b.active_dancer_sq)) {
        int w = 0;
        for (int i = 0; i < list.count; i++) {
            if (list.moves[i].from() == b.active_dancer_sq && !list.moves[i].is_capture()) {
                list.moves[w++] = list.moves[i];
            }
        }
        list.count = w;
    }
}
