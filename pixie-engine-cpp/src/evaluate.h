#ifndef EVALUATE_H
#define EVALUATE_H

#include "board.h"

extern const int PIECE_VALUES[PIECE_TYPE_COUNT];

inline int get_dynamic_piece_value(const Board& b, int pt, int sq, Color c) {
    int piece_val = PIECE_VALUES[pt];
    
    // Calculate approximate gamePhase (using total piece count as heuristic)
    int total_pieces = popcount(b.occupancies[BOTH]);
    float gamePhase = std::max(0.0f, std::min(1.0f, (total_pieces - 4) / 28.0f));

    if (pt == MARAUDER) {
        piece_val += (b.ability_tracker[sq].marauder_kills * 250);
    } else if (pt == QUEEN || pt == FISSION_REACTOR) {
        piece_val += (int)(200 * gamePhase); 
    } else if (pt == BASILISK) {
        piece_val += (int)(250 * gamePhase + 100 * (1.0f - gamePhase));
    } else if (pt == ELECTROKNIGHT) {
        int enemy_piece_count = popcount(b.occupancies[(c == WHITE) ? BLACK : WHITE]);
        piece_val += (enemy_piece_count * 25);
    }
    
    return piece_val;
}

// Returns a positive score if the side to move is winning, negative if losing.
int evaluate(const Board& b);

struct KnightmareState {
    int count_in_limbo = 0;
    int count_on_board = 0;
    int legal_drop_count = 0;
    int safe_drops = 0;
    int checking_drop_count = 0;
    int capture_drop_count = 0;
    bool attacking_king = false;
    bool trapped = false;
};

struct KnightmareBreakdown {
    KnightmareState state;
    
    int material = 0;
    int limbo_persistence = 0;
    int ambush_platform = 0;
    int deployment_readiness = 0;
    int behind_king_pressure = 0;
    int trapped_penalty = 0;
    int outpost = 0;
    
    int total() const {
        return material + limbo_persistence + ambush_platform + deployment_readiness + behind_king_pressure + trapped_penalty + outpost;
    }
};

struct PositionFingerprint {
    int material_imbalance = 0;
    int open_files = 0;
    int semi_open_files = 0;
    int pawn_islands = 0;
    int passed_pawns = 0;
    int doubled_pawns = 0;
    int isolated_pawns = 0;
    int connected_pawns = 0;
    int king_exposure = 0;
    int center_occupancy = 0;
    
    // Power Pieces Alive counts
    int alive_knightmare = 0;
    int alive_marauder = 0;
    int alive_phaserook = 0;
    int alive_electroknight = 0;
    int alive_djinn = 0;
    int alive_basilisk = 0;
    
    // Power Piece context
    int knightmares_in_limbo = 0;
    int marauder_range = 0;
    int electroknight_charge = 0;
    int phaserook_availability = 0;
};

struct EvaluationBreakdown {
    PositionFingerprint fingerprint;
    
    int material = 0;
    int mobility = 0;
    int king_safety = 0;
    int center_control = 0;
    int threats = 0;
    int development = 0;
    int power_potential = 0;
    
    // Power Pieces
    KnightmareBreakdown km;
    int marauder_score = 0;
    int phaserook_score = 0;
    int electroknight_score = 0;
    int djinn_score = 0;
    
    // Flags
    bool passed_pawn_bonus = false;
    bool supported_center_pawn = false;
    bool king_under_attack = false;
    bool mating_threat = false;
    bool limbo_active = false;
    bool electro_charge_ready = false;
    
    int total() const {
        return material + mobility + king_safety + center_control + threats + development + power_potential;
    }
};

EvaluationBreakdown explain_evaluation(const Board& b);

extern std::string analysis_mode;
extern std::string counterfactual_target;
extern bool in_counterfactual_explanation;

#endif
