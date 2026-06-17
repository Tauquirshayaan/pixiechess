#include "movegen.h"
#include "bitboard.h"
#include <iostream>

// ── PRECOMPUTED LEAPER MASKS ──
U64 KNIGHT_ATTACKS[64];
U64 KING_ATTACKS[64];

// Helper to prevent off-board wrapping
inline U64 shift_left(U64 b) { return (b << 1) & 0xfefefefefefefefeULL; }
inline U64 shift_right(U64 b) { return (b >> 1) & 0x7f7f7f7f7f7f7f7fULL; }

void init_leaper_masks() {
    for (int sq = 0; sq < 64; sq++) {
        U64 bit = 1ULL << sq;
        
        // King Attacks
        U64 k = shift_left(bit) | shift_right(bit);
        k |= bit; // Include origin for vertical shifts
        U64 k_attacks = k | (k << 8) | (k >> 8);
        KING_ATTACKS[sq] = k_attacks & ~(1ULL << sq); // Remove origin
        
        // Knight Attacks
        U64 n_attacks = 0ULL;
        // Up-left/Up-right
        n_attacks |= shift_left(bit << 16) | shift_right(bit << 16);
        // Down-left/Down-right
        n_attacks |= shift_left(bit >> 16) | shift_right(bit >> 16);
        // Left-up/Left-down (shift by 2 requires special mask)
        U64 left2 = (bit >> 2) & 0x3f3f3f3f3f3f3f3fULL;
        n_attacks |= (left2 << 8) | (left2 >> 8);
        // Right-up/Right-down
        U64 right2 = (bit << 2) & 0xfcfcfcfcfcfcfcfcULL;
        n_attacks |= (right2 << 8) | (right2 >> 8);
        
        KNIGHT_ATTACKS[sq] = n_attacks;
    }
}

// ── MOVE GENERATION ──
void generate_pseudo_legal_moves(const Board& b, MoveList& list) {
    Color us = b.side_to_move;
    Color them = (us == WHITE) ? BLACK : WHITE;
    
    U64 invulnerable = b.pieces[WHITE][IRONPAWN] | b.pieces[BLACK][IRONPAWN];
    
    U64 our_pieces = b.occupancies[us] | invulnerable;
    U64 enemy_pieces = b.occupancies[them] & ~invulnerable;
    U64 all_pieces = b.occupancies[BOTH];
    U64 empty_squares = ~all_pieces;
    
    // Calculate Auras (Paralysis & Freeze)
    U64 paralyzed_squares = 0ULL;
    
    // 1. Enemy Basilisks (Diagonal LOS Paralysis)
    U64 enemy_basilisks = b.pieces[them][BASILISK];
    while (enemy_basilisks) {
        int b_sq = pop_lsb(enemy_basilisks);
        paralyzed_squares |= get_sliding_attacks(b_sq, all_pieces, true, false);
    }
    
    // (Icicle only freezes when captured, which is handled via ability_tracker.frozen_turns)
    
    // 2.5 Explicitly Frozen Pieces (from ability tracker)
    for (int sq = 0; sq < 64; ++sq) {
        if (b.ability_tracker[sq].frozen_turns > 0) {
            paralyzed_squares |= (1ULL << sq);
        }
    }
    
    // 3. Anti-Violence Aura: pieces in this aura CANNOT capture
    U64 av_aura = 0ULL;
    U64 enemy_av = b.pieces[them][ANTI_VIOLENCE];
    while (enemy_av) {
        int av_sq = pop_lsb(enemy_av);
        av_aura |= KING_ATTACKS[av_sq];
    }
    
    // 1. STANDARD KNIGHTS + PIXIE KNIGHTS
    U64 knights = (b.pieces[us][KNIGHT] | b.pieces[us][ELECTROKNIGHT] | b.pieces[us][BANKER] | 
                   b.pieces[us][KNIGHTMARE] | b.pieces[us][PINATA] | b.pieces[us][FISH_KNIGHT]) & ~paralyzed_squares;
    while (knights) {
        int sq = pop_lsb(knights);
        int type = b.get_piece_on_square(sq);
        U64 attacks = KNIGHT_ATTACKS[sq] & ~our_pieces;
        // Anti-Violence: if this piece is in the aura, it cannot capture
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
            list.add(Move(sq, to_sq, type, captured_piece, PIECE_TYPE_NONE, is_capture, false));
        }
    }

    // 1.2 CAMEL (3,1 leaper)
    U64 camels = b.pieces[us][CAMEL] & ~paralyzed_squares;
    while (camels) {
        int sq = pop_lsb(camels);
        int r = sq / 8, c = sq % 8;
        int camel_offsets[8][2] = {{-3,-1},{-3,1},{-1,-3},{-1,3},{1,-3},{1,3},{3,-1},{3,1}};
        for (int i = 0; i < 8; i++) {
            int nr = r + camel_offsets[i][0], nc = c + camel_offsets[i][1];
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                int to_sq = nr * 8 + nc;
                if (get_bit(our_pieces, to_sq)) continue;
                if (get_bit(av_aura, sq) && get_bit(enemy_pieces, to_sq)) continue;
                bool is_cap = get_bit(enemy_pieces, to_sq);
                int cap_type = is_cap ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
                list.add(Move(sq, to_sq, CAMEL, cap_type, PIECE_TYPE_NONE, is_cap, false));
            }
        }
    }

    // 1.3 ANTI-VIOLENCE (knight-step movement, CANNOT capture)
    U64 anti_violence = b.pieces[us][ANTI_VIOLENCE] & ~paralyzed_squares;
    while (anti_violence) {
        int sq = pop_lsb(anti_violence);
        U64 targets = KNIGHT_ATTACKS[sq] & empty_squares;
        while (targets) {
            int to_sq = pop_lsb(targets);
            list.add(Move(sq, to_sq, ANTI_VIOLENCE, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
    }

    // 1.4 BOUNCER (diagonal ray with wall bounce)
    U64 bouncers = b.pieces[us][BOUNCER] & ~paralyzed_squares;
    while (bouncers) {
        int sq = pop_lsb(bouncers);
        int br = sq / 8, bc = sq % 8;
        int bounce_dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
        for (int d = 0; d < 4; d++) {
            int cr = br, cc = bc;
            int dr = bounce_dirs[d][0], dc = bounce_dirs[d][1];
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
                int to_sq = nr * 8 + nc;
                if (get_bit(our_pieces, to_sq)) break;
                bool is_cap = get_bit(enemy_pieces, to_sq);
                if (get_bit(av_aura, sq) && is_cap) { cr = nr; cc = nc; continue; }
                int cap_type = is_cap ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
                list.add(Move(sq, to_sq, BOUNCER, cap_type, PIECE_TYPE_NONE, is_cap, false));
                if (is_cap) break;
                cr = nr; cc = nc;
            }
        }
    }

    // 1.5 KNIGHTMARE LIMBO JUMPS
    U64 knightmares_for_jump = b.pieces[us][KNIGHTMARE] & ~paralyzed_squares;
    while (knightmares_for_jump) {
        int sq = pop_lsb(knightmares_for_jump);
        int r = sq / 8;
        int c = sq % 8;
        int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
        for (int d = 0; d < 8; d++) {
            int nr = r + km_dirs[d][0];
            int nc = c + km_dirs[d][1];
            if (nr < 0 || nr > 7 || nc < 0 || nc > 7) {
                if (nr >= -2 && nr <= 9 && nc >= -2 && nc <= 9) {
                    bool is_cap = false;
                    for (int j = 0; j < b.num_knightmares_limbo[them]; j++) {
                        int r2 = (b.knightmare_limbo_coords[them][j] >> 4) - 2;
                        int c2 = (b.knightmare_limbo_coords[them][j] & 0xF) - 2;
                        if (r2 == nr && c2 == nc) {
                            is_cap = true; break;
                        }
                    }
                    int cap_type = is_cap ? KNIGHTMARE : PIECE_TYPE_NONE;
                    list.add(Move(sq, sq, KNIGHTMARE, cap_type, d, is_cap, true));
                }
            }
        }
    }

    // 1.6 KNIGHTMARE LIMBO DROPS & LIMBO LEAPS
    if (b.num_knightmares_limbo[us] > 0) {
        int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
        for (int i = 0; i < b.num_knightmares_limbo[us]; i++) {
            uint8_t encoded = b.knightmare_limbo_coords[us][i];
            int ob_r = (encoded >> 4) - 2;
            int ob_c = (encoded & 0xF) - 2;
            
            for (int d = 0; d < 8; d++) {
                int nr = ob_r + km_dirs[d][0];
                int nc = ob_c + km_dirs[d][1];
                if (nr >= -2 && nr <= 9 && nc >= -2 && nc <= 9) {
                    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                        int to_sq = nr * 8 + nc;
                        if (get_bit(paralyzed_squares, to_sq)) continue;
                        if (!get_bit(our_pieces, to_sq)) {
                            bool is_cap = get_bit(enemy_pieces, to_sq);
                            int cap_type = is_cap ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
                            list.add(Move(to_sq, to_sq, KNIGHTMARE, cap_type, i, is_cap, false));
                        }
                    } else {
                        bool our_occupied = false;
                        for (int j = 0; j < b.num_knightmares_limbo[us]; j++) {
                            int r2 = (b.knightmare_limbo_coords[us][j] >> 4) - 2;
                            int c2 = (b.knightmare_limbo_coords[us][j] & 0xF) - 2;
                            if (r2 == nr && c2 == nc) {
                                our_occupied = true; break;
                            }
                        }
                        bool enemy_occupied = false;
                        for (int j = 0; j < b.num_knightmares_limbo[us ^ 1]; j++) {
                            int r2 = (b.knightmare_limbo_coords[us ^ 1][j] >> 4) - 2;
                            int c2 = (b.knightmare_limbo_coords[us ^ 1][j] & 0xF) - 2;
                            if (r2 == nr && c2 == nc) {
                                enemy_occupied = true; break;
                            }
                        }
                        if (!our_occupied) {
                            list.add(Move(63, 63, KNIGHTMARE, d, i, enemy_occupied, true)); 
                        }
                    }
                }
            }
        }
    }

    // 2. STANDARD KINGS + PIXIE KINGS
    U64 kings = (b.pieces[us][KING] | b.pieces[us][ROCKETMAN]) & ~paralyzed_squares;
    while (kings) {
        int sq = pop_lsb(kings);
        int type = b.get_piece_on_square(sq);
        U64 attacks = KING_ATTACKS[sq] & ~our_pieces;
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
            list.add(Move(sq, to_sq, type, captured_piece, PIECE_TYPE_NONE, is_capture, false));
        }
    }
    
    U64 bishops = (b.pieces[us][BISHOP] | b.pieces[us][QUEEN] | b.pieces[us][FISSION_REACTOR] |
                   b.pieces[us][ARISTOCRAT] | b.pieces[us][PILGRIM] | 
                   b.pieces[us][DANCER] | b.pieces[us][DJINN] | b.pieces[us][GUNSLINGER] | 
                   b.pieces[us][CARDINAL]) & ~paralyzed_squares;
    while (bishops) {
        int sq = pop_lsb(bishops);
        int type = b.get_piece_on_square(sq); 
        U64 attacks = get_sliding_attacks(sq, all_pieces, true, false) & ~our_pieces;
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
            list.add(Move(sq, to_sq, type, captured_piece, PIECE_TYPE_NONE, is_capture, false));
        }
    }
    
    // BASILISK & ICICLE: Moves like bishop but CANNOT capture
    U64 basilisks = (b.pieces[us][BASILISK] | b.pieces[us][ICICLE]) & ~paralyzed_squares;
    while (basilisks) {
        int sq = pop_lsb(basilisks);
        int type = b.get_piece_on_square(sq);
        U64 attacks = get_sliding_attacks(sq, all_pieces, true, false) & ~all_pieces; // empty only
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            list.add(Move(sq, to_sq, type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true));
        }
    }
    
    U64 rooks = (b.pieces[us][ROOK] | b.pieces[us][QUEEN] | b.pieces[us][FISSION_REACTOR]) & ~paralyzed_squares;
    while (rooks) {
        int sq = pop_lsb(rooks);
        int type = b.get_piece_on_square(sq);
        U64 attacks = get_sliding_attacks(sq, all_pieces, false, true) & ~our_pieces;
        if (get_bit(av_aura, sq)) attacks &= ~enemy_pieces;
        
        while (attacks) {
            int to_sq = pop_lsb(attacks);
            bool is_capture = get_bit(enemy_pieces, to_sq);
            int captured_piece = is_capture ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
            list.add(Move(sq, to_sq, type, captured_piece, PIECE_TYPE_NONE, is_capture, false));
        }
    }

    // PHASE_ROOK: Can phase through pieces to empty squares, captures normally
    U64 phase_rooks = b.pieces[us][PHASE_ROOK] & ~paralyzed_squares;
    while (phase_rooks) {
        int sq = pop_lsb(phase_rooks);
        // Phase movement: can reach any empty square on rank/file (ignore blockers)
        U64 phase_targets = get_sliding_attacks(sq, 0ULL, false, true) & empty_squares;
        if (get_bit(av_aura, sq)) phase_targets &= ~enemy_pieces;
        while (phase_targets) {
            int to_sq = pop_lsb(phase_targets);
            list.add(Move(sq, to_sq, PHASE_ROOK, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
        }
        // Normal captures: can only capture pieces with normal LOS
        if (!get_bit(av_aura, sq)) {
            U64 cap_targets = get_sliding_attacks(sq, all_pieces, false, true) & enemy_pieces;
            while (cap_targets) {
                int to_sq = pop_lsb(cap_targets);
                int cap_type = b.get_piece_on_square(to_sq);
                list.add(Move(sq, to_sq, PHASE_ROOK, cap_type, PIECE_TYPE_NONE, true, false));
            }
        }
    }

    // SumoRook: Can only move to empty squares (push logic handles captures as side-effects)
    U64 sumorooks = b.pieces[us][SUMOROOK] & ~paralyzed_squares;
    while (sumorooks) {
        int sq = pop_lsb(sumorooks);
        int type = b.get_piece_on_square(sq);
        U64 raw_attacks = get_sliding_attacks(sq, all_pieces, false, true);
        U64 attacks = raw_attacks & empty_squares;
        


        while (attacks) {
            int to_sq = pop_lsb(attacks);
            list.add(Move(sq, to_sq, type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true)); // flag as ability
        }
    }

    // BLADERUNNER
    U64 bladerunners = b.pieces[us][BLADERUNNER] & ~paralyzed_squares;
    while (bladerunners) {
        int sq = pop_lsb(bladerunners);
        int r = sq / 8, c = sq % 8;
        int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
        for (int d = 0; d < 4; d++) {
            int cr = r + dirs[d][0];
            int cc = c + dirs[d][1];
            while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
                int to_sq = cr * 8 + cc;
                if (get_bit(our_pieces, to_sq)) break;
                
                if (!get_bit(enemy_pieces, to_sq)) {
                    list.add(Move(sq, to_sq, BLADERUNNER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, true)); // flag as ability
                }
                cr += dirs[d][0];
                cc += dirs[d][1];
            }
        }
    }

    // MARAUDER
    U64 marauders = b.pieces[us][MARAUDER] & ~paralyzed_squares;
    while (marauders) {
        int sq = pop_lsb(marauders);
        int r = sq / 8, c = sq % 8;
        int range = 1 + b.ability_tracker[sq].marauder_kills * 2;
        int dirs[8][2] = {{-1,0}, {1,0}, {0,-1}, {0,1}, {-1,-1}, {-1,1}, {1,-1}, {1,1}};
        for (int d = 0; d < 8; d++) {
            for (int step = 1; step <= range; step++) {
                int cr = r + dirs[d][0] * step;
                int cc = c + dirs[d][1] * step;
                if (cr < 0 || cr > 7 || cc < 0 || cc > 7) break;
                int to_sq = cr * 8 + cc;
                if (get_bit(our_pieces, to_sq)) break;
                bool is_cap = get_bit(enemy_pieces, to_sq);
                int cap_type = is_cap ? b.get_piece_on_square(to_sq) : PIECE_TYPE_NONE;
                list.add(Move(sq, to_sq, MARAUDER, cap_type, PIECE_TYPE_NONE, is_cap, false));
                if (is_cap) break;
            }
        }
    }

    // 4. STANDARD PAWNS (And Golden, Hero, Iron, etc.)
    U64 pawns = (b.pieces[us][PAWN] | b.pieces[us][GOLDEN_PAWN] |
                 b.pieces[us][BLUEPRINT] | b.pieces[us][EPEE_PAWN] | b.pieces[us][PAWN_KNIFE] | 
                 b.pieces[us][HERO_PAWN] | b.pieces[us][WAR_AUTOMATON] | b.pieces[us][WARP_JUMPER] | b.pieces[us][SHRIKE] | b.pieces[us][HORDELING]) & ~paralyzed_squares;
    
    bool aristocrat_blocks = b.pieces[them][ARISTOCRAT] != 0ULL;
    auto add_pawn_move = [&](int from_sq, int to_sq, int type, bool is_cap, int cap_type, bool is_ep) {
        int prom_rank = (us == WHITE) ? 7 : 0;
        if (to_sq / 8 == prom_rank && !aristocrat_blocks && type != HORDELING) {
            list.add(Move(from_sq, to_sq, type, cap_type, QUEEN, is_cap, false));
            list.add(Move(from_sq, to_sq, type, cap_type, ROOK, is_cap, false));
            list.add(Move(from_sq, to_sq, type, cap_type, BISHOP, is_cap, false));
            list.add(Move(from_sq, to_sq, type, cap_type, KNIGHT, is_cap, false));
        } else {
            list.add(Move(from_sq, to_sq, type, cap_type, PIECE_TYPE_NONE, is_cap, is_ep));
        }
    };
    
    if (us == WHITE) {
        // Single pushes
        U64 single_pushes = (pawns << 8) & empty_squares;
        U64 sp = single_pushes;
        while (sp) {
            int to_sq = pop_lsb(sp);
            int from_sq = to_sq - 8;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), false, PIECE_TYPE_NONE, false);
        }
        
        // Double pushes
        U64 double_pushes = ((single_pushes & 0x0000000000FF0000ULL) << 8) & empty_squares;
        U64 dp = double_pushes;
        while (dp) {
            int to_sq = pop_lsb(dp);
            int from_sq = to_sq - 16;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), false, PIECE_TYPE_NONE, false);
        }
        
        // Captures Right (pawns NOT in Anti-Violence aura)
        U64 cap_pawns = pawns & ~av_aura;
        U64 cap_right = ((cap_pawns & 0x7F7F7F7F7F7F7F7FULL) << 9) & enemy_pieces;
        U64 cr = cap_right;
        while (cr) {
            int to_sq = pop_lsb(cr);
            int from_sq = to_sq - 9;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(to_sq), false);
        }
        
        // Captures Left
        U64 cap_left = ((cap_pawns & 0xFEFEFEFEFEFEFEFEULL) << 7) & enemy_pieces;
        U64 cl = cap_left;
        while (cl) {
            int to_sq = pop_lsb(cl);
            int from_sq = to_sq - 7;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(to_sq), false);
        }
        
        // En Passant
        if (b.en_passant_sq != NO_SQ) {
            int cap_sq = b.en_passant_sq - 8;
            if (!get_bit(invulnerable, cap_sq)) {
                U64 ep_bb = 1ULL << b.en_passant_sq;
                U64 ep_right = ((cap_pawns & 0x7F7F7F7F7F7F7F7FULL) << 9) & ep_bb;
                if (ep_right) {
                    int to_sq = b.en_passant_sq;
                    int from_sq = to_sq - 9;
                    add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(cap_sq), true);
                }
                U64 ep_left = ((cap_pawns & 0xFEFEFEFEFEFEFEFEULL) << 7) & ep_bb;
                if (ep_left) {
                    int to_sq = b.en_passant_sq;
                    int from_sq = to_sq - 7;
                    add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(cap_sq), true);
                }
            }
        }
    } else {
        // Single pushes
        U64 single_pushes = (pawns >> 8) & empty_squares;
        U64 sp = single_pushes;
        while (sp) {
            int to_sq = pop_lsb(sp);
            int from_sq = to_sq + 8;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), false, PIECE_TYPE_NONE, false);
        }
        
        // Double pushes
        U64 double_pushes = ((single_pushes & 0x0000FF0000000000ULL) >> 8) & empty_squares;
        U64 dp = double_pushes;
        while (dp) {
            int to_sq = pop_lsb(dp);
            int from_sq = to_sq + 16;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), false, PIECE_TYPE_NONE, false);
        }
        
        // Captures Right (pawns NOT in Anti-Violence aura)
        U64 cap_pawns = pawns & ~av_aura;
        U64 cap_right = ((cap_pawns & 0x7F7F7F7F7F7F7F7FULL) >> 7) & enemy_pieces;
        U64 cr = cap_right;
        while (cr) {
            int to_sq = pop_lsb(cr);
            int from_sq = to_sq + 7;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(to_sq), false);
        }
        
        // Captures Left
        U64 cap_left = ((cap_pawns & 0xFEFEFEFEFEFEFEFEULL) >> 9) & enemy_pieces;
        U64 cl = cap_left;
        while (cl) {
            int to_sq = pop_lsb(cl);
            int from_sq = to_sq + 9;
            add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(to_sq), false);
        }
        
        // En Passant
        if (b.en_passant_sq != NO_SQ) {
            int cap_sq = b.en_passant_sq + 8;
            if (!get_bit(invulnerable, cap_sq)) {
                U64 ep_bb = 1ULL << b.en_passant_sq;
                U64 ep_right = ((cap_pawns & 0x7F7F7F7F7F7F7F7FULL) >> 7) & ep_bb;
                if (ep_right) {
                    int to_sq = b.en_passant_sq;
                    int from_sq = to_sq + 7;
                    add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(cap_sq), true);
                }
                U64 ep_left = ((cap_pawns & 0xFEFEFEFEFEFEFEFEULL) >> 9) & ep_bb;
                if (ep_left) {
                    int to_sq = b.en_passant_sq;
                    int from_sq = to_sq + 9;
                    add_pawn_move(from_sq, to_sq, b.get_piece_on_square(from_sq), true, b.get_piece_on_square(cap_sq), true);
                }
            }
        }
    }

    // 4.5 EPEE_PAWN Global En Passant
    U64 epee_pawns = b.pieces[us][EPEE_PAWN] & ~paralyzed_squares;
    if (epee_pawns && b.en_passant_sq != NO_SQ) {
        int ep_sq = b.en_passant_sq;
        int cap_sq = (us == WHITE) ? ep_sq - 8 : ep_sq + 8;
        
        if (!get_bit(invulnerable, cap_sq)) {
            while (epee_pawns) {
            int sq = pop_lsb(epee_pawns);
            int sq_r = sq / 8;
            int sq_c = sq % 8;
            int ep_r = ep_sq / 8;
            int ep_c = ep_sq % 8;
            
            // Check if it's a standard en-passant (which was already generated above)
            bool is_standard_ep = false;
            if (us == WHITE && sq_r == ep_r + 1 && (sq_c == ep_c - 1 || sq_c == ep_c + 1)) is_standard_ep = true;
            if (us == BLACK && sq_r == ep_r - 1 && (sq_c == ep_c - 1 || sq_c == ep_c + 1)) is_standard_ep = true;
            
            if (!is_standard_ep) {
                add_pawn_move(sq, ep_sq, b.get_piece_on_square(sq), true, b.get_piece_on_square(cap_sq), true);
            }
        }
        }
    }

    // 4.55 PAWN_KNIFE Extended Diagonal Captures (abs(dx)==2, abs(dy)==2, toward center d/e files)
    U64 pawn_knives = b.pieces[us][PAWN_KNIFE] & ~paralyzed_squares & ~av_aura;
    while (pawn_knives) {
        int sq = pop_lsb(pawn_knives);
        int r = sq / 8;
        int c = sq % 8;
        int fwd = (us == WHITE) ? 2 : -2;
        int nr = r + fwd;
        if (nr >= 0 && nr <= 7) {
            // Extended diagonal captures: ±2 file offset, toward center (files 3/4, i.e. d/e)
            for (int dc : {-2, 2}) {
                int nc = c + dc;
                if (nc < 0 || nc > 7) continue;
                // Must be toward center: if piece is on left half (c <= 3), dc must be +2; if right half (c >= 4), dc must be -2
                // Per the description: "toward d/e file"
                if (c <= 3 && dc < 0) continue; // moving further left is away from center
                if (c >= 4 && dc > 0) continue; // moving further right is away from center
                int to_sq = nr * 8 + nc;
                if (!get_bit(enemy_pieces, to_sq)) continue;  // must capture
                if (get_bit(invulnerable, to_sq)) continue;
                int cap_type = b.get_piece_on_square(to_sq);
                add_pawn_move(sq, to_sq, PAWN_KNIFE, true, cap_type, false);
            }
        }
    }

    // 4.5 SHRIKE SPECIAL TRAP
    U64 shrikes = b.pieces[us][SHRIKE] & ~paralyzed_squares;
    while (shrikes) {
        int sq = pop_lsb(shrikes);
        int r = sq / 8;
        int dir = (us == WHITE) ? 1 : -1;
        int startRow = (us == WHITE) ? 1 : 6;
        
        if (r == startRow && !b.ability_tracker[sq].ability_used) {
            int mid_sq = sq + (dir * 8);
            int to_sq = sq + (dir * 16);
            if (to_sq >= 0 && to_sq <= 63) {
                bool mid_has_enemy = get_bit(enemy_pieces, mid_sq);
                bool to_has_piece = get_bit(all_pieces, to_sq);
                bool to_has_enemy = get_bit(enemy_pieces, to_sq);
                bool mid_has_piece = get_bit(all_pieces, mid_sq);
                
                if (!get_bit(our_pieces, to_sq)) {
                    if (mid_has_enemy && !to_has_piece) {
                        // Capture jumped piece (mid-square capture, promoted = 0)
                        int cap_type = b.get_piece_on_square(mid_sq);
                        list.add(Move(sq, to_sq, SHRIKE, cap_type, 0, true, true));
                    } else if (to_has_enemy && !mid_has_piece) {
                        // Normal capture on the destination square (destination capture, promoted = 1)
                        int cap_type = b.get_piece_on_square(to_sq);
                        list.add(Move(sq, to_sq, SHRIKE, cap_type, 1, true, true));
                    }
                }
            }
        }
    }

    // 4.6 WARP JUMPER SPECIAL JUMPS
    U64 warp_jumpers = b.pieces[us][WARP_JUMPER] & ~paralyzed_squares;
    U64 all_pawns_and_pixies = b.pieces[WHITE][PAWN] | b.pieces[BLACK][PAWN] | 
        b.pieces[WHITE][GOLDEN_PAWN] | b.pieces[BLACK][GOLDEN_PAWN] |
        b.pieces[WHITE][IRONPAWN] | b.pieces[BLACK][IRONPAWN] |
        b.pieces[WHITE][BLUEPRINT] | b.pieces[BLACK][BLUEPRINT] |
        b.pieces[WHITE][EPEE_PAWN] | b.pieces[BLACK][EPEE_PAWN] |
        b.pieces[WHITE][PAWN_KNIFE] | b.pieces[BLACK][PAWN_KNIFE] |
        b.pieces[WHITE][HERO_PAWN] | b.pieces[BLACK][HERO_PAWN] |
        b.pieces[WHITE][SHRIKE] | b.pieces[BLACK][SHRIKE] |
        b.pieces[WHITE][WARP_JUMPER] | b.pieces[BLACK][WARP_JUMPER] |
        b.pieces[WHITE][WAR_AUTOMATON] | b.pieces[BLACK][WAR_AUTOMATON];
        
    while (warp_jumpers) {
        int sq = pop_lsb(warp_jumpers);
        int dir = (us == WHITE) ? 1 : -1;
        
        int push1_sq = sq + (dir * 8);
        if (push1_sq >= 0 && push1_sq <= 63) {
            if (get_bit(all_pawns_and_pixies, push1_sq)) {
                int jump_sq = push1_sq;
                while (jump_sq >= 0 && jump_sq <= 63 && get_bit(all_pawns_and_pixies, jump_sq)) {
                    jump_sq += (dir * 8);
                    if (jump_sq >= 0 && jump_sq <= 63 && !get_bit(all_pieces, jump_sq)) {
                        int prom = (jump_sq / 8 == ((us == WHITE) ? 7 : 0)) ? QUEEN : PIECE_TYPE_NONE;
                        if (prom == QUEEN && !aristocrat_blocks) {
                            list.add(Move(sq, jump_sq, WARP_JUMPER, PIECE_TYPE_NONE, QUEEN, false, false));
                            list.add(Move(sq, jump_sq, WARP_JUMPER, PIECE_TYPE_NONE, ROOK, false, false));
                            list.add(Move(sq, jump_sq, WARP_JUMPER, PIECE_TYPE_NONE, BISHOP, false, false));
                            list.add(Move(sq, jump_sq, WARP_JUMPER, PIECE_TYPE_NONE, KNIGHT, false, false));
                        } else {
                            list.add(Move(sq, jump_sq, WARP_JUMPER, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                        }
                        break;
                    }
                }
            }
        }
    }

    // 5. CASTLING — only generate if the King is actually on the castling origin square
    if (us == WHITE) {
        bool white_king_on_e1 = get_bit(b.pieces[WHITE][KING] | b.pieces[WHITE][ROCKETMAN], E1);
        if (white_king_on_e1) {
            int k_type = get_bit(b.pieces[WHITE][KING], E1) ? KING : ROCKETMAN;
            if (b.castling_rights & 1) { // White King-side (WK)
                if (!get_bit(all_pieces, F1) && !get_bit(all_pieces, G1)) {
                    if (!b.is_square_attacked(E1, BLACK) && !b.is_square_attacked(F1, BLACK) && !b.is_square_attacked(G1, BLACK)) {
                        list.add(Move(E1, G1, k_type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                    }
                }
            }
            if (b.castling_rights & 2) { // White Queen-side (WQ)
                if (!get_bit(all_pieces, D1) && !get_bit(all_pieces, C1) && !get_bit(all_pieces, B1)) {
                    if (!b.is_square_attacked(E1, BLACK) && !b.is_square_attacked(D1, BLACK) && !b.is_square_attacked(C1, BLACK)) {
                        list.add(Move(E1, C1, k_type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                    }
                }
            }
        }
    } else {
        bool black_king_on_e8 = get_bit(b.pieces[BLACK][KING] | b.pieces[BLACK][ROCKETMAN], E8);
        if (black_king_on_e8) {
            int k_type = get_bit(b.pieces[BLACK][KING], E8) ? KING : ROCKETMAN;
            if (b.castling_rights & 4) { // Black King-side (BK)
                if (!get_bit(all_pieces, F8) && !get_bit(all_pieces, G8)) {
                    if (!b.is_square_attacked(E8, WHITE) && !b.is_square_attacked(F8, WHITE) && !b.is_square_attacked(G8, WHITE)) {
                        list.add(Move(E8, G8, k_type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                    }
                }
            }
            if (b.castling_rights & 8) { // Black Queen-side (BQ)
                if (!get_bit(all_pieces, D8) && !get_bit(all_pieces, C8) && !get_bit(all_pieces, B8)) {
                    if (!b.is_square_attacked(E8, WHITE) && !b.is_square_attacked(D8, WHITE) && !b.is_square_attacked(C8, WHITE)) {
                        list.add(Move(E8, C8, k_type, PIECE_TYPE_NONE, PIECE_TYPE_NONE, false, false));
                    }
                }
            }
        }
    }
}
