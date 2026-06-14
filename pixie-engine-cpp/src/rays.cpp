#include "rays.h"

U64 RAY_MASKS[64][8];

void init_ray_masks() {
    for (int sq = 0; sq < 64; sq++) {
        int r = sq / 8;
        int c = sq % 8;

        for (int dir = 0; dir < 8; dir++) {
            RAY_MASKS[sq][dir] = 0ULL;
        }

        // North
        for (int i = r + 1; i < 8; i++) set_bit(RAY_MASKS[sq][0], i * 8 + c);
        // South
        for (int i = r - 1; i >= 0; i--) set_bit(RAY_MASKS[sq][1], i * 8 + c);
        // East
        for (int i = c + 1; i < 8; i++) set_bit(RAY_MASKS[sq][2], r * 8 + i);
        // West
        for (int i = c - 1; i >= 0; i--) set_bit(RAY_MASKS[sq][3], r * 8 + i);
        // NorthEast
        for (int i = 1; r + i < 8 && c + i < 8; i++) set_bit(RAY_MASKS[sq][4], (r + i) * 8 + (c + i));
        // NorthWest
        for (int i = 1; r + i < 8 && c - i >= 0; i++) set_bit(RAY_MASKS[sq][5], (r + i) * 8 + (c - i));
        // SouthEast
        for (int i = 1; r - i >= 0 && c + i < 8; i++) set_bit(RAY_MASKS[sq][6], (r - i) * 8 + (c + i));
        // SouthWest
        for (int i = 1; r - i >= 0 && c - i >= 0; i++) set_bit(RAY_MASKS[sq][7], (r - i) * 8 + (c - i));
    }
}

U64 get_sliding_attacks(int sq, U64 blockers, bool is_diagonal, bool is_straight) {
    U64 attacks = 0ULL;

    if (is_straight) {
        for (int dir = 0; dir < 4; dir++) {
            U64 ray = RAY_MASKS[sq][dir];
            U64 blocked = ray & blockers;
            if (blocked) {
                // Find the first blocker in the ray
                int blocker_sq = (dir == 0 || dir == 2) ? get_lsb(blocked) : 63 - __builtin_clzll(blocked);
                // Cut off the ray behind the blocker
                ray ^= RAY_MASKS[blocker_sq][dir];
            }
            attacks |= ray;
        }
    }

    if (is_diagonal) {
        for (int dir = 4; dir < 8; dir++) {
            U64 ray = RAY_MASKS[sq][dir];
            U64 blocked = ray & blockers;
            if (blocked) {
                int blocker_sq = (dir == 4 || dir == 5) ? get_lsb(blocked) : 63 - __builtin_clzll(blocked);
                ray ^= RAY_MASKS[blocker_sq][dir];
            }
            attacks |= ray;
        }
    }

    return attacks;
}
