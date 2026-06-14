#ifndef PIXIEGEN_H
#define PIXIEGEN_H

#include "types.h"
#include "board.h"
#include "movegen.h"

// Generates moves for custom Pixie pieces
void generate_pixie_moves(const Board& b, MoveList& list);

#endif
