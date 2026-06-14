#include <emscripten.h>
#include "board.h"
#include "movegen.h"
#include "pixiegen.h"
#include "rays.h"
#include "zobrist.h"
#include "tt.h"
#include <string>
#include <vector>
#include <sstream>

static bool engine_initialized = false;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void init_engine() {
    if (engine_initialized) return;
    init_leaper_masks();
    init_ray_masks();
    Zobrist::init();
    TT::init(16); // 16MB TT for WASM (smaller than native)
    engine_initialized = true;
}

EMSCRIPTEN_KEEPALIVE
const char* get_legal_moves_json(const char* pfen_cstr) {
    // Auto-initialize if not yet done
    if (!engine_initialized) init_engine();
    
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    
    MoveList pseudo;
    
    // Generate standard moves FIRST, because DANCER FILTER inside generate_pixie_moves 
    // expects to filter the cumulative list of standard + pixie moves!
    generate_pseudo_legal_moves(*b, pseudo);
    generate_pixie_moves(*b, pseudo);
    
    // Filter strictly legal moves
    MoveList ml;
    for(int i = 0; i < pseudo.count; ++i) {
        Move m = pseudo.moves[i];
        Color us = b->side_to_move;
        b->do_move(m);
        // If making the move leaves the king in check, it's illegal.
        if (!b->in_check(us)) {
            ml.add(m);
        }
        b->undo_move(m);
    }
    
    // Build JSON string
    std::stringstream json;
    json << "[";
    for(int i = 0; i < ml.count; ++i) {
        Move m = ml.moves[i];
        int from = m.from();
        int to = m.to();
        int r_from = 7 - (from / 8);
        int c_from = from % 8;
        int r_to = 7 - (to / 8);
        int c_to = to % 8;
        
        json << "{\"from\":[" << r_from << "," << c_from << "],";
        json << "\"to\":[" << r_to << "," << c_to << "],";
        json << "\"capture\":" << (m.is_capture() ? "true" : "false") << ",";
        json << "\"ability\":" << (m.is_ability() ? "true" : "false") << ",";
        json << "\"moveValue\":" << m.data << "}";
        if (i < ml.count - 1) json << ",";
    }
    json << "]";
    
    delete b;
    
    // NOTE: static string keeps memory alive after function returns.
    // NOT thread-safe — safe for single-threaded WASM but must be changed
    // if this binding is ever called from web workers concurrently.
    static std::string result;
    result = json.str();
    return result.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* test_is_attacked(const char* pfen_cstr, int sq, int attacker_color) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    
    // We'll reimplement the checks to trace it
    Color ac = (Color)attacker_color;
    U64 disabled = 0ULL;
    // same disabled logic...
    for (int i = 0; i < 64; ++i) { if (b->ability_tracker[i].frozen_turns > 0) disabled |= (1ULL << i); }
    U64 valid_attackers = ~disabled;
    
    std::string reason = "false";
    
    U64 pawns = (b->pieces[ac][PAWN] | b->pieces[ac][GOLDEN_PAWN] | b->pieces[ac][BLUEPRINT] | b->pieces[ac][EPEE_PAWN] | b->pieces[ac][PAWN_KNIFE] | b->pieces[ac][HERO_PAWN] | b->pieces[ac][WARP_JUMPER] | b->pieces[ac][WAR_AUTOMATON] | b->pieces[ac][SHRIKE]) & valid_attackers;
    if (ac == WHITE) {
        if (sq > 7 && ((sq - 7) % 8 != 0) && get_bit(pawns, sq - 7)) reason = "true (pawn)";
        if (sq > 9 && ((sq - 9) % 8 != 7) && get_bit(pawns, sq - 9)) reason = "true (pawn)";
    } else {
        if (sq < 56 && ((sq + 7) % 8 != 7) && get_bit(pawns, sq + 7)) reason = "true (pawn)";
        if (sq < 54 && ((sq + 9) % 8 != 0) && get_bit(pawns, sq + 9)) reason = "true (pawn)";
    }
    
    U64 knights = (b->pieces[ac][KNIGHT] | b->pieces[ac][ELECTROKNIGHT] | b->pieces[ac][BANKER] | b->pieces[ac][KNIGHTMARE] | b->pieces[ac][PINATA] | b->pieces[ac][FISH_KNIGHT]) & valid_attackers;
    if (KNIGHT_ATTACKS[sq] & knights) reason = "true (knight)";
    
    U64 kings = (b->pieces[ac][KING] | b->pieces[ac][ROCKETMAN]) & valid_attackers;
    if (KING_ATTACKS[sq] & kings) reason = "true (king)";
    
    // Check sliding attacks
    U64 bq = (b->pieces[ac][BISHOP] | b->pieces[ac][QUEEN] | b->pieces[ac][FISSION_REACTOR] | b->pieces[ac][ARISTOCRAT] | b->pieces[ac][PILGRIM] | b->pieces[ac][DJINN] | b->pieces[ac][GUNSLINGER] | b->pieces[ac][CARDINAL] | b->pieces[ac][HORDE_MOTHER]) & valid_attackers;
    if (get_sliding_attacks(sq, b->occupancies[BOTH], true, false) & bq) reason = "true (bishop/queen)";
    
    U64 br = b->pieces[ac][BLADERUNNER] & valid_attackers;
    if (get_sliding_attacks(sq, b->occupancies[ac], true, false) & br) reason = "true (bladerunner)";
    
    U64 rq = (b->pieces[ac][ROOK] | b->pieces[ac][QUEEN] | b->pieces[ac][FISSION_REACTOR]) & valid_attackers;
    if (get_sliding_attacks(sq, b->occupancies[BOTH], false, true) & rq) reason = "true (rook/queen)";
    
    U64 pr = b->pieces[ac][PHASE_ROOK] & valid_attackers;
    if (get_sliding_attacks(sq, 0, false, true) & pr) reason = "true (phase_rook)";
    
    U64 camels = b->pieces[ac][CAMEL] & valid_attackers;
    // basic camel check
    
    static std::string res;
    if (reason == "false") {
        std::stringstream dbg;
        dbg << "false. knights_bb=" << knights << " valid_attackers=" << valid_attackers << " KNIGHT_ATTACKS[50]=" << KNIGHT_ATTACKS[sq];
        res = dbg.str();
    } else {
        res = reason;
    }
    delete b;
    return res.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* test_ability_used(const char* pfen_cstr, int sq) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    bool used = b->ability_tracker[sq].ability_used;
    delete b;
    static std::string res;
    res = used ? "true" : "false";
    return res.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* test_pseudo_moves(const char* pfen_cstr) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    
    MoveList pseudo;
    generate_pseudo_legal_moves(*b, pseudo);
    generate_pixie_moves(*b, pseudo);
    
    std::stringstream json;
    json << "[";
    for(int i = 0; i < pseudo.count; ++i) {
        Move m = pseudo.moves[i];
        json << "{\"from\":[" << (7 - (m.from() / 8)) << "," << (m.from() % 8) << "],";
        json << "\"piece\":" << m.piece() << ",\"to\":[" << (7 - (m.to() / 8)) << "," << (m.to() % 8) << "]},";
    }
    json << "{\"rocketmen_bb\":" << b->pieces[b->side_to_move][ROCKETMAN] << "},";
    json << "{\"phase_rooks_bb\":" << b->pieces[b->side_to_move][PHASE_ROOK] << "},";
    
    // Calculate paralyzed squares exactly as in board.cpp
    U64 paralyzed_squares = 0ULL;
    int them = b->side_to_move ^ 1;
    U64 basilisks = b->pieces[them][BASILISK];
    while (basilisks) {
        int sq = __builtin_ctzll(basilisks); basilisks &= basilisks - 1;
        paralyzed_squares |= KING_ATTACKS[sq];
    }
    for (int sq = 0; sq < 64; sq++) {
        if (b->ability_tracker[sq].frozen_turns > 0) {
            paralyzed_squares |= (1ULL << sq);
        }
    }
    json << "{\"paralyzed_squares\":" << paralyzed_squares << "},";
    // Calculate Phase Rook attacks manually to debug
    U64 pr20_attacks = 0ULL;
    U64 pr26_attacks = 0ULL;
    U64 phase_rooks = b->pieces[b->side_to_move][PHASE_ROOK];
    
    // Reproduce the exact logic from pixiegen.cpp
    U64 our_pieces = b->occupancies[b->side_to_move];
    U64 enemy_pieces = b->occupancies[b->side_to_move ^ 1];
    U64 av_aura = 0ULL;
    U64 avs = b->pieces[b->side_to_move ^ 1][ANTI_VIOLENCE];
    while(avs) {
        int sq = __builtin_ctzll(avs); avs &= avs - 1;
        av_aura |= KING_ATTACKS[sq];
    }
    
    while(phase_rooks) {
        int sq = __builtin_ctzll(phase_rooks); phase_rooks &= phase_rooks - 1;
        U64 attacks = get_sliding_attacks(sq, 0ULL, false, true);
        attacks &= ~our_pieces;
        if ((av_aura >> sq) & 1) attacks &= ~enemy_pieces;
        
        if (sq == 20) pr20_attacks = attacks;
        if (sq == 26) pr26_attacks = attacks;
    }
    
    json << "{\"pr20_attacks\":" << pr20_attacks << "},";
    json << "{\"pr26_attacks\":" << pr26_attacks << "},";
    json << "{\"empty_squares\":" << (~b->occupancies[BOTH]) << "}]";
    delete b;
    static std::string res;
    res = json.str();
    return res.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* test_after_move(const char* pfen_cstr, int f, int t, int p, int c, int pr, bool cap, bool ability) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    Move m(f, t, p, c, pr, cap, ability);
    Color us = b->side_to_move;
    b->do_move(m);
    bool inCheck = b->in_check(us);
    delete b;
    static std::string res;
    res = inCheck ? "true" : "false";
    return res.c_str();
}

EMSCRIPTEN_KEEPALIVE
int test_move_legality(const char* pfen_cstr, int f, int t) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    MoveList pseudo;
    generate_pseudo_legal_moves(*b, pseudo);
    generate_pixie_moves(*b, pseudo);
    for(int i=0; i<pseudo.count; i++) {
        if(pseudo.moves[i].from() == f && pseudo.moves[i].to() == t) {
            Board* copy = new Board(*b);
            Color us = copy->side_to_move;
            copy->do_move(pseudo.moves[i]);
            int res;
            if (copy->in_check(us)) {
                res = 0; // Illegal (leaves king in check)
            } else {
                res = 1; // Legal
            }
            delete copy;
            delete b;
            return res;
        }
    }
    delete b;
    return -1; // Not generated pseudo
}

EMSCRIPTEN_KEEPALIVE
const char* debug_move_legality(const char* pfen_cstr, int f, int t) {
    if (!engine_initialized) init_engine();
    Board* b = new Board();
    b->init_from_pfen(pfen_cstr);
    MoveList pseudo;
    generate_pseudo_legal_moves(*b, pseudo);
    generate_pixie_moves(*b, pseudo);
    for(int i=0; i<pseudo.count; i++) {
        if(pseudo.moves[i].from() == f && pseudo.moves[i].to() == t) {
            Board* copy = new Board(*b);
            Color us = copy->side_to_move;
            copy->do_move(pseudo.moves[i]);
            
            std::stringstream ss;
            ss << "Move applied. side_to_move=" << us << "\n";
            U64 king_bb = copy->pieces[us][KING] | copy->pieces[us][ROCKETMAN];
            ss << "king_bb=" << king_bb << "\n";
            if (!king_bb) {
                ss << "No king found!\n";
            } else {
                int king_sq = __builtin_ctzll(king_bb);
                ss << "king_sq=" << king_sq << "\n";
                bool attacked = copy->is_square_attacked(king_sq, us == WHITE ? BLACK : WHITE);
                ss << "is_square_attacked=" << attacked << "\n";
                if (attacked) {
                    // Let's find exactly which piece is attacking
                    Color attacker_color = us == WHITE ? BLACK : WHITE;
                    for (int pt = 0; pt < 38; pt++) {
                        U64 pbb = copy->pieces[attacker_color][pt];
                        while(pbb) {
                            int atk_sq = __builtin_ctzll(pbb); pbb &= pbb - 1;
                            
                            // Save all piece bitboards
                            U64 saved[38];
                            for (int i=0; i<38; i++) {
                                saved[i] = copy->pieces[attacker_color][i];
                                copy->pieces[attacker_color][i] = 0; // clear all
                            }
                            copy->pieces[attacker_color][pt] = (1ULL << atk_sq);
                            
                            if (copy->is_square_attacked(king_sq, attacker_color)) {
                                ss << "Attacked by piece type " << pt << " at sq " << atk_sq << "\n";
                            }
                            
                            // Restore
                            for (int i=0; i<38; i++) {
                                copy->pieces[attacker_color][i] = saved[i];
                            }
                        }
                    }
                }
            }
            
            delete copy;
            delete b;
            static std::string res;
            res = ss.str();
            return res.c_str();
        }
    }
    delete b;
    return "Move not found in pseudo legal";
}

}
