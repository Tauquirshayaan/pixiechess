import type { Board, Piece } from '../engine/types';

function createPiece(type: 'P' | 'N' | 'B' | 'R' | 'Q' | 'K', color: 'w' | 'b', id: string): Piece {
  return { type, color, id };
}

// Row 0 = rank 8 (black back rank)
// Row 7 = rank 1 (white back rank)
export const INITIAL_BOARD: Board = [
  // Rank 8 - Black pieces
  [
    createPiece('R', 'b', 'b-R-a8'), createPiece('N', 'b', 'b-N-b8'),
    createPiece('B', 'b', 'b-B-c8'), createPiece('Q', 'b', 'b-Q-d8'),
    createPiece('K', 'b', 'b-K-e8'), createPiece('B', 'b', 'b-B-f8'),
    createPiece('N', 'b', 'b-N-g8'), createPiece('R', 'b', 'b-R-h8')
  ],
  // Rank 7 - Black pawns
  [
    createPiece('P', 'b', 'b-P-a7'), createPiece('P', 'b', 'b-P-b7'),
    createPiece('P', 'b', 'b-P-c7'), createPiece('P', 'b', 'b-P-d7'),
    createPiece('P', 'b', 'b-P-e7'), createPiece('P', 'b', 'b-P-f7'),
    createPiece('P', 'b', 'b-P-g7'), createPiece('P', 'b', 'b-P-h7')
  ],
  // Ranks 6, 5, 4, 3 - Empty squares
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  // Rank 2 - White pawns
  [
    createPiece('P', 'w', 'w-P-a2'), createPiece('P', 'w', 'w-P-b2'),
    createPiece('P', 'w', 'w-P-c2'), createPiece('P', 'w', 'w-P-d2'),
    createPiece('P', 'w', 'w-P-e2'), createPiece('P', 'w', 'w-P-f2'),
    createPiece('P', 'w', 'w-P-g2'), createPiece('P', 'w', 'w-P-h2')
  ],
  // Rank 1 - White pieces
  [
    createPiece('R', 'w', 'w-R-a1'), createPiece('N', 'w', 'w-N-b1'),
    createPiece('B', 'w', 'w-B-c1'), createPiece('Q', 'w', 'w-Q-d1'),
    createPiece('K', 'w', 'w-K-e1'), createPiece('B', 'w', 'w-B-f1'),
    createPiece('N', 'w', 'w-N-g1'), createPiece('R', 'w', 'w-R-h1')
  ]
];
