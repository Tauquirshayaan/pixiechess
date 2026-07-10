/**
 * Pre-computed Attack Tables for leaping pieces (Knight, King)
 * and ray-based attack generation for sliding pieces (Bishop, Rook, Queen).
 * 
 * All tables are computed once at module load time and are O(1) lookups thereafter.
 */

import {
  ONE, ZERO, ALL_SQUARES,
  NOT_FILE_A, NOT_FILE_H, NOT_FILE_AB, NOT_FILE_GH,
  bit, sq, iterBits, fileOf, rankOf,
  type BitboardState
} from './bitboard';

// ── Knight Attacks ───────────────────────────────────────────────────────
// Pre-computed for all 64 squares. A knight on square S attacks these squares.
export const KNIGHT_ATTACKS: bigint[] = new Array(64);
export const CAMEL_ATTACKS: bigint[] = new Array(64);

function initKnightAttacks(): void {
  for (let s = 0; s < 64; s++) {
    const b = bit(s);
    let attacks = ZERO;
    
    // 8 possible knight jumps with file-wrapping guards
    attacks |= (b << 17n) & NOT_FILE_A;      // Up 2, Right 1
    attacks |= (b << 15n) & NOT_FILE_H;      // Up 2, Left 1
    attacks |= (b << 10n) & NOT_FILE_AB;     // Up 1, Right 2
    attacks |= (b << 6n)  & NOT_FILE_GH;     // Up 1, Left 2
    attacks |= (b >> 6n)  & NOT_FILE_AB;     // Down 1, Right 2
    attacks |= (b >> 10n) & NOT_FILE_GH;     // Down 1, Left 2
    attacks |= (b >> 15n) & NOT_FILE_A;      // Down 2, Right 1
    attacks |= (b >> 17n) & NOT_FILE_H;      // Down 2, Left 1
    
    KNIGHT_ATTACKS[s] = attacks & ALL_SQUARES;
  }
}

function initCamelAttacks(): void {
  for (let s = 0; s < 64; s++) {
    const r = Math.floor(s / 8);
    const c = s % 8;
    let attacks = ZERO;
    for (const [dr, dc] of [[-3,-1],[-3,1],[-1,-3],[-1,3],[1,-3],[1,3],[3,-1],[3,1]]) {
      const tr = r + dr, tc = c + dc;
      if (tr >= 0 && tr <= 7 && tc >= 0 && tc <= 7) {
        attacks |= bit(tr * 8 + tc);
      }
    }
    CAMEL_ATTACKS[s] = attacks & ALL_SQUARES;
  }
}

// ── King Attacks ─────────────────────────────────────────────────────────
export const KING_ATTACKS: bigint[] = new Array(64);

function initKingAttacks(): void {
  for (let s = 0; s < 64; s++) {
    const b = bit(s);
    let attacks = ZERO;
    
    // 8 directions, 1 square each
    attacks |= (b << 8n);                     // Up
    attacks |= (b >> 8n);                     // Down
    attacks |= (b << 1n) & NOT_FILE_A;       // Right
    attacks |= (b >> 1n) & NOT_FILE_H;       // Left
    attacks |= (b << 9n) & NOT_FILE_A;       // Up-Right
    attacks |= (b << 7n) & NOT_FILE_H;       // Up-Left
    attacks |= (b >> 7n) & NOT_FILE_A;       // Down-Right
    attacks |= (b >> 9n) & NOT_FILE_H;       // Down-Left
    
    KING_ATTACKS[s] = attacks & ALL_SQUARES;
  }
}

// ── Pawn Attacks ─────────────────────────────────────────────────────────
export const WHITE_PAWN_ATTACKS: bigint[] = new Array(64);
export const BLACK_PAWN_ATTACKS: bigint[] = new Array(64);

function initPawnAttacks(): void {
  for (let s = 0; s < 64; s++) {
    const b = bit(s);
    
    // White pawns attack "upward" (toward lower row indices = lower bit indices)
    let wAtk = ZERO;
    wAtk |= (b >> 9n) & NOT_FILE_H;  // Capture up-left
    wAtk |= (b >> 7n) & NOT_FILE_A;  // Capture up-right
    WHITE_PAWN_ATTACKS[s] = wAtk & ALL_SQUARES;
    
    // Black pawns attack "downward" (toward higher row indices = higher bit indices)
    let bAtk = ZERO;
    bAtk |= (b << 7n) & NOT_FILE_H;  // Capture down-left
    bAtk |= (b << 9n) & NOT_FILE_A;  // Capture down-right
    BLACK_PAWN_ATTACKS[s] = bAtk & ALL_SQUARES;
  }
}

// ── Sliding Piece Rays (Classical approach) ──────────────────────────────
// For each square, we pre-compute the ray in each of 8 directions.
// At search time, we walk the ray until we hit a blocker.

// Direction offsets: [fileDelta, rankDelta]
// North = toward rank 8 (row 0), South = toward rank 1 (row 7)
const DIRECTIONS = {
  NORTH:      [0,  -1],
  SOUTH:      [0,   1],
  EAST:       [1,   0],
  WEST:       [-1,  0],
  NORTH_EAST: [1,  -1],
  NORTH_WEST: [-1, -1],
  SOUTH_EAST: [1,   1],
  SOUTH_WEST: [-1,  1],
} as const;

type DirKey = keyof typeof DIRECTIONS;

// Pre-computed ray masks for each direction from each square
const RAYS: Record<DirKey, bigint[]> = {
  NORTH:      new Array(64),
  SOUTH:      new Array(64),
  EAST:       new Array(64),
  WEST:       new Array(64),
  NORTH_EAST: new Array(64),
  NORTH_WEST: new Array(64),
  SOUTH_EAST: new Array(64),
  SOUTH_WEST: new Array(64),
};

function initRays(): void {
  for (const dirName of Object.keys(DIRECTIONS) as DirKey[]) {
    const [df, dr] = DIRECTIONS[dirName];
    for (let s = 0; s < 64; s++) {
      let ray = ZERO;
      let f = fileOf(s) + df;
      let r = rankOf(s) + dr;
      
      while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        ray |= bit(sq(r, f));
        f += df;
        r += dr;
      }
      
      RAYS[dirName][s] = ray;
    }
  }
}

// ── Runtime Sliding Attack Generation ────────────────────────────────────

/** 
 * Generate attacks for a sliding piece along a positive ray (toward higher bit indices).
 * Stops at first blocker (inclusive — we can capture the blocker).
 */
function positiveRayAttacks(square: number, occupied: bigint, dir: DirKey): bigint {
  const ray = RAYS[dir][square];
  const blockers = ray & occupied;
  
  if (blockers === ZERO) return ray; // No blockers — entire ray is valid
  
  // Find the FIRST blocker in the ray direction
  const firstBlocker = lsbForRay(blockers);
  // Remove everything beyond the first blocker
  return ray ^ RAYS[dir][firstBlocker];
}

/**
 * Generate attacks for a sliding piece along a negative ray (toward lower bit indices).
 */
function negativeRayAttacks(square: number, occupied: bigint, dir: DirKey): bigint {
  const ray = RAYS[dir][square];
  const blockers = ray & occupied;
  
  if (blockers === ZERO) return ray;
  
  // Find the LAST blocker in the ray direction (MSB of blockers on the ray)
  const lastBlocker = msbForRay(blockers);
  return ray ^ RAYS[dir][lastBlocker];
}

/** LSB helper — lowest set bit index */
function lsbForRay(bb: bigint): number {
  if (bb === ZERO) return -1;
  let idx = 0;
  let b = bb;
  if ((b & 0xFFFFFFFFn) === ZERO) { idx += 32; b >>= 32n; }
  if ((b & 0xFFFFn) === ZERO)     { idx += 16; b >>= 16n; }
  if ((b & 0xFFn) === ZERO)       { idx += 8;  b >>= 8n;  }
  if ((b & 0xFn) === ZERO)        { idx += 4;  b >>= 4n;  }
  if ((b & 0x3n) === ZERO)        { idx += 2;  b >>= 2n;  }
  if ((b & 0x1n) === ZERO)        { idx += 1; }
  return idx;
}

/** MSB helper — most significant set bit index */
function msbForRay(bb: bigint): number {
  if (bb === ZERO) return -1;
  let idx = 0;
  let b = bb;
  if (b >= (ONE << 32n)) { idx += 32; b >>= 32n; }
  if (b >= (ONE << 16n)) { idx += 16; b >>= 16n; }
  if (b >= (ONE << 8n))  { idx += 8;  b >>= 8n;  }
  if (b >= (ONE << 4n))  { idx += 4;  b >>= 4n;  }
  if (b >= (ONE << 2n))  { idx += 2;  b >>= 2n;  }
  if (b >= (ONE << 1n))  { idx += 1; }
  return idx;
}

// ── Public Attack Functions ──────────────────────────────────────────────

/** Bishop attacks from a square given occupied squares */
export function bishopAttacks(square: number, occupied: bigint): bigint {
  return (
    negativeRayAttacks(square, occupied, 'NORTH_EAST') | // -7
    negativeRayAttacks(square, occupied, 'NORTH_WEST') | // -9
    positiveRayAttacks(square, occupied, 'SOUTH_EAST') | // +9
    positiveRayAttacks(square, occupied, 'SOUTH_WEST')   // +7
  );
}

/** Rook attacks from a square given occupied squares */
export function rookAttacks(square: number, occupied: bigint): bigint {
  return (
    negativeRayAttacks(square, occupied, 'NORTH') | // -8
    positiveRayAttacks(square, occupied, 'SOUTH') | // +8
    positiveRayAttacks(square, occupied, 'EAST') |  // +1
    negativeRayAttacks(square, occupied, 'WEST')    // -1
  );
}

/** Queen attacks = Bishop + Rook combined */
export function queenAttacks(square: number, occupied: bigint): bigint {
  return bishopAttacks(square, occupied) | rookAttacks(square, occupied);
}

/** Get all squares attacked by a given color (for check/pin detection) */
export function allAttackedBy(state: BitboardState, color: 'w' | 'b'): bigint {
  let attacks = ZERO;
  const occ = state.occupied;
  
  if (color === 'w') {
    // Pawns
    for (const s of iterBits(state.whitePawns)) attacks |= WHITE_PAWN_ATTACKS[s];
    // Knights
    for (const s of iterBits(state.whiteKnights)) attacks |= KNIGHT_ATTACKS[s];
    // Bishops
    for (const s of iterBits(state.whiteBishops)) attacks |= bishopAttacks(s, occ);
    // Rooks
    for (const s of iterBits(state.whiteRooks)) attacks |= rookAttacks(s, occ);
    // Queens
    for (const s of iterBits(state.whiteQueens)) attacks |= queenAttacks(s, occ);
    // King
    for (const s of iterBits(state.whiteKing)) attacks |= KING_ATTACKS[s];
  } else {
    for (const s of iterBits(state.blackPawns)) attacks |= BLACK_PAWN_ATTACKS[s];
    for (const s of iterBits(state.blackKnights)) attacks |= KNIGHT_ATTACKS[s];
    for (const s of iterBits(state.blackBishops)) attacks |= bishopAttacks(s, occ);
    for (const s of iterBits(state.blackRooks)) attacks |= rookAttacks(s, occ);
    for (const s of iterBits(state.blackQueens)) attacks |= queenAttacks(s, occ);
    for (const s of iterBits(state.blackKing)) attacks |= KING_ATTACKS[s];
  }
  
  return attacks;
}

// ── Initialize all tables at module load ─────────────────────────────────
initKnightAttacks();
initCamelAttacks();
initKingAttacks();
initPawnAttacks();
initRays();
