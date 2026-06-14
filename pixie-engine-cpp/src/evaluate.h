#ifndef EVALUATE_H
#define EVALUATE_H

#include "board.h"

extern const int PIECE_VALUES[39];

// Evaluates the board from the perspective of the side to move.
// Returns a positive score if the side to move is winning, negative if losing.
int evaluate(const Board& b);

#endif
