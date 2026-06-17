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

extern std::atomic<bool> search_stop_flag;

// Runs an Iterative Deepening search up to the specified max_depth.
// Returns a vector of up to multi_pv pairs of (Move, Score).
std::vector<std::pair<Move, int>> search_best_move(Board& b, int max_depth, int threads = 1, int multi_pv = 1, std::vector<uint32_t> include_moves = {});

uint64_t perft(Board& b, int depth);

#endif
