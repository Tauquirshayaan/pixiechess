#ifndef RAYS_H
#define RAYS_H

#include "types.h"
#include "bitboard.h"

// Precomputed rays from a square to the edge of the board
// 0: North, 1: South, 2: East, 3: West
// 4: NorthEast, 5: NorthWest, 6: SouthEast, 7: SouthWest
extern U64 RAY_MASKS[64][8];

// Precompute the rays at startup
void init_ray_masks();

// Get sliding attacks using a simple blocker loop (upgradable to PEXT/Magic later)
// This perfectly handles custom Pixie logic (e.g., passing different blocker masks)
U64 get_sliding_attacks(int sq, U64 blockers, bool is_diagonal, bool is_straight);

#endif
