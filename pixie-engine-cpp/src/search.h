#ifndef SEARCH_H
#define SEARCH_H

#include "board.h"
#include "movegen.h"
#include "pixiegen.h"
#include "evaluate.h"

// Alpha-Beta Search Limits
#define INF 1000000
#define MATE_VALUE 900000

#include <vector>
#include <utility>
#include <atomic>

#ifdef ENABLE_SEARCH_STATS
struct SearchStats {
    uint64_t nodes;
    uint32_t seldepth;
    uint64_t tt_hits;
    uint64_t beta_cutoffs;
    uint64_t lmr_reductions;
    uint64_t null_move_prunes;
    uint64_t qnodes;
    uint64_t fail_highs;
    uint64_t fail_lows;
    uint64_t branching_factor_sum;
    uint64_t pv_changes;
    
    void clear() {
        nodes = 0;
        seldepth = 0;
        tt_hits = 0;
        beta_cutoffs = 0;
        lmr_reductions = 0;
        null_move_prunes = 0;
        qnodes = 0;
        fail_highs = 0;
        fail_lows = 0;
        branching_factor_sum = 0;
        pv_changes = 0;
    }
};
extern thread_local SearchStats search_stats;
#endif

extern std::atomic<bool> search_stop_flag;

// Initialize the LMR reduction table. Must be called once at startup.
void init_lmr_table();
void clear_heuristics();
std::string format_move(Move m);

// Runs an Iterative Deepening search up to the specified max_depth.
// Returns a vector of up to multi_pv pairs of (Move, Score).
std::vector<std::pair<Move, int>> search_best_move(Board& b, int max_depth, int threads = 1, int multi_pv = 1, std::vector<uint32_t> include_moves = {});

uint64_t perft(Board& b, int depth);

#endif
