#pragma once
#include "types.h"
#include "board.h"

namespace Zobrist {
    extern U64 piece_keys[2][PIECE_TYPE_COUNT][64];
    extern U64 side_key;
    
    // Ability state hashing keys
    extern U64 electro_keys[64][8];     // [sq][charge_level 0-7]
    extern U64 marauder_keys[64][8];    // [sq][kill_count 0-7]
    extern U64 frozen_keys[64][4];      // [sq][frozen_turns 0-3]
    extern U64 fission_keys[64][8];     // [sq][capture_count 0-7]
    extern U64 pilgrim_keys[64][21];    // [sq][dist 0-20]
    extern U64 ability_used_keys[64][2];// [sq][bool]
    extern U64 dancer_keys[64][3];      // [sq][bonus_moves 0-2]
    extern U64 icicle_adj_keys[64][4];  // [sq][turns 0-3]
    extern U64 djinn_dissipated_keys[64][2]; // [sq][bool]
    extern U64 djinn_home_keys[64][65]; // [sq][home_sq 0-64]
    extern U64 fish_moved_keys[64][2];  // [sq][bool]
    extern U64 gunslinger_keys[64][4][256]; // [sq][target_idx 0-3][byte_val 0-255]
    
    extern U64 limbo_keys[2][256];
    
    void init();
    U64 generate_hash(const Board& b);
    U64 hash_ability_state(int sq, const AbilityState& st);
}
