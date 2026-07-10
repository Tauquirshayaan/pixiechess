#include "zobrist.h"
#include <random>

namespace Zobrist {
    U64 piece_keys[2][PIECE_TYPE_COUNT][64];
    U64 side_key;
    
    // Ability state hashing keys
    U64 electro_keys[64][8];
    U64 marauder_keys[64][8];
    U64 frozen_keys[64][4];
    U64 fission_keys[64][8];
    U64 pilgrim_keys[64][21];
    U64 ability_used_keys[64][2];
    U64 dancer_keys[64][3];
    U64 icicle_adj_keys[64][4];
    U64 djinn_dissipated_keys[64][2];
    U64 djinn_home_keys[64][65];
    U64 fish_moved_keys[64][2];
    U64 gunslinger_keys[64][4][256];
    
    U64 limbo_keys[2][256];

    U64 random_u64() {
        static std::mt19937_64 rng(12345); // Fixed seed for reproducible hashes
        return rng();
    }

    void init() {
        for (int c = WHITE; c <= BLACK; c++) {
            for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
                for (int sq = 0; sq < 64; sq++) {
                    piece_keys[c][pt][sq] = random_u64();
                }
            }
        }
        side_key = random_u64();
        
        // Initialize ability state keys
        for (int sq = 0; sq < 64; sq++) {
            for (int v = 0; v < 8; v++) {
                electro_keys[sq][v] = random_u64();
                marauder_keys[sq][v] = random_u64();
                fission_keys[sq][v] = random_u64();
            }
            for (int v = 0; v < 4; v++) {
                frozen_keys[sq][v] = random_u64();
            }
        }
        
        // Initialize new ability state keys
        for (int sq = 0; sq < 64; sq++) {
            for (int v = 0; v < 21; v++) pilgrim_keys[sq][v] = random_u64();
            for (int v = 0; v < 2; v++) {
                ability_used_keys[sq][v] = random_u64();
                djinn_dissipated_keys[sq][v] = random_u64();
                fish_moved_keys[sq][v] = random_u64();
            }
            for (int v = 0; v < 3; v++) dancer_keys[sq][v] = random_u64();
            for (int v = 0; v < 4; v++) icicle_adj_keys[sq][v] = random_u64();
            for (int v = 0; v < 65; v++) djinn_home_keys[sq][v] = random_u64();
            for (int t = 0; t < 4; t++) {
                for (int b = 0; b < 256; b++) {
                    gunslinger_keys[sq][t][b] = random_u64();
                }
            }
        }
        
        // Initialize limbo coordinate keys
        for (int c = 0; c < 2; c++) {
            for (int i = 0; i < 256; i++) {
                limbo_keys[c][i] = random_u64();
            }
        }
    }

    U64 generate_hash(const Board& b) {
        U64 hash = 0;
        for (int c = WHITE; c <= BLACK; c++) {
            for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
                U64 bb = b.pieces[c][pt];
                while (bb) {
                    int sq = pop_lsb(bb);
                    hash ^= piece_keys[c][pt][sq];
                }
            }
        }
        if (b.side_to_move == BLACK) {
            hash ^= side_key;
        }
        
        // Hash ability states for squares that have active abilities
        for (int sq = 0; sq < 64; sq++) {
            const AbilityState& st = b.ability_tracker[sq];
            if (st.electro_moves > 0) {
                int idx = st.electro_moves < 8 ? st.electro_moves : 7;
                hash ^= electro_keys[sq][idx];
            }
            if (st.marauder_kills > 0) {
                int idx = st.marauder_kills < 8 ? st.marauder_kills : 7;
                hash ^= marauder_keys[sq][idx];
            }
            if (st.frozen_turns > 0) {
                int idx = st.frozen_turns < 4 ? st.frozen_turns : 3;
                hash ^= frozen_keys[sq][idx];
            }
            if (st.fission_captures > 0) {
                int idx = st.fission_captures < 8 ? st.fission_captures : 7;
                hash ^= fission_keys[sq][idx];
            }
            if (st.pilgrim_dist > 0) {
                int idx = st.pilgrim_dist <= 20 ? st.pilgrim_dist : 20;
                hash ^= pilgrim_keys[sq][idx];
            }
            if (st.ability_used) hash ^= ability_used_keys[sq][1];
            if (st.djinn_dissipated) hash ^= djinn_dissipated_keys[sq][1];
            if (st.fish_moved) hash ^= fish_moved_keys[sq][1];
            if (st.dancer_bonus_moves > 0) {
                int idx = st.dancer_bonus_moves <= 2 ? st.dancer_bonus_moves : 2;
                hash ^= dancer_keys[sq][idx];
            }
            if (st.icicle_adj_turns > 0) {
                int idx = st.icicle_adj_turns <= 3 ? st.icicle_adj_turns : 3;
                hash ^= icicle_adj_keys[sq][idx];
            }
            if (st.djinn_home_sq != NO_SQ) {
                int idx = st.djinn_home_sq < 64 ? st.djinn_home_sq : 64;
                hash ^= djinn_home_keys[sq][idx];
            }
            if (st.gunslinger_targets != 0xFFFFFFFF) {
                uint32_t gt = st.gunslinger_targets;
                for (int t = 0; t < 4; t++) {
                    uint8_t byte_val = (gt >> (t * 8)) & 0xFF;
                    hash ^= gunslinger_keys[sq][t][byte_val];
                }
            }
        }
        
        // Hash Knightmares in Limbo coordinates
        for (int c = WHITE; c <= BLACK; c++) {
            for (int i = 0; i < b.num_knightmares_limbo[c]; i++) {
                hash ^= limbo_keys[c][b.knightmare_limbo_coords[c][i]];
            }
        }
        
        return hash;
    }
    
    U64 hash_ability_state(int sq, const AbilityState& st) {
        U64 hash = 0;
        if (st.electro_moves > 0) {
            int idx = st.electro_moves < 8 ? st.electro_moves : 7;
            hash ^= electro_keys[sq][idx];
        }
        if (st.marauder_kills > 0) {
            int idx = st.marauder_kills < 8 ? st.marauder_kills : 7;
            hash ^= marauder_keys[sq][idx];
        }
        if (st.frozen_turns > 0) {
            int idx = st.frozen_turns < 4 ? st.frozen_turns : 3;
            hash ^= frozen_keys[sq][idx];
        }
        if (st.fission_captures > 0) {
            int idx = st.fission_captures < 8 ? st.fission_captures : 7;
            hash ^= fission_keys[sq][idx];
        }
        if (st.pilgrim_dist > 0) {
            int idx = st.pilgrim_dist <= 20 ? st.pilgrim_dist : 20;
            hash ^= pilgrim_keys[sq][idx];
        }
        if (st.ability_used) hash ^= ability_used_keys[sq][1];
        if (st.djinn_dissipated) hash ^= djinn_dissipated_keys[sq][1];
        if (st.fish_moved) hash ^= fish_moved_keys[sq][1];
        if (st.dancer_bonus_moves > 0) {
            int idx = st.dancer_bonus_moves <= 2 ? st.dancer_bonus_moves : 2;
            hash ^= dancer_keys[sq][idx];
        }
        if (st.icicle_adj_turns > 0) {
            int idx = st.icicle_adj_turns <= 3 ? st.icicle_adj_turns : 3;
            hash ^= icicle_adj_keys[sq][idx];
        }
        if (st.djinn_home_sq != NO_SQ) {
            int idx = st.djinn_home_sq < 64 ? st.djinn_home_sq : 64;
            hash ^= djinn_home_keys[sq][idx];
        }
        if (st.gunslinger_targets != 0xFFFFFFFF) {
            uint32_t gt = st.gunslinger_targets;
            for (int t = 0; t < 4; t++) {
                uint8_t byte_val = (gt >> (t * 8)) & 0xFF;
                hash ^= gunslinger_keys[sq][t][byte_val];
            }
        }
        return hash;
    }
}
