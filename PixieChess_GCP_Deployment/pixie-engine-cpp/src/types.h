#ifndef TYPES_H
#define TYPES_H

#include <cstdint>

typedef uint64_t U64;

enum Color { WHITE, BLACK, BOTH };

enum Square {
    A1 = 0, B1, C1, D1, E1, F1, G1, H1,
    A2, B2, C2, D2, E2, F2, G2, H2,
    A3, B3, C3, D3, E3, F3, G3, H3,
    A4, B4, C4, D4, E4, F4, G4, H4,
    A5, B5, C5, D5, E5, F5, G5, H5,
    A6, B6, C6, D6, E6, F6, G6, H6,
    A7, B7, C7, D7, E7, F7, G7, H7,
    A8, B8, C8, D8, E8, F8, G8, H8, NO_SQ
};

enum PieceType {
    // 6 Standard Pieces
    PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    // 9 Pixie Pawns
    GOLDEN_PAWN, IRONPAWN, BLUEPRINT, EPEE_PAWN, PAWN_KNIFE, HERO_PAWN, SHRIKE, WARP_JUMPER, WAR_AUTOMATON,
    // 7 Pixie Knights
    ELECTROKNIGHT, BANKER, CAMEL, KNIGHTMARE, ANTI_VIOLENCE, PINATA, FISH_KNIGHT,
    // 12 Pixie Bishops
    ARISTOCRAT, BASILISK, BLADERUNNER, BOUNCER, PILGRIM, DANCER, DJINN, GUNSLINGER, CARDINAL, ICICLE, HORDE_MOTHER, MARAUDER,
    // 2 Pixie Rooks
    PHASE_ROOK, SUMOROOK,
    // 1 Pixie Queen
    FISSION_REACTOR,
    // 1 Pixie King
    ROCKETMAN,
    
    // Horde Mother summon
    HORDELING,
    
    PIECE_TYPE_NONE
};

#define PIECE_TYPE_COUNT PIECE_TYPE_NONE

// Pack a move into a 32-bit integer for extreme performance
// 0-5: from square (6 bits)
// 6-11: to square (6 bits)
// 12-17: piece type (6 bits)
// 18-23: captured piece type (6 bits, PIECE_TYPE_NONE if quiet)
// 24-29: promoted piece type (6 bits)
// 30: is_capture (1 bit)
// 31: is_pixie_ability (1 bit)
struct Move {
    uint32_t data;

    Move() : data(0) {}
    Move(int f, int t, int p, int c, int pr, bool cap, bool ability) {
        data = (f & 0x3F) | ((t & 0x3F) << 6) | ((p & 0x3F) << 12) | ((c & 0x3F) << 18) | ((pr & 0x3F) << 24) | ((cap ? 1 : 0) << 30) | ((ability ? 1 : 0) << 31);
    }

    int from() const { return data & 0x3F; }
    int to() const { return (data >> 6) & 0x3F; }
    int piece() const { return (data >> 12) & 0x3F; }
    int captured() const { return (data >> 18) & 0x3F; }
    int promoted() const { return (data >> 24) & 0x3F; }
    bool is_capture() const { return (data >> 30) & 1; }
    bool is_ability() const { return (data >> 31) & 1; }
};

#endif
