#pragma once
#include "types.h"
#include "movegen.h"
#include <vector>

enum TTFlag {
    TT_EXACT = 0,
    TT_ALPHA = 1, // Upper bound
    TT_BETA = 2   // Lower bound
};

struct TTEntry {
    U64 hash;
    Move best_move;
    int depth;
    int score;
    int flag;
    
    TTEntry() : hash(0), best_move(Move(0,0,0,0,0,0,0)), depth(0), score(0), flag(0) {}
};

namespace TT {
    extern std::vector<TTEntry> table;
    extern size_t num_entries;

    void init(size_t mb_size);
    void clear();
    void store(U64 hash, int depth, int score, int flag, Move best_move);
    bool probe(U64 hash, int depth, int alpha, int beta, int& return_score, Move& return_move);
}
