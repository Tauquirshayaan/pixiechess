/**
 * PixieChess Bitboard Engine v2
 * 
 * Board representation using 64-bit integers (BigInt).
 * Each square maps to a single bit:
 *   bit 0  = a8 (row 0, col 0)
 *   bit 7  = h8 (row 0, col 7)
 *   bit 56 = a1 (row 7, col 0)
 *   bit 63 = h1 (row 7, col 7)
 * 
 * Square index = row * 8 + col
 */

// ── Constants ────────────────────────────────────────────────────────────
export const ZERO = 0n;
export const ONE  = 1n;
export const ALL_SQUARES = 0xFFFFFFFFFFFFFFFFn;

// File masks (columns)
export const FILE_A = 0x0101010101010101n;
export const FILE_B = 0x0202020202020202n;
export const FILE_G = 0x4040404040404040n;
export const FILE_H = 0x8080808080808080n;
export const NOT_FILE_A = ALL_SQUARES ^ FILE_A;
export const NOT_FILE_H = ALL_SQUARES ^ FILE_H;
export const NOT_FILE_AB = ALL_SQUARES ^ FILE_A ^ FILE_B;
export const NOT_FILE_GH = ALL_SQUARES ^ FILE_G ^ FILE_H;

// Rank masks (rows)
export const RANK_1 = 0xFF00000000000000n; // row 7 (white back rank)
export const RANK_2 = 0x00FF000000000000n; // row 6
export const RANK_4 = 0x000000FF00000000n; // row 4
export const RANK_5 = 0x00000000FF000000n; // row 3
export const RANK_7 = 0x000000000000FF00n; // row 1
export const RANK_8 = 0x00000000000000FFn; // row 0 (black back rank)

// ── Utility Functions ────────────────────────────────────────────────────

/** Convert (row, col) to a square index 0-63 */
export function sq(row: number, col: number): number {
  return row * 8 + col;
}

/** Convert square index to (row, col) */
export function toRC(sq: number): [number, number] {
  return [sq >> 3, sq & 7];
}

/** Get a single-bit mask for a square */
export function bit(square: number): bigint {
  return ONE << BigInt(square);
}

/** Population count — number of set bits */
export function popcount(bb: bigint): number {
  let count = 0;
  let b = bb;
  while (b !== ZERO) {
    b &= b - ONE; // Clear lowest set bit
    count++;
  }
  return count;
}

/** Index of the least significant set bit (0-63), or -1 if empty */
export function lsb(bb: bigint): number {
  if (bb === ZERO) return -1;
  let idx = 0;
  let b = bb;
  // Binary search for the lowest bit
  if ((b & 0xFFFFFFFFn) === ZERO) { idx += 32; b >>= 32n; }
  if ((b & 0xFFFFn) === ZERO)     { idx += 16; b >>= 16n; }
  if ((b & 0xFFn) === ZERO)       { idx += 8;  b >>= 8n;  }
  if ((b & 0xFn) === ZERO)        { idx += 4;  b >>= 4n;  }
  if ((b & 0x3n) === ZERO)        { idx += 2;  b >>= 2n;  }
  if ((b & 0x1n) === ZERO)        { idx += 1; }
  return idx;
}

/** Iterator: yields each set bit's square index, clearing as it goes */
export function* iterBits(bb: bigint): Generator<number> {
  let b = bb;
  while (b !== ZERO) {
    const idx = lsb(b);
    yield idx;
    b &= b - ONE; // Pop the LSB
  }
}

// ── File/Rank helpers from square index ──────────────────────────────────
export function fileOf(sq: number): number { return sq & 7; }
export function rankOf(sq: number): number { return sq >> 3; }

export function fileMask(file: number): bigint {
  return FILE_A << BigInt(file);
}

export function rankMask(rank: number): bigint {
  return RANK_8 << BigInt(rank * 8);
}

// ── BitboardState ────────────────────────────────────────────────────────

export interface BitboardState {
  // Per-piece bitboards (14 total)
  whitePawns:   bigint;
  whiteKnights: bigint;
  whiteBishops: bigint;
  whiteRooks:   bigint;
  whiteQueens:  bigint;
  whiteKing:    bigint;
  whitePixies:  bigint; // Pixies not natively handled by standard bitboards

  blackPawns:   bigint;
  blackKnights: bigint;
  blackBishops: bigint;
  blackRooks:   bigint;
  blackQueens:  bigint;
  blackKing:    bigint;
  blackPixies:  bigint;

  // Active migrated pixies for custom bitboard handling
  activePixies: Array<{ sq: number, type: string, color: 'w' | 'b', pieceState?: any }>;

  // Aggregate boards (derived, but cached for speed)
  whiteAll: bigint;
  blackAll: bigint;
  occupied: bigint;
  empty:    bigint;
  invulnerable: bigint; // squares that cannot be captured
}

/** Create an empty bitboard state */
export function emptyBitboardState(): BitboardState {
  return {
    whitePawns: ZERO, whiteKnights: ZERO, whiteBishops: ZERO,
    whiteRooks: ZERO, whiteQueens: ZERO, whiteKing: ZERO, whitePixies: ZERO,
    blackPawns: ZERO, blackKnights: ZERO, blackBishops: ZERO,
    blackRooks: ZERO, blackQueens: ZERO, blackKing: ZERO, blackPixies: ZERO,
    activePixies: [],
    whiteAll: ZERO, blackAll: ZERO, occupied: ZERO, empty: ALL_SQUARES,
    invulnerable: ZERO,
  };
}

/** Recalculate the aggregate boards from individual piece boards */
export function updateAggregates(state: BitboardState): void {
  state.whiteAll = state.whitePawns | state.whiteKnights | state.whiteBishops |
                   state.whiteRooks | state.whiteQueens  | state.whiteKing | state.whitePixies;
  state.blackAll = state.blackPawns | state.blackKnights | state.blackBishops |
                   state.blackRooks | state.blackQueens  | state.blackKing | state.blackPixies;
  state.occupied = state.whiteAll | state.blackAll;
  state.empty    = ALL_SQUARES ^ state.occupied;
}

/** Clone a BitboardState (cheap — just copying 16 BigInts) */
export function cloneBB(s: BitboardState): BitboardState {
  return {
    whitePawns: s.whitePawns, whiteKnights: s.whiteKnights, whiteBishops: s.whiteBishops,
    whiteRooks: s.whiteRooks, whiteQueens: s.whiteQueens, whiteKing: s.whiteKing, whitePixies: s.whitePixies,
    blackPawns: s.blackPawns, blackKnights: s.blackKnights, blackBishops: s.blackBishops,
    blackRooks: s.blackRooks, blackQueens: s.blackQueens, blackKing: s.blackKing, blackPixies: s.blackPixies,
    activePixies: [...s.activePixies],
    whiteAll: s.whiteAll, blackAll: s.blackAll, occupied: s.occupied, empty: s.empty, invulnerable: s.invulnerable,
  };
}

/** Get the piece board for a specific piece type and color */
export function getPieceBoard(state: BitboardState, pieceType: string, color: 'w' | 'b'): bigint {
  if (color === 'w') {
    switch (pieceType) {
      case 'P': return state.whitePawns;
      case 'N': return state.whiteKnights;
      case 'B': return state.whiteBishops;
      case 'R': return state.whiteRooks;
      case 'Q': return state.whiteQueens;
      case 'K': return state.whiteKing;
    }
  } else {
    switch (pieceType) {
      case 'P': return state.blackPawns;
      case 'N': return state.blackKnights;
      case 'B': return state.blackBishops;
      case 'R': return state.blackRooks;
      case 'Q': return state.blackQueens;
      case 'K': return state.blackKing;
    }
  }
  return ZERO;
}
