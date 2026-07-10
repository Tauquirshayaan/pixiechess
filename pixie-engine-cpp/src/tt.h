#pragma once
#include "types.h"
#include "movegen.h"
#include <vector>

enum TTFlag {
    TT_EXACT = 0,
    TT_ALPHA = 1, // Upper bound
    TT_BETA = 2   // Lower bound
};

#include <atomic>

struct TTEntry {
    std::atomic<uint64_t> key;
    std::atomic<uint64_t> data;
    
    TTEntry() {
        key.store(0, std::memory_order_relaxed);
        data.store(0, std::memory_order_relaxed);
    }
};

namespace TT {
    extern uint8_t current_age;
    extern std::vector<TTEntry> table;
    extern size_t num_entries;

    void init(size_t mb_size);
    void clear();
    void store(U64 hash, int depth, int score, int flag, Move best_move);
    bool probe(U64 hash, int depth, int alpha, int beta, int& return_score, Move& return_move);
}
