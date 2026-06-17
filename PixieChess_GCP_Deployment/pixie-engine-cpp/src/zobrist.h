#pragma once
#include "types.h"
#include "board.h"

namespace Zobrist {
    extern U64 piece_keys[2][PIECE_TYPE_COUNT][64];
    extern U64 side_key;
    
    void init();
    U64 generate_hash(const Board& b);
}
