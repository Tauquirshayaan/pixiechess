/**
 * Conversion layer: 8x8 array ↔ BitboardState
 * 
 * This bridges the existing PixieChess UI representation (Board = Piece[][])
 * with the new bitboard engine. The UI never sees bitboards — conversion
 * happens purely on the server during calculation.
 */

import type { Board } from '../engine/types';
import {
  type BitboardState,
  emptyBitboardState, updateAggregates,
  bit, sq
} from './bitboard';
import { PIECE_CATALOG } from '../data/pieceCatalog';

const MIGRATED_PIXIES = new Set([
  'GOLDEN_PAWN', 'PHASE_ROOK', 'BOUNCER', 'IRONPAWN', 'WAR_AUTOMATON',
  'FISSION_REACTOR', 'HORDE_MOTHER', 'ICICLE', 'BASILISK', 'ANTI_VIOLENCE',
  'ROCKETMAN', 'CARDINAL', 'ELECTROKNIGHT', 'DJINN', 'HERO_PAWN',
  'BANKER', 'PINATA', 'PILGRIM', 'ARISTOCRAT', 'DANCER', 'BLUEPRINT', 'FISH_KNIGHT',
  'CAMEL', 'GUNSLINGER', 'EPEE_PAWN', 'PAWN_KNIFE', 'WARP_JUMPER',
  'SHRIKE', 'KNIGHTMARE', 'BLADERUNNER', 'MARAUDER', 'SUMOROOK', 'HORDELING'
]);

// ── Board → BitboardState ────────────────────────────────────────────────

/**
 * Convert the UI's 8x8 Board array into a BitboardState.
 * Only standard pieces (P/N/B/R/Q/K) without Pixie powers are placed
 * into the bitboard. Pixie-powered pieces are tracked separately so the
 * old move generator can handle them.
 */
export interface ConversionResult {
  bbState: BitboardState;
  whitePixies: number[];
  blackPixies: number[];
}

export function boardToBitboard(board: Board): ConversionResult {
  const state = emptyBitboardState();
  const whitePixies: number[] = [];
  const blackPixies: number[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const s = sq(r, c);
      const b = bit(s);

      // Check if piece is invulnerable
      const isInvulnerable = piece.invulnerable || (piece.pixie && PIECE_CATALOG[piece.pixie]?.isIndestructible);
      if (isInvulnerable) {
        state.invulnerable |= b;
      }

      // If the piece has a Pixie power, handle its bitboard presence
      if (piece.pixie) {
        if (MIGRATED_PIXIES.has(piece.pixie)) {
          // Native bitboard handling
          state.activePixies.push({ sq: s, type: piece.pixie, color: piece.color, pieceState: piece.state });
          if (piece.color === 'w') {
            state.whitePixies |= b;
            state.whiteAll |= b;
          } else {
            state.blackPixies |= b;
            state.blackAll |= b;
          }
        } else {
          // Legacy engine fallback
          if (piece.color === 'w') {
            whitePixies.push(s);
            state.whitePixies |= b;
            state.whiteAll |= b;
          } else {
            blackPixies.push(s);
            state.blackPixies |= b;
            state.blackAll |= b;
          }
        }
        continue; // DO NOT place in standard bitboards (prevents duplicate standard moves)
      }

      // Place into the correct bitboard
      if (piece.color === 'w') {
        switch (piece.type) {
          case 'P': state.whitePawns   |= b; break;
          case 'N': state.whiteKnights |= b; break;
          case 'B': state.whiteBishops |= b; break;
          case 'R': state.whiteRooks   |= b; break;
          case 'Q': state.whiteQueens  |= b; break;
          case 'K': state.whiteKing    |= b; break;
        }
      } else {
        switch (piece.type) {
          case 'P': state.blackPawns   |= b; break;
          case 'N': state.blackKnights |= b; break;
          case 'B': state.blackBishops |= b; break;
          case 'R': state.blackRooks   |= b; break;
          case 'Q': state.blackQueens  |= b; break;
          case 'K': state.blackKing    |= b; break;
        }
      }
    }
  }

  updateAggregates(state);
  return { bbState: state, whitePixies, blackPixies };
}
