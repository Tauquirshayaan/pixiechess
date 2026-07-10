#ifndef BOARD_H
#define BOARD_H

#include "types.h"
#include "bitboard.h"
#include <string>
#include <vector>

// Tracks stateful variables for Pixies on a specific square
struct AbilityState {
    int frozen_turns;
    int electro_moves;
    int electro_idle;
    int marauder_kills;
    int fission_captures; // Added for Fission Reactor
    bool ability_used; // e.g. Rocketman teleport, Pilgrim resurrect
    
    int pilgrim_dist;
    bool djinn_dissipated;
    int djinn_home_sq;
    int dancer_bonus_moves;
    bool dancer_active;
    uint32_t gunslinger_targets; // Encodes up to 4 targets (1 byte each). 0xFF = empty.
    bool fish_moved;
    int icicle_adj_turns;
    
    AbilityState() : frozen_turns(0), electro_moves(0), electro_idle(0), marauder_kills(0), fission_captures(0), ability_used(false),
                     pilgrim_dist(0), djinn_dissipated(false), djinn_home_sq(NO_SQ), dancer_bonus_moves(0), 
                     dancer_active(false), gunslinger_targets(0xFFFFFFFF), fish_moved(false), icicle_adj_turns(0) {}
};

struct DestroyedPiece {
    int sq;
    int piece_type;
    int color;
};

struct StateHistory {
    int en_passant_sq;
    int castling_rights;
    int half_move_clock;
    int captured_piece;
    int last_move_dest_sq;
    U64 hash;
    
    // Ability State Backups
    AbilityState from_state;
    AbilityState to_state;
    
    // Board Modifications (Explosions, Spawns, Electro-zaps)
    int num_destroyed;
    DestroyedPiece destroyed[128]; // Safe upper bound for massive explosions or Horde Mother wipes
    
    int num_spawned;
    DestroyedPiece spawned[128]; // Track up to 128 spawned/relocated pieces
    
    // War Automaton tracking
    int num_automatons_moved;
    int automaton_from_sqs[128];
    int automaton_to_sqs[128];
    
    // Bladerunner Doom tracking
    int num_doomed;
    DestroyedPiece doomed[128]; // Pieces marked for death next turn
    
    // Freeze countdown tracking
    U64 decremented_freezes;
    
    // Phase 2 Tracker
    int active_dancer_sq;
    int dissipated_djinn_sqs[2];
    Color side_to_move; // The player who initiated this move
    int full_move_number;
    U64 frozen_pieces; // Fast lookup bitboard for frozen pieces
    U64 active_pixies[2]; // Bitmask for active power pieces (needs 36 bits)

    
    // Pilgrim Resurrection Tracking
    int resurrected_piece_type;
    Color resurrected_piece_color;
    
    // Phase 3: Gunslinger Updates
    int num_gunslingers_updated;
    int gunslinger_update_sqs[128];
    AbilityState gunslinger_old_states[128];
    
    // SumoRook Push & Global Tracking (General ability tracker saves)
    int num_ability_updates;
    int ability_update_sqs[64];
    AbilityState ability_old_states[64];
    
    // Phase 3: Knightmare Limbo
    uint8_t knightmare_limbo_coords[2][16];
    int num_knightmares_limbo[2];
};

struct Board {
    // 2 Colors, PIECE_TYPE_COUNT Piece Types (PAWN=0, ..., HORDELING=35)
    U64 pieces[2][PIECE_TYPE_COUNT];
    
    // Occupancies: 0=WHITE, 1=BLACK, 2=BOTH
    U64 occupancies[3];
    
    // State Tracker (maps Square 0-63 to its state)
    AbilityState ability_tracker[64];
    
    Color side_to_move;
    int en_passant_sq;
    int castling_rights; // 1=WK, 2=WQ, 4=BK, 8=BQ
    int half_move_clock;
    int full_move_number;
    int last_move_dest_sq;
    bool last_move_was_legal; // Evaluated before side-effects
    U64 hash;
    U64 frozen_pieces; // Fast lookup bitboard for frozen pieces
    U64 active_pixies[2]; // Bitmask for active power pieces (needs 36 bits)

    
    // Phase 2 State
    int active_dancer_sq;
    int dissipated_djinn_sqs[2];
    
    // Phase 3 State
    uint8_t knightmare_limbo_coords[2][16];
    int num_knightmares_limbo[2];
    
    // Dead pieces tracking for Pilgrim resurrect
    int dead_pieces_count[2][PIECE_TYPE_COUNT];

    // Search History Stack
    StateHistory history[2048];
    int ply; // Current depth in the search tree

    // Default Constructor: Clears the board
    Board() {
        for (int c = 0; c < 2; c++) {
            for (int p = 0; p < PIECE_TYPE_COUNT; p++) {
                pieces[c][p] = 0ULL;
            }
        }
        for (int i = 0; i < 3; i++) occupancies[i] = 0ULL;
        side_to_move = WHITE;
        en_passant_sq = NO_SQ;
        castling_rights = 0;
        half_move_clock = 0;
        full_move_number = 1;
        last_move_dest_sq = NO_SQ;
        last_move_was_legal = true;
        ply = 0;
        hash = 0ULL;
        frozen_pieces = 0ULL;
        active_pixies[0] = 0ULL;
        active_pixies[1] = 0ULL;
        active_dancer_sq = NO_SQ;
        dissipated_djinn_sqs[0] = NO_SQ;
        dissipated_djinn_sqs[1] = NO_SQ;
        num_knightmares_limbo[0] = 0;
        num_knightmares_limbo[1] = 0;
        for (int i=0; i<16; i++) {
            knightmare_limbo_coords[0][i] = 0;
            knightmare_limbo_coords[1][i] = 0;
        }
        for (int c = 0; c < 2; c++) {
            for (int p = 0; p < PIECE_TYPE_COUNT; p++) {
                dead_pieces_count[c][p] = 0;
            }
        }
    }
    
    // Core updates
    inline void update_occupancies() {
        occupancies[WHITE] = 0ULL;
        occupancies[BLACK] = 0ULL;
        active_pixies[WHITE] = 0ULL;
        active_pixies[BLACK] = 0ULL;
        for (int p = 0; p < PIECE_TYPE_COUNT; p++) {
            if (pieces[WHITE][p]) {
                occupancies[WHITE] |= pieces[WHITE][p];
                if (p >= GOLDEN_PAWN) active_pixies[WHITE] |= (1ULL << p);
            }
            if (pieces[BLACK][p]) {
                occupancies[BLACK] |= pieces[BLACK][p];
                if (p >= GOLDEN_PAWN) active_pixies[BLACK] |= (1ULL << p);
            }
        }
        occupancies[BOTH] = occupancies[WHITE] | occupancies[BLACK];
    }
    
    inline int get_piece_on_square(int sq) const {
        for (int p = 0; p < PIECE_TYPE_COUNT; p++) {
            if (get_bit(pieces[WHITE][p], sq)) return p;
            if (get_bit(pieces[BLACK][p], sq)) return p;
        }
        return PIECE_TYPE_NONE;
    }

    // Fast Path Check: Returns true if there are ANY non-standard pieces on the board
    inline bool has_pixies() const {
        return (active_pixies[WHITE] | active_pixies[BLACK]) != 0;
    }

    // Move Execution for Search Tree
    void do_move(Move m);
    void undo_move(Move m);
    void destroy_piece(int sq, int p_type, Color p_color);

    // Helpers
    void init_from_pfen(const std::string& pfen);
    bool is_square_attacked(int sq, Color attacker_color) const;
    
    struct AttackerInfo {
        int sq;          // Square of attacker (0-63), or 64 if Limbo Knightmare
        int piece_type;  // PIECE_TYPE_NONE if no attacker
    };
    AttackerInfo get_smallest_attacker(int sq, Color attacker_color) const;
    bool in_check(Color color) const;
    
    inline bool is_repetition() const {
        if (half_move_clock < 4) return false;
        int repetitions = 0;
        for (int i = ply - 2; i >= ply - half_move_clock && i >= 0; i -= 2) {
            if (history[i].hash == hash) {
                repetitions++;
                if (repetitions >= 1) return true; // Draw on 1st repetition during search to avoid loops
            }
        }
        return false;
    }
};

#endif
