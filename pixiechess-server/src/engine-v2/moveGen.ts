/**
 * Bitboard Move Generator for standard chess pieces.
 * 
 * Generates pseudo-legal moves using bitboard operations.
 * Each move is encoded as a compact object for compatibility with the
 * existing Move interface, but generated at bitboard speed.
 */

import type { Move, GameState, Board } from '../engine/types';
import {
  type BitboardState,
  ZERO,
  bit, sq, toRC, iterBits,
  NOT_FILE_A, NOT_FILE_H
} from './bitboard';
import {
  KNIGHT_ATTACKS, KING_ATTACKS,
  bishopAttacks, rookAttacks, queenAttacks,
  allAttackedBy
} from './attacks';
import { generatePixieMoves } from './pixieGen';

// ── Move Creation Helpers ────────────────────────────────────────────────

function createMove(from: number, to: number, capture: boolean, promotion?: 'Q' | 'R' | 'B' | 'N'): Move {
  return {
    from: toRC(from),
    to: toRC(to),
    capture,
    promotion,
  };
}

// ── Pawn Move Generation ─────────────────────────────────────────────────

export function generateWhitePawnMoves(state: BitboardState, moves: Move[], gameState: GameState): void {
  const pawns = state.whitePawns;
  const empty = state.empty;
  const enemies = state.blackAll & ~state.invulnerable;

  const wp = pawns;
  
  // Single push: shift right 8 (toward row 0)
  const wpSingle = (wp >> 8n) & empty;
  
  // Double push: pawns on rank 6 (row 6, bits 48-55)
  const rank6Mask = 0x00FF000000000000n; // row 6
  const wpDouble = (((wp & rank6Mask) >> 8n) & empty) >> 8n & empty;
  
  // Captures
  const wpCaptureLeft  = (wp >> 9n) & enemies & NOT_FILE_H; // up-left
  const wpCaptureRight = (wp >> 7n) & enemies & NOT_FILE_A; // up-right

  // Promotion rank for white = row 0 (bits 0-7)
  const promoMask = 0x00000000000000FFn; // row 0
  const PROMO_TYPES: Array<'Q' | 'R' | 'B' | 'N'> = ['Q', 'R', 'B', 'N'];
  
  // Aristocrat check: if an enemy Aristocrat is alive, pawns cannot promote
  const aristocratBlocks = state.activePixies.some(p => p.type === 'ARISTOCRAT' && p.color === 'b');
  
  // Emit single pushes
  for (const to of iterBits(wpSingle)) {
    const from = to + 8; // The pawn was 8 bits "below" (higher index = lower on board)
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, false, p));
    } else {
      moves.push(createMove(from, to, false));
    }
  }
  
  // Emit double pushes
  for (const to of iterBits(wpDouble)) {
    const from = to + 16;
    moves.push(createMove(from, to, false));
  }
  
  // Emit captures
  for (const to of iterBits(wpCaptureLeft)) {
    const from = to + 9;
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, true, p));
    } else {
      moves.push(createMove(from, to, true));
    }
  }
  for (const to of iterBits(wpCaptureRight)) {
    const from = to + 7;
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, true, p));
    } else {
      moves.push(createMove(from, to, true));
    }
  }

  // En Passant
  if (gameState.enPassant) {
    const epCapR = gameState.enPassant[0] + 1; // white captures black, black pawn is "below" (higher row index)
    const capSq = sq(epCapR, gameState.enPassant[1]);
    if ((bit(capSq) & state.invulnerable) === ZERO) {
      for (const from of iterBits(wp)) {
        const fromRC = toRC(from);
        if (Math.abs(fromRC[1] - gameState.enPassant[1]) === 1 && fromRC[0] - 1 === gameState.enPassant[0]) {
          moves.push({ from: fromRC, to: gameState.enPassant, capture: true, epCapSq: [epCapR, gameState.enPassant[1]] });
        }
      }
    }
  }
}

export function generateBlackPawnMoves(state: BitboardState, moves: Move[], gameState: GameState): void {
  const pawns = state.blackPawns;
  const empty = state.empty;
  const enemies = state.whiteAll & ~state.invulnerable;

  // Black pawns move DOWN = from low rows to high rows = shift LEFT by 8
  const bp = pawns;
  
  // Single push
  const bpSingle = (bp << 8n) & empty;
  
  // Double push: pawns on rank 1 (row 1, bits 8-15)
  const rank1Mask = 0x000000000000FF00n; // row 1
  const bpDouble = (((bp & rank1Mask) << 8n) & empty) << 8n & empty;
  
  // Captures
  const bpCaptureLeft  = (bp << 7n) & enemies & NOT_FILE_H; // down-left
  const bpCaptureRight = (bp << 9n) & enemies & NOT_FILE_A; // down-right

  // Promotion rank for black = row 7 (bits 56-63)
  const promoMask = 0xFF00000000000000n; // row 7
  const PROMO_TYPES: Array<'Q' | 'R' | 'B' | 'N'> = ['Q', 'R', 'B', 'N'];
  
  // Aristocrat check
  const aristocratBlocks = state.activePixies.some(p => p.type === 'ARISTOCRAT' && p.color === 'w');
  
  // Emit single pushes
  for (const to of iterBits(bpSingle)) {
    const from = to - 8;
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, false, p));
    } else {
      moves.push(createMove(from, to, false));
    }
  }
  
  // Emit double pushes
  for (const to of iterBits(bpDouble)) {
    const from = to - 16;
    moves.push(createMove(from, to, false));
  }
  
  // Emit captures
  for (const to of iterBits(bpCaptureLeft)) {
    const from = to - 7;
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, true, p));
    } else {
      moves.push(createMove(from, to, true));
    }
  }
  for (const to of iterBits(bpCaptureRight)) {
    const from = to - 9;
    if ((bit(to) & promoMask) !== ZERO && !aristocratBlocks) {
      for (const p of PROMO_TYPES) moves.push(createMove(from, to, true, p));
    } else {
      moves.push(createMove(from, to, true));
    }
  }

  // En Passant
  if (gameState.enPassant) {
    const epCapR = gameState.enPassant[0] - 1; // black captures white, white pawn is "above" (lower row index)
    const capSq = sq(epCapR, gameState.enPassant[1]);
    if ((bit(capSq) & state.invulnerable) === ZERO) {
      for (const from of iterBits(bp)) {
        const fromRC = toRC(from);
        if (Math.abs(fromRC[1] - gameState.enPassant[1]) === 1 && fromRC[0] + 1 === gameState.enPassant[0]) {
          moves.push({ from: fromRC, to: gameState.enPassant, capture: true, epCapSq: [epCapR, gameState.enPassant[1]] });
        }
      }
    }
  }
}

// ── Knight Move Generation ───────────────────────────────────────────────

function generateKnightMoves(state: BitboardState, color: 'w' | 'b', moves: Move[]): void {
  const knights = color === 'w' ? state.whiteKnights : state.blackKnights;
  const friendly = color === 'w' ? state.whiteAll : state.blackAll;
  const enemies  = (color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const from of iterBits(knights)) {
    const targets = KNIGHT_ATTACKS[from] & ~friendly & ~state.invulnerable;
    
    for (const to of iterBits(targets)) {
      const isCapture = (bit(to) & enemies) !== ZERO;
      moves.push(createMove(from, to, isCapture));
    }
  }
}

// ── Bishop Move Generation ───────────────────────────────────────────────

function generateBishopMoves(state: BitboardState, color: 'w' | 'b', moves: Move[]): void {
  const bishops = color === 'w' ? state.whiteBishops : state.blackBishops;
  const friendly = color === 'w' ? state.whiteAll : state.blackAll;
  const enemies  = (color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const from of iterBits(bishops)) {
    const targets = bishopAttacks(from, state.occupied) & ~friendly & ~state.invulnerable;
    
    for (const to of iterBits(targets)) {
      const isCapture = (bit(to) & enemies) !== ZERO;
      moves.push(createMove(from, to, isCapture));
    }
  }
}

// ── Rook Move Generation ─────────────────────────────────────────────────

function generateRookMoves(state: BitboardState, color: 'w' | 'b', moves: Move[]): void {
  const rooks = color === 'w' ? state.whiteRooks : state.blackRooks;
  const friendly = color === 'w' ? state.whiteAll : state.blackAll;
  const enemies  = (color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const from of iterBits(rooks)) {
    const targets = rookAttacks(from, state.occupied) & ~friendly & ~state.invulnerable;
    
    for (const to of iterBits(targets)) {
      const isCapture = (bit(to) & enemies) !== ZERO;
      moves.push(createMove(from, to, isCapture));
    }
  }
}

// ── Queen Move Generation ────────────────────────────────────────────────

function generateQueenMoves(state: BitboardState, color: 'w' | 'b', moves: Move[]): void {
  const queens = color === 'w' ? state.whiteQueens : state.blackQueens;
  const friendly = color === 'w' ? state.whiteAll : state.blackAll;
  const enemies  = (color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const from of iterBits(queens)) {
    const targets = queenAttacks(from, state.occupied) & ~friendly & ~state.invulnerable;
    
    for (const to of iterBits(targets)) {
      const isCapture = (bit(to) & enemies) !== ZERO;
      moves.push(createMove(from, to, isCapture));
    }
  }
}

// ── King Move Generation ─────────────────────────────────────────────────

function generateKingMoves(state: BitboardState, color: 'w' | 'b', moves: Move[], gameState: GameState, board: Board | null): void {
  const king = color === 'w' ? state.whiteKing : state.blackKing;
  const friendly = color === 'w' ? state.whiteAll : state.blackAll;
  const enemies  = (color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const from of iterBits(king)) {
    const targets = KING_ATTACKS[from] & ~friendly & ~state.invulnerable;
    
    for (const to of iterBits(targets)) {
      const isCapture = (bit(to) & enemies) !== ZERO;
      moves.push(createMove(from, to, isCapture));
    }
  }

  // Castling — must check King is not in check, doesn't pass through check, and doesn't land in check
  const castling = gameState.castling;
  if (castling) {
    const backRank = color === 'w' ? 7 : 0;
    const occ = state.occupied;
    const enemyColor = color === 'w' ? 'b' : 'w';
    // allAttackedBy covers standard pieces only (Pawn, Knight, Bishop, Rook, Queen, King).
    // We supplement with a Knightmare Limbo check: if an enemy Limbo Knightmare can
    // jump to the king square, castling must be forbidden regardless of standard attacks.
    const enemyAttacks = allAttackedBy(state, enemyColor);
    
    // Helper: returns true if an enemy off-board Knightmare can reach the given board square
    const limboKnightmareAttacks = (boardSq: number): boolean => {
      if (!board || !gameState.offBoardPieces) return false;
      const [tgtR, tgtC] = toRC(boardSq);
      const KM_DIRS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as const;
      for (const ob of gameState.offBoardPieces) {
        if (ob.piece.color === enemyColor && ob.piece.pixie === 'KNIGHTMARE') {
          // Frozen by Icicle & Anti-Violence check
          const [obR, obC] = ob.obSq;
          let frozenByIcicle = false;
          let inAvAura = false;
          for (let ir = Math.max(0, obR - 1); ir <= Math.min(7, obR + 1); ir++) {
            for (let ic = Math.max(0, obC - 1); ic <= Math.min(7, obC + 1); ic++) {
              if (board[ir]?.[ic]?.color === color) {
                if (board[ir]?.[ic]?.pixie === 'ICICLE') frozenByIcicle = true;
                if (board[ir]?.[ic]?.pixie === 'ANTI_VIOLENCE') inAvAura = true;
              }
            }
          }
          if (frozenByIcicle || inAvAura) continue;
          for (const [dr, dc] of KM_DIRS) {
            // TS uses r=0 at top; off-board coords use same space. Invert dr for drop row.
            const landR = obR - dr;
            const landC = obC + dc;
            if (landR === tgtR && landC === tgtC) return true;
          }
        }
      }
      return false;
    };

    // Returns true if a square is attacked by standard pieces OR by a Limbo Knightmare OR by a Pixie
    const isAttacked = (boardSq: number): boolean => {
      if ((enemyAttacks & bit(boardSq)) !== ZERO) return true;
      if (limboKnightmareAttacks(boardSq)) return true;
      // Supplement with active Pixies on board (Bouncer, Marauder, Fission Reactor, etc.)
      if (state.activePixies && state.activePixies.length > 0) {
        const pixieMoves = generatePixieMoves(state, enemyColor, gameState);
        const [sqR, sqC] = toRC(boardSq);
        if (pixieMoves.some(m => m.to[0] === sqR && m.to[1] === sqC && m.capture && !m.drop)) return true;
      }
      return false;
    };
    
    if (color === 'w' && (state.whiteKing & bit(sq(backRank, 4))) !== ZERO) {
      const kingSq = sq(backRank, 4);
      // King must not be in check (from standard pieces OR power pieces)
      if (!isAttacked(kingSq)) {
        if (castling.K && (occ & bit(sq(backRank, 5))) === ZERO && (occ & bit(sq(backRank, 6))) === ZERO) {
          if ((state.whiteCastlingRooks & bit(sq(backRank, 7))) !== ZERO) {
            // Transit (f1) and destination (g1) must not be attacked
            if (!isAttacked(sq(backRank, 5)) && !isAttacked(sq(backRank, 6))) {
              moves.push(createMove(kingSq, sq(backRank, 6), false));
            }
          }
        }
        if (castling.Q && (occ & bit(sq(backRank, 1))) === ZERO && (occ & bit(sq(backRank, 2))) === ZERO && (occ & bit(sq(backRank, 3))) === ZERO) {
          if ((state.whiteCastlingRooks & bit(sq(backRank, 0))) !== ZERO) {
            // Transit (d1) and destination (c1) must not be attacked
            if (!isAttacked(sq(backRank, 3)) && !isAttacked(sq(backRank, 2))) {
              moves.push(createMove(kingSq, sq(backRank, 2), false));
            }
          }
        }
      }
    } else if (color === 'b' && (state.blackKing & bit(sq(backRank, 4))) !== ZERO) {
      const kingSq = sq(backRank, 4);
      // King must not be in check (from standard pieces OR power pieces)
      if (!isAttacked(kingSq)) {
        if (castling.k && (occ & bit(sq(backRank, 5))) === ZERO && (occ & bit(sq(backRank, 6))) === ZERO) {
          if ((state.blackCastlingRooks & bit(sq(backRank, 7))) !== ZERO) {
            if (!isAttacked(sq(backRank, 5)) && !isAttacked(sq(backRank, 6))) {
              moves.push(createMove(kingSq, sq(backRank, 6), false));
            }
          }
        }
        if (castling.q && (occ & bit(sq(backRank, 1))) === ZERO && (occ & bit(sq(backRank, 2))) === ZERO && (occ & bit(sq(backRank, 3))) === ZERO) {
          if ((state.blackCastlingRooks & bit(sq(backRank, 0))) !== ZERO) {
            if (!isAttacked(sq(backRank, 3)) && !isAttacked(sq(backRank, 2))) {
              moves.push(createMove(kingSq, sq(backRank, 2), false));
            }
          }
        }
      }
    }
  }
}

// ── Master Generator ─────────────────────────────────────────────────────

/**
 * Generate all pseudo-legal moves for standard (non-Pixie) pieces.
 * This is the entry point called by the search engine.
 */
export function generateStandardMoves(state: BitboardState, color: 'w' | 'b', gameState: GameState, board: Board | null = null): Move[] {
  const moves: Move[] = [];

  if (color === 'w') {
    generateWhitePawnMoves(state, moves, gameState);
  } else {
    generateBlackPawnMoves(state, moves, gameState);
  }

  generateKnightMoves(state, color, moves);
  generateBishopMoves(state, color, moves);
  generateRookMoves(state, color, moves);
  generateQueenMoves(state, color, moves);
  generateKingMoves(state, color, moves, gameState, board);

  return moves;
}
