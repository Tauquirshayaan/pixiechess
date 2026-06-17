/**
 * PixieChess Bitboard Engine v2 — Barrel Export
 * 
 * This module provides the public API surface for the bitboard engine.
 * The existing engine-v1 continues to handle all Pixie power pieces;
 * engine-v2 accelerates standard piece move generation.
 */

export {
  type BitboardState,
  emptyBitboardState,
  updateAggregates,
  cloneBB,
  getPieceBoard,
  bit, sq, toRC, iterBits,
  popcount, lsb,
  fileOf, rankOf,
  fileMask, rankMask,
  ZERO, ONE, ALL_SQUARES,
  FILE_A, FILE_H,
  RANK_1, RANK_2, RANK_7, RANK_8,
} from './bitboard';

export {
  KNIGHT_ATTACKS,
  KING_ATTACKS,
  WHITE_PAWN_ATTACKS,
  BLACK_PAWN_ATTACKS,
  bishopAttacks,
  rookAttacks,
  queenAttacks,
  allAttackedBy,
} from './attacks';

export {
  type ConversionResult,
  boardToBitboard,
} from './convert';

export {
  generateStandardMoves,
} from './moveGen';

export {
  generatePixieMoves,
} from './pixieGen';
