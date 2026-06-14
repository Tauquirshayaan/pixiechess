#ifndef MOVEGEN_H
#define MOVEGEN_H

#include "types.h"
#include "board.h"
#include "rays.h"
#include <vector>

// Fast, pre-allocated array for storing generated moves
struct MoveList {
    Move moves[512]; // Increased capacity for Pixie pieces
    int scores[512];
    int count;

    MoveList() : count(0) {}
    
    inline void add(Move m) {
        scores[count] = 0;
        moves[count++] = m;
    }
};

// Generates all pseudo-legal moves for the current side to move
void generate_pseudo_legal_moves(const Board& b, MoveList& list);

// Pre-computes attack masks for leaping pieces (Knights, Kings)
void init_leaper_masks();

extern U64 KNIGHT_ATTACKS[64];
extern U64 KING_ATTACKS[64];

#endif
