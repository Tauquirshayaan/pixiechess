#ifndef BITBOARD_H
#define BITBOARD_H

#include "types.h"
#include <immintrin.h>

// Set a bit at the given square
inline void set_bit(U64 &bb, int sq) {
    bb |= (1ULL << sq);
}

// Clear a bit at the given square
inline void clear_bit(U64 &bb, int sq) {
    bb &= ~(1ULL << sq);
}

// Get the bit at the given square
inline bool get_bit(U64 bb, int sq) {
    return (bb & (1ULL << sq)) != 0;
}

// Count the number of set bits (Hardware Accelerated)
inline int popcount(U64 bb) {
    return __builtin_popcountll(bb);
}

// Get the index of the Least Significant Bit (Hardware Accelerated)
inline int get_lsb(U64 bb) {
    if (bb == 0) return NO_SQ;
    return __builtin_ctzll(bb);
}

// Get the Least Significant Bit and immediately clear it from the bitboard
inline int pop_lsb(U64 &bb) {
    int sq = __builtin_ctzll(bb);
    bb &= bb - 1; // BLSR hardware instruction
    return sq;
}
// Get the Most Significant Bit
inline int get_msb(U64 bb) {
    if (bb == 0) return NO_SQ;
    return 63 - __builtin_clzll(bb);
}

// Get the Most Significant Bit and immediately clear it from the bitboard
inline int pop_msb(U64 &bb) {
    int sq = get_msb(bb);
    clear_bit(bb, sq);
    return sq;
}

#endif
