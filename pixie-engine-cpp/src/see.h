#ifndef SEE_H
#define SEE_H

#include "board.h"
#include "types.h"

// Static Exchange Evaluation
// Evaluates the material consequence of a capture on a given square.
// Returns > 0 for winning captures, 0 for equal, < 0 for losing captures.
int see(Board& b, Move m);

#endif
