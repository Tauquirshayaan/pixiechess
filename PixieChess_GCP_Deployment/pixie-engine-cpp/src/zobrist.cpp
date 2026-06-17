#include "zobrist.h"
#include <random>

namespace Zobrist {
    U64 piece_keys[2][PIECE_TYPE_COUNT][64];
    U64 side_key;

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
        return hash;
    }
}
