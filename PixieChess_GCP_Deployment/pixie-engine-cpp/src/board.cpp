#include "board.h"
#include "bitboard.h"
#include "zobrist.h"
#include "movegen.h"
#include "rays.h"
#include <sstream>

void Board::init_from_pfen(const std::string& pfen) {
    // Manually zero out fields to avoid massive stack object creation (*this = Board() creates 6MB on stack)
    for (int c = 0; c < 2; c++) {
        for (int p = 0; p < 39; p++) {
            pieces[c][p] = 0ULL;
            dead_pieces_count[c][p] = 0;
        }
    }
    for (int i = 0; i < 3; i++) occupancies[i] = 0ULL;
    side_to_move = WHITE;
    en_passant_sq = NO_SQ;
    castling_rights = 0;
    half_move_clock = 0;
    full_move_number = 1;
    last_move_dest_sq = NO_SQ;
    ply = 0;
    hash = 0ULL;
    active_dancer_sq = NO_SQ;
    dissipated_djinn_sqs[0] = NO_SQ;
    dissipated_djinn_sqs[1] = NO_SQ;
    num_knightmares_limbo[0] = 0;
    num_knightmares_limbo[1] = 0;
    for (int i=0; i<16; i++) {
        knightmare_limbo_coords[0][i] = 0;
        knightmare_limbo_coords[1][i] = 0;
    }
    for (int i = 0; i < 64; i++) {
        ability_tracker[i] = AbilityState();
    }
    
    std::stringstream ss(pfen);
    std::string token;
    
    // 1. Parse 64 squares
    for (int sq = 0; sq < 64; sq++) {
        char delimiter = (sq == 63) ? ' ' : ',';
        if (!std::getline(ss, token, delimiter)) break;
        int val = std::stoi(token);
        if (val != -1) {
            Color c = (val >= 100) ? BLACK : WHITE;
            int type = (val >= 100) ? val - 100 : val;
            set_bit(pieces[c][type], sq);
        }
    }
    
    // 2. Parse side to move
    if (std::getline(ss, token, ' ')) {
        side_to_move = (token == "b") ? BLACK : WHITE;
    }
    
    // 3. Parse castling rights (optional for backward compatibility)
    if (std::getline(ss, token, ' ')) {
        castling_rights = std::stoi(token);
    } else {
        castling_rights = 0;
    }
    
    // 4. Parse en passant square (optional)
    if (std::getline(ss, token, ' ')) {
        int ep = std::stoi(token);
        en_passant_sq = (ep == -1) ? NO_SQ : ep;
    } else {
        en_passant_sq = NO_SQ;
    }
    
    // 5. Parse dead pieces (optional)
    if (std::getline(ss, token, ' ')) {
        if (token != "-") {
            std::stringstream dead_ss(token);
            std::string dead_token;
            while (std::getline(dead_ss, dead_token, ',')) {
                if (dead_token.empty()) continue;
                int val = std::stoi(dead_token);
                Color c = (val >= 100) ? BLACK : WHITE;
                int type = (val >= 100) ? val - 100 : val;
                dead_pieces_count[c][type]++;
            }
        }
    }
    
    // 6. Parse ability states (optional)
    if (std::getline(ss, token, ' ')) {
        if (token != "-") {
            std::stringstream ab_ss(token);
            std::string sq_token;
            while (std::getline(ab_ss, sq_token, '|')) {
                if (sq_token.empty()) continue;
                std::stringstream fields(sq_token);
                std::string f;
                
                // Format: sq,frozen,electro,marauder,fission,used,pilgrim,djinn_diss,djinn_home,dancer_bonus,dancer_act,gun_target,gun_ply
                if (std::getline(fields, f, ',')) {
                    int sq = std::stoi(f);
                    AbilityState& st = ability_tracker[sq];
                    if (std::getline(fields, f, ',')) st.frozen_turns = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.electro_charges = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.marauder_kills = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.fission_captures = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.ability_used = (std::stoi(f) != 0);
                    if (std::getline(fields, f, ',')) st.pilgrim_dist = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.djinn_dissipated = (std::stoi(f) != 0);
                    if (std::getline(fields, f, ',')) st.djinn_home_sq = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.dancer_bonus_moves = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.dancer_active = (std::stoi(f) != 0);
                    if (std::getline(fields, f, ',')) st.gunslinger_target_sq = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.gunslinger_mutual_ply = std::stoi(f);
                    if (std::getline(fields, f, ',')) st.fish_moved = (std::stoi(f) != 0);
                    
                    // Track global Phase 2/3 state
                    if (st.dancer_active) active_dancer_sq = sq;
                    if (st.djinn_dissipated) {
                        Color piece_color = get_piece_on_square(sq) >= 100 ? BLACK : WHITE;
                        dissipated_djinn_sqs[piece_color] = sq;
                    }
                }
            }
        }
    }

    // 7. Parse Knightmare Limbo (optional) Format: w1,w2;b1,b2 or -;-
    if (std::getline(ss, token, ' ')) {
        if (token != "-;-") {
            std::stringstream limbo_ss(token);
            std::string w_str, b_str;
            if (std::getline(limbo_ss, w_str, ';')) {
                if (w_str != "-") {
                    std::stringstream w_ss(w_str);
                    std::string enc_token;
                    while (std::getline(w_ss, enc_token, ',')) {
                        if (!enc_token.empty()) {
                            knightmare_limbo_coords[WHITE][num_knightmares_limbo[WHITE]++] = (uint8_t)std::stoi(enc_token);
                        }
                    }
                }
            }
            if (std::getline(limbo_ss, b_str, ';')) {
                if (b_str != "-") {
                    std::stringstream b_ss(b_str);
                    std::string enc_token;
                    while (std::getline(b_ss, enc_token, ',')) {
                        if (!enc_token.empty()) {
                            knightmare_limbo_coords[BLACK][num_knightmares_limbo[BLACK]++] = (uint8_t)std::stoi(enc_token);
                        }
                    }
                }
            }
        }
    }

    update_occupancies();
    hash = Zobrist::generate_hash(*this); // Initialize root hash!
}

void Board::do_move(Move m) {
    // 1. Save state to history
    history[ply].en_passant_sq = en_passant_sq;
    history[ply].castling_rights = castling_rights;
    history[ply].half_move_clock = half_move_clock;
    history[ply].captured_piece = m.captured();
    history[ply].last_move_dest_sq = last_move_dest_sq;
    history[ply].hash = hash;
    history[ply].from_state = ability_tracker[m.from()];
    history[ply].to_state = ability_tracker[m.to()];
    history[ply].num_destroyed = 0;
    history[ply].num_spawned = 0;
    history[ply].num_automatons_moved = 0;
    history[ply].num_doomed = 0;
    history[ply].num_ability_updates = 0;
    history[ply].num_gunslingers_updated = 0;
    history[ply].active_dancer_sq = active_dancer_sq;
    history[ply].dissipated_djinn_sqs[0] = dissipated_djinn_sqs[0];
    history[ply].dissipated_djinn_sqs[1] = dissipated_djinn_sqs[1];
    history[ply].side_to_move = side_to_move;
    history[ply].full_move_number = full_move_number;
    history[ply].resurrected_piece_type = PIECE_TYPE_NONE;
    history[ply].decremented_freezes = 0ULL;
    
    history[ply].num_knightmares_limbo[0] = num_knightmares_limbo[0];
    history[ply].num_knightmares_limbo[1] = num_knightmares_limbo[1];
    for(int i=0; i<16; i++) {
        history[ply].knightmare_limbo_coords[0][i] = knightmare_limbo_coords[0][i];
        history[ply].knightmare_limbo_coords[1][i] = knightmare_limbo_coords[1][i];
    }
    
    // 2. Extract move details
    int us = side_to_move;
    int them = us ^ 1;
    int from = m.from();
    int to = m.to();
    int piece = m.piece();
    int captured = m.captured();
    
    // 3. Remove moving piece from original square
    bool is_drop = (piece == KNIGHTMARE && from == to && !m.is_ability());
    if (!is_drop) {
        clear_bit(pieces[us][piece], from);
        hash ^= Zobrist::piece_keys[us][piece][from];
    }
    
    // 4. Handle captures
    if (m.is_capture() && captured != PIECE_TYPE_NONE) {
        int cap_sq = to;
        if (m.is_ability()) {
            if (piece == SHRIKE) {
                // promoted() encodes capture location: 0=mid-square, 1=destination
                if (m.promoted() == 0) {
                    cap_sq = from + ((us == WHITE) ? 8 : -8); // Mid-square capture
                } else {
                    cap_sq = to; // Destination-square capture
                }
            } else if (piece == PAWN || (piece >= GOLDEN_PAWN && piece <= WAR_AUTOMATON)) {
                cap_sq = to + ((us == WHITE) ? -8 : 8);
            }
        }
        
        if (get_bit(pieces[them][captured], cap_sq)) {
            clear_bit(pieces[them][captured], cap_sq);
            hash ^= Zobrist::piece_keys[them][captured][cap_sq];
            dead_pieces_count[them][captured]++;
            
            // Trigger chain destruction for horde mother
            if (captured == HORDE_MOTHER || captured == HORDELING) {
                U64 horde = pieces[them][HORDE_MOTHER] | pieces[them][HORDELING];
                while (horde) {
                    int sq2 = pop_lsb(horde);
                    int t2 = get_piece_on_square(sq2);
                    if (t2 != PIECE_TYPE_NONE) destroy_piece(sq2, t2, (Color)them);
                }
            }
        }
        if (captured == ICICLE) {
            ability_tracker[to].frozen_turns = 2;
        }
        half_move_clock = 0;
    } else if (piece == PAWN || piece >= GOLDEN_PAWN) { // Any pawn-like piece resets clock
        half_move_clock = 0;
    } else {
        half_move_clock++;
    }
    
    // 5. Place piece on new square
    int final_piece = piece;
    bool is_limbo_to_limbo = (piece == KNIGHTMARE && m.is_ability() && m.captured() <= 7);
    bool is_limbo_jump = (piece == KNIGHTMARE && m.is_ability() && !is_limbo_to_limbo);
    
    if (m.promoted() != PIECE_TYPE_NONE && !is_drop && !is_limbo_jump && !is_limbo_to_limbo && piece != HORDE_MOTHER) {
        final_piece = m.promoted();
    }
    bool is_dissipate = (final_piece == DJINN && m.is_ability());
    bool is_duel = (final_piece == GUNSLINGER && m.is_ability());
    

    if (!is_dissipate && !is_limbo_jump && !is_limbo_to_limbo) {
        set_bit(pieces[us][final_piece], to);
        hash ^= Zobrist::piece_keys[us][final_piece][to];
        if (is_drop) {
            int idx = m.promoted();
            num_knightmares_limbo[us]--;
            knightmare_limbo_coords[us][idx] = knightmare_limbo_coords[us][num_knightmares_limbo[us]];
        }
    } else if (is_dissipate) {
        dissipated_djinn_sqs[us] = from;
    } else if (is_duel) {
        int target_sq = ability_tracker[from].gunslinger_target_sq;
        if (target_sq != NO_SQ) {
            int target_piece = PIECE_TYPE_NONE;
            for (int p = 0; p < 39; p++) {
                if (get_bit(pieces[them][p], target_sq)) {
                    target_piece = p; break;
                }
            }
            if (target_piece != PIECE_TYPE_NONE) {
                destroy_piece(target_sq, target_piece, (Color)them);
            }
        }
    } else if (is_limbo_jump) {
        int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
        int r = from / 8 + km_dirs[m.promoted()][0];
        int c = from % 8 + km_dirs[m.promoted()][1];
        uint8_t encoded = ((r + 2) << 4) | (c + 2);
        knightmare_limbo_coords[us][num_knightmares_limbo[us]++] = encoded;
        
        if (m.is_capture()) {
            for (int i = 0; i < num_knightmares_limbo[them]; i++) {
                if (knightmare_limbo_coords[them][i] == encoded) {
                    num_knightmares_limbo[them]--;
                    knightmare_limbo_coords[them][i] = knightmare_limbo_coords[them][num_knightmares_limbo[them]];
                    break;
                }
            }
        }
    } else if (is_limbo_to_limbo) {
        int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
        int idx = m.promoted();
        int d = m.captured(); // Direction is stored in captured
        uint8_t old_encoded = knightmare_limbo_coords[us][idx];
        int old_r = (old_encoded >> 4) - 2;
        int old_c = (old_encoded & 0xF) - 2;
        int new_r = old_r + km_dirs[d][0];
        int new_c = old_c + km_dirs[d][1];
        uint8_t new_encoded = ((new_r + 2) << 4) | (new_c + 2);
        knightmare_limbo_coords[us][idx] = new_encoded;
        
        if (m.is_capture()) {
            for (int i = 0; i < num_knightmares_limbo[them]; i++) {
                if (knightmare_limbo_coords[them][i] == new_encoded) {
                    num_knightmares_limbo[them]--;
                    knightmare_limbo_coords[them][i] = knightmare_limbo_coords[them][num_knightmares_limbo[them]];
                    break;
                }
            }
        }
    }
    
    if (!is_drop && !is_limbo_jump && !is_limbo_to_limbo && !is_dissipate && !is_duel) {
        ability_tracker[to] = ability_tracker[from];
        ability_tracker[from] = AbilityState();
    } else if (is_drop) {
        ability_tracker[to] = AbilityState();
    }
    
    // UPDATE OCCUPANCIES HERE so that post-move/post-capture Pixie logic (e.g. War Automaton, Horde Mother)
    // sees the freshly updated board instead of the stale pre-move board!
    update_occupancies();
    
    // 6. Handle Pixie Special Triggers
    if (final_piece == BLADERUNNER && m.is_ability()) {
        int r = from / 8;
        int c = from % 8;
        int tr = to / 8;
        int tc = to % 8;
        int dr = tr - r;
        int dc = tc - c;
        int step_r = (dr == 0) ? 0 : (dr > 0 ? 1 : -1);
        int step_c = (dc == 0) ? 0 : (dc > 0 ? 1 : -1);
        int cr = r + step_r;
        int cc = c + step_c;
        while (cr != tr || cc != tc) {
            int sq = cr * 8 + cc;
            if (get_bit(occupancies[them], sq)) {
                for (int p = 0; p < 39; p++) {
                    if (get_bit(pieces[them][p], sq)) {
                        history[ply].doomed[history[ply].num_doomed++] = {sq, p, them};
                        // C++ Engine Heuristic: Destroy doomed pieces immediately to accurately score the material advantage
                        destroy_piece(sq, p, (Color)them);
                        break;
                    }
                }
            }
            cr += step_r;
            cc += step_c;
        }
    }
    
    if (final_piece == BANKER && m.is_capture() && captured == PAWN) {
        U64 our_pawns = pieces[us][PAWN];
        if (our_pawns) {
            int adv_sq = (us == WHITE) ? get_lsb(our_pawns) : (63 - __builtin_clzll(our_pawns));
            clear_bit(pieces[us][PAWN], adv_sq);
            set_bit(pieces[us][GOLDEN_PAWN], adv_sq);
            history[ply].destroyed[history[ply].num_destroyed++] = {adv_sq, PAWN, us};
            history[ply].spawned[history[ply].num_spawned++] = {adv_sq, GOLDEN_PAWN, us};
            hash ^= Zobrist::piece_keys[us][PAWN][adv_sq];
            hash ^= Zobrist::piece_keys[us][GOLDEN_PAWN][adv_sq];
        }
    }
    
    if (final_piece == FISSION_REACTOR && m.is_capture()) {
        ability_tracker[to].fission_captures++;
        if (ability_tracker[to].fission_captures >= 5) {
            clear_bit(pieces[us][FISSION_REACTOR], to);
            hash ^= Zobrist::piece_keys[us][FISSION_REACTOR][to];
            history[ply].destroyed[history[ply].num_destroyed++] = {to, FISSION_REACTOR, us};
            int r = to / 8;
            int c = to % 8;
            int diag_offsets[4][2] = { {-1, -1}, {-1, 1}, {1, -1}, {1, 1} };
            for (int i = 0; i < 4; i++) {
                int dr = diag_offsets[i][0];
                int dc = diag_offsets[i][1];
                int nr = r + dr;
                int nc = c + dc;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    int nsq = nr * 8 + nc;
                    if (get_bit(occupancies[them], nsq)) {
                        for (int p = 0; p < 39; p++) {
                            if (get_bit(pieces[them][p], nsq)) {
                                destroy_piece(nsq, p, (Color)them);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    

    
    if (captured == HORDE_MOTHER || captured == HORDELING) {
        // Handled by destroy_piece during standard capture removal
    }

    if (final_piece == ELECTROKNIGHT) {
        if (m.is_capture()) {
            if (ability_tracker[to].electro_charges >= 3) {
                int r = to / 8;
                int c = to % 8;
                int best_target_sq = NO_SQ;
                int best_target_type = PIECE_TYPE_NONE;
                float best_val = -1.0f;
                
                int adjacencies[8][2] = {
                    {1, 0}, {-1, 0}, {0, -1}, {0, 1},
                    {1, -1}, {1, 1}, {-1, -1}, {-1, 1}
                };
                for (int i = 0; i < 8; i++) {
                    int dr = adjacencies[i][0];
                    int dc = adjacencies[i][1];
                    int nr = r + dr;
                    int nc = c + dc;
                    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                            int nsq = nr * 8 + nc;
                            if (get_bit(occupancies[them], nsq)) {
                                int p_type = get_piece_on_square(nsq);
                                float pVal = 10.0f;
                                if (p_type == QUEEN || p_type == FISSION_REACTOR) pVal = 90.0f;
                                else if (p_type == ROOK || p_type == SUMOROOK || p_type == PHASE_ROOK) pVal = 50.0f;
                                else if (p_type == BISHOP || (p_type >= ARISTOCRAT && p_type <= MARAUDER)) pVal = 30.0f;
                                else if (p_type == KNIGHT || (p_type >= ELECTROKNIGHT && p_type <= FISH_KNIGHT)) pVal = 30.0f;
                                else if (p_type == KING || p_type == ROCKETMAN) pVal = 100.0f;
                                
                                if (pVal > best_val) {
                                    best_val = pVal;
                                    best_target_sq = nsq;
                                    best_target_type = p_type;
                                }
                            }
                        }
                }
                
                if (best_target_sq != NO_SQ) {
                    clear_bit(pieces[them][best_target_type], best_target_sq);
                    hash ^= Zobrist::piece_keys[them][best_target_type][best_target_sq];
                    history[ply].destroyed[history[ply].num_destroyed++] = {best_target_sq, best_target_type, them};
                }
            }
            ability_tracker[to].electro_charges = 0;
        } else {
            ability_tracker[to].electro_charges++;
        }
    }

    if (final_piece == MARAUDER && m.is_capture()) {
        ability_tracker[to].marauder_kills++;
    }
    
    if (final_piece == ROCKETMAN && m.is_ability()) {
        ability_tracker[to].ability_used = true;
    }
    
    if (final_piece == HORDE_MOTHER && m.is_capture() && m.promoted() != PIECE_TYPE_NONE) {
        int spawn_sq = m.promoted();
        if (!get_bit(occupancies[BOTH], spawn_sq)) {
            set_bit(pieces[us][HORDELING], spawn_sq);
            hash ^= Zobrist::piece_keys[us][HORDELING][spawn_sq];
            history[ply].spawned[history[ply].num_spawned++] = {spawn_sq, HORDELING, us};
        }
    }
    
    if (final_piece == SUMOROOK) {
        int r = to / 8;
        int c = to % 8;
        int fr = from / 8;
        int fc = from % 8;
        
        int dr = r - fr;
        int dc = c - fc;
        int step_r = (dr == 0) ? 0 : (dr > 0 ? 1 : -1);
        int step_c = (dc == 0) ? 0 : (dc > 0 ? 1 : -1);
        
        int er = r + step_r;
        int ec = c + step_c;
        
        if (er >= 0 && er < 8 && ec >= 0 && ec < 8 && (step_r != 0 || step_c != 0)) {
            int esq = er * 8 + ec;
            if (get_bit(occupancies[BOTH], esq)) {
                int piece_color1 = get_bit(occupancies[WHITE], esq) ? WHITE : BLACK;
                int enemy_type1 = get_piece_on_square(esq);
                // SumoRook cannot push Ironpawns
                if (enemy_type1 != IRONPAWN) {
                    // We have contact with a piece!
                    destroy_piece(esq, enemy_type1, (Color)piece_color1);
                    
                    // Find how far we can push
                int push_cursor_r = er;
                int push_cursor_c = ec;
                
                // We advance until we hit edge or another piece
                int next_r = push_cursor_r + step_r;
                int next_c = push_cursor_c + step_c;
                bool hit_second = false;
                int second_sq = -1;
                int second_type = PIECE_TYPE_NONE;
                int second_color = BOTH;
                
                bool is_pawn1 = (enemy_type1 == PAWN || (enemy_type1 >= GOLDEN_PAWN && enemy_type1 <= HORDELING));
                bool is_own_forward1 = is_pawn1 && piece_color1 == us && ((us == WHITE && step_r == -1) || (us == BLACK && step_r == 1));
                while (next_r >= 0 && next_r < 8 && next_c >= 0 && next_c < 8) {
                    if (is_own_forward1 && ((us == WHITE && next_r == 0) || (us == BLACK && next_r == 7))) break;
                    int nsq = next_r * 8 + next_c;
                    if (get_bit(occupancies[BOTH], nsq)) {
                        hit_second = true;
                        second_sq = nsq;
                        second_color = get_bit(occupancies[us], nsq) ? us : them;
                        second_type = get_piece_on_square(nsq);
                        break;
                    }
                    push_cursor_r = next_r;
                    push_cursor_c = next_c;
                    next_r += step_r;
                    next_c += step_c;
                }
                
                if (hit_second && push_cursor_r == er && push_cursor_c == ec) {
                    // Enemy piece is immediately blocked by a second piece.
                    int third_r = next_r + step_r;
                    int third_c = next_c + step_c;
                    
                    if (third_r >= 0 && third_r < 8 && third_c >= 0 && third_c < 8) {
                        int tsq = third_r * 8 + third_c;
                        if (!get_bit(occupancies[BOTH], tsq)) {
                            // Space behind! Push both!
                            clear_bit(pieces[second_color][second_type], second_sq);
                            hash ^= Zobrist::piece_keys[second_color][second_type][second_sq];
                            history[ply].destroyed[history[ply].num_destroyed++] = {second_sq, second_type, second_color};
                            
                            int push2_cursor_r = next_r;
                            int push2_cursor_c = next_c;
                            int n2_r = push2_cursor_r + step_r;
                            int n2_c = push2_cursor_c + step_c;
                            
                            bool is_pawn2 = (second_type == PAWN || (second_type >= GOLDEN_PAWN && second_type <= HORDELING));
                            bool is_own_forward2 = is_pawn2 && second_color == us && ((us == WHITE && step_r == -1) || (us == BLACK && step_r == 1));
                            while (n2_r >= 0 && n2_r < 8 && n2_c >= 0 && n2_c < 8) {
                                if (is_own_forward2 && ((us == WHITE && n2_r == 0) || (us == BLACK && n2_r == 7))) break;
                                if (get_bit(occupancies[BOTH], n2_r * 8 + n2_c)) break;
                                push2_cursor_r = n2_r;
                                push2_cursor_c = n2_c;
                                n2_r += step_r;
                                n2_c += step_c;
                            }
                            
                            int psq2 = push2_cursor_r * 8 + push2_cursor_c;
                            set_bit(pieces[second_color][second_type], psq2);
                            hash ^= Zobrist::piece_keys[second_color][second_type][psq2];
                            history[ply].spawned[history[ply].num_spawned++] = {psq2, second_type, second_color};
                            
                            history[ply].ability_old_states[history[ply].num_ability_updates] = ability_tracker[psq2];
                            history[ply].ability_update_sqs[history[ply].num_ability_updates++] = psq2;
                            ability_tracker[psq2] = ability_tracker[second_sq];
                            ability_tracker[psq2].frozen_turns = 0; // Pushed piece is no longer frozen at new square
                            
                            int psq1 = (push2_cursor_r - step_r) * 8 + (push2_cursor_c - step_c);
                            set_bit(pieces[piece_color1][enemy_type1], psq1);
                            hash ^= Zobrist::piece_keys[piece_color1][enemy_type1][psq1];
                            history[ply].spawned[history[ply].num_spawned++] = {psq1, enemy_type1, piece_color1};
                            
                            history[ply].ability_old_states[history[ply].num_ability_updates] = ability_tracker[psq1];
                            history[ply].ability_update_sqs[history[ply].num_ability_updates++] = psq1;
                            ability_tracker[psq1] = ability_tracker[esq];
                            ability_tracker[psq1].frozen_turns = 0; // Pushed piece is no longer frozen at new square
                        } else {
                            // Blocked by third piece -> no push happens!
                            set_bit(pieces[piece_color1][enemy_type1], esq);
                            hash ^= Zobrist::piece_keys[piece_color1][enemy_type1][esq];
                            history[ply].num_destroyed--; 
                        }
                    } else {
                        // Second piece falls off, first piece takes its place!
                        clear_bit(pieces[second_color][second_type], second_sq);
                        hash ^= Zobrist::piece_keys[second_color][second_type][second_sq];
                        history[ply].destroyed[history[ply].num_destroyed++] = {second_sq, second_type, second_color};
                        
                        set_bit(pieces[piece_color1][enemy_type1], second_sq);
                        hash ^= Zobrist::piece_keys[piece_color1][enemy_type1][second_sq];
                        history[ply].spawned[history[ply].num_spawned++] = {second_sq, enemy_type1, piece_color1};
                        
                        history[ply].ability_old_states[history[ply].num_ability_updates] = ability_tracker[second_sq];
                        history[ply].ability_update_sqs[history[ply].num_ability_updates++] = second_sq;
                        ability_tracker[second_sq] = ability_tracker[esq];
                        ability_tracker[second_sq].frozen_turns = 0; 
                    }
                } else {
                    if (push_cursor_r != er || push_cursor_c != ec) {
                        int psq = push_cursor_r * 8 + push_cursor_c;
                        set_bit(pieces[piece_color1][enemy_type1], psq);
                        hash ^= Zobrist::piece_keys[piece_color1][enemy_type1][psq];
                        history[ply].spawned[history[ply].num_spawned++] = {psq, enemy_type1, piece_color1};
                        
                        history[ply].ability_old_states[history[ply].num_ability_updates] = ability_tracker[psq];
                        history[ply].ability_update_sqs[history[ply].num_ability_updates++] = psq;
                        ability_tracker[psq] = ability_tracker[esq];
                        ability_tracker[psq].frozen_turns = 0; 
                    } else if (next_r < 0 || next_r > 7 || next_c < 0 || next_c > 7) {
                    } else {
                        set_bit(pieces[piece_color1][enemy_type1], esq);
                        hash ^= Zobrist::piece_keys[piece_color1][enemy_type1][esq];
                        history[ply].num_destroyed--; 
                    }
                }
                }
            }
        }
    }

    if (m.is_capture()) {
        U64 automatons = pieces[us][WAR_AUTOMATON];
        while (automatons) {
            int sq = (us == WHITE) ? pop_msb(automatons) : pop_lsb(automatons);

            if (sq == m.to()) continue; // DO NOT auto-advance the War Automaton that just made the capture
            int r = sq / 8;
            int c = sq % 8;
            int dir = (us == WHITE) ? 1 : -1;
            int next_r = r + dir;
            if (next_r >= 0 && next_r < 8) {
                int next_sq = next_r * 8 + c;
                if (!get_bit(occupancies[BOTH], next_sq)) {
                    clear_bit(pieces[us][WAR_AUTOMATON], sq);
                    set_bit(pieces[us][WAR_AUTOMATON], next_sq);
                    hash ^= Zobrist::piece_keys[us][WAR_AUTOMATON][sq];
                    hash ^= Zobrist::piece_keys[us][WAR_AUTOMATON][next_sq];
                    // Update occupancies temporarily so chaining works correctly
                    clear_bit(occupancies[us], sq);
                    set_bit(occupancies[us], next_sq);
                    clear_bit(occupancies[BOTH], sq);
                    set_bit(occupancies[BOTH], next_sq);
                    history[ply].automaton_from_sqs[history[ply].num_automatons_moved] = sq;
                    history[ply].automaton_to_sqs[history[ply].num_automatons_moved++] = next_sq;
                }
            }
        }
        
        U64 enemy_automatons = pieces[them][WAR_AUTOMATON];
        while (enemy_automatons) {
            int sq = (them == WHITE) ? pop_msb(enemy_automatons) : pop_lsb(enemy_automatons);

            int r = sq / 8;
            int c = sq % 8;
            int dir = (them == WHITE) ? 1 : -1;
            int next_r = r + dir;
            if (next_r >= 0 && next_r < 8) {
                int next_sq = next_r * 8 + c;
                if (!get_bit(occupancies[BOTH], next_sq)) {
                    clear_bit(pieces[them][WAR_AUTOMATON], sq);
                    set_bit(pieces[them][WAR_AUTOMATON], next_sq);
                    hash ^= Zobrist::piece_keys[them][WAR_AUTOMATON][sq];
                    hash ^= Zobrist::piece_keys[them][WAR_AUTOMATON][next_sq];
                    clear_bit(occupancies[them], sq);
                    set_bit(occupancies[them], next_sq);
                    clear_bit(occupancies[BOTH], sq);
                    set_bit(occupancies[BOTH], next_sq);
                    // Also tracking color is technically needed to undo them correctly!
                    // Wait, if it's enemy, we still just move it.
                    // But undo needs to know the color! Or we can just use get_piece_on_square.
                    history[ply].automaton_from_sqs[history[ply].num_automatons_moved] = sq;
                    history[ply].automaton_to_sqs[history[ply].num_automatons_moved++] = next_sq;
                }
            }
        }
    }
    
    update_occupancies(); // need to update occupancies BEFORE in_check evaluation!
    
    if (final_piece == HERO_PAWN && in_check((Color)them)) {
        clear_bit(pieces[us][HERO_PAWN], to);
        set_bit(pieces[us][QUEEN], to);
        hash ^= Zobrist::piece_keys[us][HERO_PAWN][to];
        hash ^= Zobrist::piece_keys[us][QUEEN][to];
        history[ply].destroyed[history[ply].num_destroyed++] = {to, HERO_PAWN, us};
        history[ply].spawned[history[ply].num_spawned++] = {to, QUEEN, us};
    }
    
    // --- DJINN RESPAWN ---
    if (m.is_capture()) {
        for (int c = 0; c < 2; c++) {
            if (dissipated_djinn_sqs[c] != NO_SQ) {
                int h_sq = dissipated_djinn_sqs[c];
                if (!get_bit(occupancies[BOTH], h_sq)) {
                    set_bit(pieces[c][DJINN], h_sq);
                    hash ^= Zobrist::piece_keys[c][DJINN][h_sq];
                    history[ply].spawned[history[ply].num_spawned++] = {h_sq, DJINN, c};
                    dissipated_djinn_sqs[c] = NO_SQ;
                }
            }
        }
    }
    
    // --- PILGRIM RESURRECTION ---
    if (final_piece == PILGRIM && !m.is_ability()) {
        int r1 = from / 8, c1 = from % 8;
        int r2 = to / 8, c2 = to % 8;
        int dr = r2 - r1; if (dr < 0) dr = -dr;
        int dc = c2 - c1; if (dc < 0) dc = -dc;
        int dist = (dr > dc) ? dr : dc;
        
        ability_tracker[to].pilgrim_dist += dist;
        
        if (ability_tracker[to].pilgrim_dist >= 20 && !ability_tracker[to].ability_used) {
            // Find highest value captured piece
            int best_type = PIECE_TYPE_NONE;
            int best_val = -1;
            
            // PIECE_VALUES mapping (simplified for Pilgrim priority: Q=900, R=500, B=330, N=320, P=100)
            int val_map[39] = {0};
            val_map[QUEEN] = 900; val_map[ROOK] = 500; val_map[BISHOP] = 330; val_map[KNIGHT] = 320; val_map[PAWN] = 100;
            
            for (int p = 0; p < 39; p++) {
                if (dead_pieces_count[us][p] > 0 && val_map[p] > best_val) {
                    // Only standard pieces for now, to match TS logic (deadAllies.filter(p => !p.pixie))
                    if (p == QUEEN || p == ROOK || p == BISHOP || p == KNIGHT || p == PAWN) {
                        best_val = val_map[p];
                        best_type = p;
                    }
                }
            }
            
            if (best_type != PIECE_TYPE_NONE) {
                int spawn_sq = NO_SQ;
                int dirs[8][2] = {{-1,0},{1,0},{0,-1},{0,1},{-1,-1},{-1,1},{1,-1},{1,1}};
                for (int i = 0; i < 8; i++) {
                    int er = r2 + dirs[i][0];
                    int ec = c2 + dirs[i][1];
                    if (er >= 0 && er < 8 && ec >= 0 && ec < 8) {
                        int nsq = er * 8 + ec;
                        if (!get_bit(occupancies[BOTH], nsq)) {
                            spawn_sq = nsq;
                            break;
                        }
                    }
                }
                
                if (spawn_sq != NO_SQ) {
                    set_bit(pieces[us][best_type], spawn_sq);
                    hash ^= Zobrist::piece_keys[us][best_type][spawn_sq];
                    history[ply].spawned[history[ply].num_spawned++] = {spawn_sq, best_type, us};
                    ability_tracker[to].ability_used = true;
                    
                    dead_pieces_count[us][best_type]--;
                    history[ply].resurrected_piece_type = best_type;
                    history[ply].resurrected_piece_color = (Color)us;
                }
            }
        }
    }
    
    // Increment dead_pieces_count for all destroyed pieces this ply
    for (int i = 0; i < history[ply].num_destroyed; i++) {
        const DestroyedPiece& dp = history[ply].destroyed[i];
        if (dp.piece_type != HORDELING) { // Don't add ephemeral hordelings to dead pool
            dead_pieces_count[dp.color][dp.piece_type]++;
        }
    }
    
    // 7. Update turn & ply
    bool gives_check = in_check((Color)them);
    if (final_piece == DANCER && ability_tracker[to].dancer_bonus_moves == 2 && !m.is_capture()) {
        ability_tracker[to].dancer_bonus_moves = 1;
        side_to_move = (Color)us; // DO NOT flip turn
        active_dancer_sq = to;
    } else if (final_piece == DANCER && ability_tracker[to].dancer_bonus_moves == 1) {
        ability_tracker[to].dancer_bonus_moves = 0;
        side_to_move = (Color)them; // Flip turn now
        active_dancer_sq = NO_SQ;
        hash ^= Zobrist::side_key;
        if (gives_check) {
            ability_tracker[to].dancer_bonus_moves = 2;
        }
    } else {
        side_to_move = (Color)them; // Normal behavior
        active_dancer_sq = NO_SQ;
        hash ^= Zobrist::side_key;
        if (final_piece == DANCER && gives_check) {
            ability_tracker[to].dancer_bonus_moves = 2;
        } else if (final_piece == DANCER) {
            ability_tracker[to].dancer_bonus_moves = 0;
        }
    }
    
    // 8. Destroy doomed pieces from the previous ply (Bladerunner mechanic)
    if (ply >= 1 && history[ply - 1].num_doomed > 0) {
        for (int i = 0; i < history[ply - 1].num_doomed; i++) {
            int dsq = history[ply - 1].doomed[i].sq;
            int dtype = history[ply - 1].doomed[i].piece_type;
            int dcolor = history[ply - 1].doomed[i].color;
            
            // If the doomed piece moved this turn, update its square!
            if (dcolor == us && dsq == from && dtype == piece) {
                dsq = to;
            }
            
            // Destroy the piece!
            if (get_bit(pieces[dcolor][dtype], dsq)) {
                clear_bit(pieces[dcolor][dtype], dsq);
                hash ^= Zobrist::piece_keys[dcolor][dtype][dsq];
                history[ply].destroyed[history[ply].num_destroyed++] = {dsq, dtype, dcolor};
            }
        }
    }
    
    if (side_to_move == WHITE && active_dancer_sq == NO_SQ) full_move_number++;
    
    // 9. Decrement Freeze Timers
    for (int i = 0; i < 64; ++i) {
        if (ability_tracker[i].frozen_turns > 0) {
            ability_tracker[i].frozen_turns--;
            history[ply].decremented_freezes |= (1ULL << i);
        }
    }
    
    // 10. Electroknight global reset for the player who just moved
    U64 reset_electroknights = pieces[us][ELECTROKNIGHT];
    // Exclude the piece that just moved, if it was an electroknight
    if (final_piece == ELECTROKNIGHT) {
        clear_bit(reset_electroknights, to);
    }
    while (reset_electroknights) {
        int esq = pop_lsb(reset_electroknights);
        if (ability_tracker[esq].electro_charges > 0) {
            history[ply].ability_old_states[history[ply].num_ability_updates] = ability_tracker[esq];
            history[ply].ability_update_sqs[history[ply].num_ability_updates++] = esq;
            ability_tracker[esq].electro_charges = 0;
        }
    }
    
    ply++;
    
    history[ply].num_gunslingers_updated = 0;
    
    // 8. Gunslinger Duel Tracking
    for (int c = 0; c < 2; c++) {
        U64 gunslingers = pieces[c][GUNSLINGER];
        while (gunslingers) {
            int sq = pop_lsb(gunslingers);
            int r = sq / 8;
            int col = sq % 8;
            int in_duel_with = NO_SQ;
            int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
            
            for (int i = 0; i < 4; i++) {
                int dr = dirs[i][0], dc = dirs[i][1];
                int cr = r + dr, cc = col + dc;
                while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
                    int t_sq = cr * 8 + cc;
                    if (get_bit(occupancies[BOTH], t_sq)) {
                        if (get_bit(occupancies[c ^ 1], t_sq)) {
                            in_duel_with = t_sq;
                        }
                        break;
                    }
                    cr += dr; cc += dc;
                }
                if (in_duel_with != NO_SQ) break;
            }
            
            // Save state if not already saved (from or to)
            if (sq != from && sq != to && history[ply].num_gunslingers_updated < 128) {
                history[ply].gunslinger_old_states[history[ply].num_gunslingers_updated] = ability_tracker[sq];
                history[ply].gunslinger_update_sqs[history[ply].num_gunslingers_updated++] = sq;
            }
            
            if (in_duel_with != NO_SQ) {
                if (ability_tracker[sq].gunslinger_target_sq != in_duel_with) {
                    ability_tracker[sq].gunslinger_target_sq = in_duel_with;
                    ability_tracker[sq].gunslinger_mutual_ply = 0;
                } else {
                    ability_tracker[sq].gunslinger_mutual_ply++;
                }
            } else {
                ability_tracker[sq].gunslinger_target_sq = NO_SQ;
                ability_tracker[sq].gunslinger_mutual_ply = 0;
            }
        }
    }
    
    last_move_dest_sq = to;
    en_passant_sq = NO_SQ; // Reset EP, to be handled properly later
    
    // Set En Passant square for double pawn pushes
    bool is_pawn = (final_piece == PAWN || (final_piece >= GOLDEN_PAWN && final_piece <= WAR_AUTOMATON));
    if (is_pawn && !is_drop && !is_limbo_jump && captured == PIECE_TYPE_NONE) {
        int fr = from / 8;
        int r = to / 8;
        if (r - fr == 2) {
            en_passant_sq = from + 8;
        } else if (r - fr == -2) {
            en_passant_sq = from - 8;
        }
    }
    
    update_occupancies();
}

void Board::undo_move(Move m) {
    ply--;
    
    // 0. Restore decremented freeze timers
    U64 freezes = history[ply].decremented_freezes;
    while (freezes) {
        int sq = pop_lsb(freezes);
        ability_tracker[sq].frozen_turns++;
    }
    
    // Use the reliable side_to_move that initiated this ply!
    int us = history[ply].side_to_move;
    int them = us ^ 1;
    side_to_move = (Color)us;
    
    int from = m.from();
    int to = m.to();
    int piece = m.piece();
    int captured = history[ply].captured_piece;
    
    // 1. Restore state from history
    en_passant_sq = history[ply].en_passant_sq;
    castling_rights = history[ply].castling_rights;
    half_move_clock = history[ply].half_move_clock;
    hash = history[ply].hash; 
    full_move_number = history[ply].full_move_number;
    last_move_dest_sq = history[ply].last_move_dest_sq;
    
    active_dancer_sq = history[ply].active_dancer_sq;
    dissipated_djinn_sqs[0] = history[ply].dissipated_djinn_sqs[0];
    dissipated_djinn_sqs[1] = history[ply].dissipated_djinn_sqs[1]; 
    
    num_knightmares_limbo[0] = history[ply].num_knightmares_limbo[0];
    num_knightmares_limbo[1] = history[ply].num_knightmares_limbo[1];
    for(int i=0; i<16; i++) {
        knightmare_limbo_coords[0][i] = history[ply].knightmare_limbo_coords[0][i];
        knightmare_limbo_coords[1][i] = history[ply].knightmare_limbo_coords[1][i];
    }
    
    ability_tracker[from] = history[ply].from_state;
    ability_tracker[to] = history[ply].to_state;
    
    // Restore Gunslinger updates
    for (int i = 0; i < history[ply].num_gunslingers_updated; i++) {
        int g_sq = history[ply].gunslinger_update_sqs[i];
        ability_tracker[g_sq] = history[ply].gunslinger_old_states[i];
    }
    
    // Restore generic ability updates (e.g. SumoRook pushes)
    for (int i = 0; i < history[ply].num_ability_updates; i++) {
        int a_sq = history[ply].ability_update_sqs[i];
        ability_tracker[a_sq] = history[ply].ability_old_states[i];
    }
    
    // Reverse War Automaton movements (Reverse chronological order)
    for (int i = history[ply].num_automatons_moved - 1; i >= 0; i--) {
        int f_sq = history[ply].automaton_from_sqs[i];
        int t_sq = history[ply].automaton_to_sqs[i];
        // We know it's a WAR_AUTOMATON, but we need its color. 
        // We can just check which color bitboard has it at t_sq.
        int color = get_bit(pieces[WHITE][WAR_AUTOMATON], t_sq) ? WHITE : BLACK;
        clear_bit(pieces[color][WAR_AUTOMATON], t_sq);
        set_bit(pieces[color][WAR_AUTOMATON], f_sq);
    }
    
    // Remove spawned pieces
    for (int i = 0; i < history[ply].num_spawned; i++) {
        const DestroyedPiece& sp = history[ply].spawned[i];
        clear_bit(pieces[sp.color][sp.piece_type], sp.sq);
    }
    
    // Restore Pilgrim resurrection to dead pool
    if (history[ply].resurrected_piece_type != PIECE_TYPE_NONE) {
        dead_pieces_count[history[ply].resurrected_piece_color][history[ply].resurrected_piece_type]++;
    }
    
    // Restore destroyed pieces
    for (int i = 0; i < history[ply].num_destroyed; i++) {
        const DestroyedPiece& dp = history[ply].destroyed[i];
        set_bit(pieces[dp.color][dp.piece_type], dp.sq);
        if (dp.piece_type != HORDELING) {
            dead_pieces_count[dp.color][dp.piece_type]--;
        }
    }
    
    // 2. Remove piece from destination
    bool is_drop = (piece == KNIGHTMARE && from == to && !m.is_ability());
    bool is_limbo_to_limbo = (piece == KNIGHTMARE && m.is_ability() && m.captured() <= 7);
    bool is_limbo_jump = (piece == KNIGHTMARE && m.is_ability() && !is_limbo_to_limbo);
    bool is_dissipate = (piece == DJINN && m.is_ability());
    bool is_duel = (piece == GUNSLINGER && m.is_ability());
    
    int final_piece = piece;
    if (m.promoted() != PIECE_TYPE_NONE && !is_drop && !is_limbo_jump && !is_limbo_to_limbo) {
        final_piece = m.promoted();
    }
    
    if (!is_dissipate && !is_duel && !is_limbo_jump && !is_limbo_to_limbo) {
        clear_bit(pieces[us][final_piece], to);
    }
    
    // 3. Put piece back on origin
    if (!is_drop && !is_limbo_to_limbo) {
        set_bit(pieces[us][piece], from);
    }
    
    // 4. Restore captured piece
    if (m.is_capture() && captured != PIECE_TYPE_NONE) {
        int cap_sq = to;
        if (m.is_ability()) {
            if (piece == SHRIKE) {
                if (m.promoted() == 0) {
                    cap_sq = from + ((us == WHITE) ? 8 : -8);
                } else {
                    cap_sq = to;
                }
            } else if (piece == PAWN || (piece >= GOLDEN_PAWN && piece <= WAR_AUTOMATON)) {
                cap_sq = to + ((us == WHITE) ? -8 : 8);
            }
        }
        set_bit(pieces[them][captured], cap_sq);
        dead_pieces_count[them][captured]--;
    }
    
    // 5. Revert turn
    side_to_move = (Color)us;
    
    update_occupancies();
}

bool Board::is_square_attacked(int sq, Color attacker_color) const {
    U64 disabled = 0ULL;
    Color defender_color = (attacker_color == WHITE) ? BLACK : WHITE;
    
    U64 defender_av = pieces[defender_color][ANTI_VIOLENCE];
    while (defender_av) { int av_sq = pop_lsb(defender_av); disabled |= KING_ATTACKS[av_sq]; }
    
    U64 defender_basilisks = pieces[defender_color][BASILISK];
    while (defender_basilisks) { int b_sq = pop_lsb(defender_basilisks); disabled |= get_sliding_attacks(b_sq, occupancies[BOTH], true, false); }
    
    for (int i = 0; i < 64; ++i) { if (ability_tracker[i].frozen_turns > 0) disabled |= (1ULL << i); }

    U64 valid_attackers = ~disabled;

    U64 attackers = (pieces[attacker_color][PAWN] | pieces[attacker_color][GOLDEN_PAWN] | 
                     pieces[attacker_color][BLUEPRINT] | 
                     pieces[attacker_color][EPEE_PAWN] | pieces[attacker_color][PAWN_KNIFE] | 
                     pieces[attacker_color][HERO_PAWN] | pieces[attacker_color][WARP_JUMPER] | 
                     pieces[attacker_color][WAR_AUTOMATON] | pieces[attacker_color][SHRIKE] | 
                     pieces[attacker_color][HORDELING]) & valid_attackers;
    if (attacker_color == WHITE) {
        if (sq > 7 && ((sq - 7) % 8 != 0) && get_bit(attackers, sq - 7)) return true; // right
        if (sq > 9 && ((sq - 9) % 8 != 7) && get_bit(attackers, sq - 9)) return true; // left
    } else {
        if (sq < 56 && ((sq + 7) % 8 != 7) && get_bit(attackers, sq + 7)) return true;
        if (sq < 54 && ((sq + 9) % 8 != 0) && get_bit(attackers, sq + 9)) return true;
    }

    U64 knights = (pieces[attacker_color][KNIGHT] | pieces[attacker_color][ELECTROKNIGHT] | 
                   pieces[attacker_color][BANKER] | pieces[attacker_color][KNIGHTMARE] | 
                   pieces[attacker_color][PINATA] | pieces[attacker_color][FISH_KNIGHT]) & valid_attackers;
    if (KNIGHT_ATTACKS[sq] & knights) return true;
    
    // --- PAWN KNIFE (2,2) attacks ---
    U64 pawn_knives = pieces[attacker_color][PAWN_KNIFE] & valid_attackers;
    while (pawn_knives) {
        int pk_sq = pop_lsb(pawn_knives);
        int pk_r = pk_sq / 8;
        int pk_c = pk_sq % 8;
        int dir = (attacker_color == WHITE) ? 1 : -1;
        int r = sq / 8;
        int c = sq % 8;
        
        // Check if sq is a valid (2,2) jump target from pk_sq
        if (r == pk_r + 2 * dir && (c == pk_c - 2 || c == pk_c + 2)) {
            // Check toward_center condition
            int dc = c - pk_c;
            bool toward_center = (dc < 0) ? (pk_c > 3) : (pk_c < 4);
            if (toward_center) {
                // Check intermediate square is empty
                int intermediate_sq = (pk_r + dir) * 8 + (pk_c + dc / 2);
                if (!get_bit(occupancies[BOTH], intermediate_sq)) {
                    return true;
                }
            }
        }
    }
    
    U64 kings = (pieces[attacker_color][KING] | pieces[attacker_color][ROCKETMAN]) & valid_attackers;
    if (KING_ATTACKS[sq] & kings) return true;
    
    // Dynamic MARAUDER attacks
    U64 marauders = pieces[attacker_color][MARAUDER];
    while (marauders) {
        int m_sq = pop_lsb(marauders);
        int kills = ability_tracker[m_sq].marauder_kills;
        int max_range = 1 + (kills * 2);
        
        int r = m_sq / 8;
        int c = m_sq % 8;
        int tr = sq / 8;
        int tc = sq % 8;
        
        int dr = tr - r;
        int dc = tc - c;
        int abs_dr = dr < 0 ? -dr : dr;
        int abs_dc = dc < 0 ? -dc : dc;
        
        // Check if sq is within Marauder's 8-direction sliding path
        if ((dr == 0 || dc == 0 || abs_dr == abs_dc) && abs_dr <= max_range && abs_dc <= max_range) {
            if (get_bit(disabled, m_sq)) continue;
            // Check if blocked by any piece in between
            int step_r = (dr == 0) ? 0 : (dr > 0 ? 1 : -1);
            int step_c = (dc == 0) ? 0 : (dc > 0 ? 1 : -1);
            int cr = r + step_r;
            int cc = c + step_c;
            bool blocked = false;
            while (cr != tr || cc != tc) {
                if (get_bit(occupancies[BOTH], cr * 8 + cc)) {
                    blocked = true;
                    break;
                }
                cr += step_r;
                cc += step_c;
            }
            if (!blocked) return true;
        }
    }

    // Remove Dancers that are locking the turn (bonus_moves > 0), because they cannot capture!
    U64 all_pieces = occupancies[BOTH];
    U64 capturing_dancers = pieces[attacker_color][DANCER] & valid_attackers;
    U64 temp_dancers = capturing_dancers;
    while (temp_dancers) {
        int d_sq = pop_lsb(temp_dancers);
        if (ability_tracker[d_sq].dancer_bonus_moves > 0) {
            clear_bit(capturing_dancers, d_sq);
        }
    }

    // Note: BASILISK and ICICLE are EXCLUDED because they move like Bishops but CANNOT capture!
    U64 bishop_queen = (pieces[attacker_color][BISHOP] | pieces[attacker_color][QUEEN] | 
                        pieces[attacker_color][FISSION_REACTOR] | pieces[attacker_color][ARISTOCRAT] | 
                        pieces[attacker_color][PILGRIM] | capturing_dancers | 
                        pieces[attacker_color][DJINN] | pieces[attacker_color][GUNSLINGER] | 
                        pieces[attacker_color][CARDINAL] | pieces[attacker_color][HORDE_MOTHER]) & valid_attackers;
    if (get_sliding_attacks(sq, all_pieces, true, false) & bishop_queen) return true;

    // BLADERUNNER attacks (passes through enemies, blocked ONLY by friendly pieces, MUST have an empty square to land on)
    U64 bladerunners = pieces[attacker_color][BLADERUNNER] & valid_attackers;
    U64 invulnerable = pieces[WHITE][IRONPAWN] | pieces[BLACK][IRONPAWN];
    while (bladerunners) {
        int br_sq = pop_lsb(bladerunners);
        int dr = (sq / 8) - (br_sq / 8);
        int dc = (sq % 8) - (br_sq % 8);
        int abs_dr = dr < 0 ? -dr : dr;
        int abs_dc = dc < 0 ? -dc : dc;
        if (abs_dr == abs_dc && abs_dr > 0) { // On same diagonal
            int step_r = dr > 0 ? 1 : -1;
            int step_c = dc > 0 ? 1 : -1;
            int cr = (br_sq / 8) + step_r;
            int cc = (br_sq % 8) + step_c;
            bool blocked = false;
            while (cr != (sq / 8) && cc != (sq % 8)) {
                int intermediate_sq = cr * 8 + cc;
                if (get_bit(occupancies[attacker_color], intermediate_sq) || get_bit(invulnerable, intermediate_sq)) {
                    blocked = true;
                    break;
                }
                cr += step_r;
                cc += step_c;
            }
            if (!blocked) {
                // Check if there is an empty square BEHIND sq
                cr = (sq / 8) + step_r;
                cc = (sq % 8) + step_c;
                bool found_empty = false;
                while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
                    int behind_sq = cr * 8 + cc;
                    if (get_bit(occupancies[attacker_color], behind_sq) || get_bit(invulnerable, behind_sq)) {
                        break; // Blocked by friendly
                    }
                    if (!get_bit(all_pieces, behind_sq)) {
                        found_empty = true;
                        break;
                    }
                    cr += step_r;
                    cc += step_c;
                }
                if (found_empty) return true;
            }
        }
    }

    U64 rook_queen = (pieces[attacker_color][ROOK] | pieces[attacker_color][QUEEN] | 
                      pieces[attacker_color][FISSION_REACTOR] | pieces[attacker_color][PHASE_ROOK]) & valid_attackers;
    if (get_sliding_attacks(sq, all_pieces, false, true) & rook_queen) return true;

    // CAMEL attacks (3,1 jumps)
    U64 camels = pieces[attacker_color][CAMEL];
    while (camels) {
        int c_sq = pop_lsb(camels);
        if (get_bit(disabled, c_sq)) continue;
        int dr = (sq / 8) - (c_sq / 8);
        int dc = (sq % 8) - (c_sq % 8);
        int abs_dr = dr < 0 ? -dr : dr;
        int abs_dc = dc < 0 ? -dc : dc;
        if ((abs_dr == 3 && abs_dc == 1) || (abs_dr == 1 && abs_dc == 3)) return true;
    }
    
    // SHRIKE 2-step forward captures (from starting rank only)
    U64 shrikes = pieces[attacker_color][SHRIKE];
    while (shrikes) {
        int s_sq = pop_lsb(shrikes);
        if (get_bit(disabled, s_sq)) continue;
        int sr = s_sq / 8;
        int sc = s_sq % 8;
        int start_row = (attacker_color == WHITE) ? 1 : 6;
        if (sr == start_row) {
            int dir = (attacker_color == WHITE) ? 1 : -1;
            int mid_r = sr + dir;
            int to_r = sr + 2 * dir;
            
            int r = sq / 8;
            int c = sq % 8;
            
            if (c == sc) {
                if (r == mid_r) {
                    // Check if destination is empty
                    int to_sq = to_r * 8 + sc;
                    if (!get_bit(occupancies[BOTH], to_sq)) return true;
                } else if (r == to_r) {
                    // Check if mid is empty
                    int mid_sq = mid_r * 8 + sc;
                    if (!get_bit(occupancies[BOTH], mid_sq)) return true;
                }
            }
        }
    }

    // Knightmare Limbo off-board attacks
    if (num_knightmares_limbo[attacker_color] > 0) {
        int r = sq / 8;
        int c = sq % 8;
        int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
        for (int i = 0; i < num_knightmares_limbo[attacker_color]; i++) {
            uint8_t encoded = knightmare_limbo_coords[attacker_color][i];
            int ob_r = (encoded >> 4) - 2;
            int ob_c = (encoded & 0xF) - 2;
            
            for (int d = 0; d < 8; d++) {
                if (r - km_dirs[d][0] == ob_r && c - km_dirs[d][1] == ob_c) {
                    return true;
                }
            }
        }
    }

    // BOUNCER attacks
    U64 bouncers = pieces[attacker_color][BOUNCER];
    while (bouncers) {
        int b_sq = pop_lsb(bouncers);
        if (get_bit(disabled, b_sq)) continue;
        int br = b_sq / 8;
        int bc = b_sq % 8;
        
        int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
        for (int i = 0; i < 4; i++) {
            int r = br;
            int c = bc;
            int dr = dirs[i][0];
            int dc = dirs[i][1];
            bool bounced = false;
            while (true) {
                int nr = r + dr;
                int nc = c + dc;
                if (nr < 0 || nr > 7) {
                    if (bounced) break;
                    dr = -dr; bounced = true; nr = r + dr;
                }
                if (nc < 0 || nc > 7) {
                    if (bounced) break;
                    dc = -dc; bounced = true; nc = c + dc;
                }
                if (nr < 0 || nr > 7 || nc < 0 || nc > 7) break;
                
                int nsq = nr * 8 + nc;
                if (nsq == sq) return true; // Hits the target square!
                
                if (get_bit(occupancies[BOTH], nsq)) break; // Blocked by a piece
                
                r = nr; c = nc;
            }
        }
    }

    return false;
}

bool Board::in_check(Color color) const {
    U64 king_bb = pieces[color][KING] | pieces[color][ROCKETMAN];
    if (!king_bb) return false;
    int king_sq = get_lsb(king_bb);
    return is_square_attacked(king_sq, color == WHITE ? BLACK : WHITE);
}


void Board::destroy_piece(int sq, int p_type, Color p_color) {
    if (!get_bit(pieces[p_color][p_type], sq)) return;
    
    clear_bit(pieces[p_color][p_type], sq);
    hash ^= Zobrist::piece_keys[p_color][p_type][sq];
    history[ply].destroyed[history[ply].num_destroyed++] = {sq, p_type, p_color};
    
    if (p_type == HORDE_MOTHER || p_type == HORDELING) {
        U64 horde = pieces[p_color][HORDE_MOTHER] | pieces[p_color][HORDELING];
        while (horde) {
            int sq2 = pop_lsb(horde);
            int t2 = get_piece_on_square(sq2);
            if (t2 != PIECE_TYPE_NONE) destroy_piece(sq2, t2, p_color);
        }
    }
}
