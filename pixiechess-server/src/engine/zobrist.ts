import type { Board, Piece } from './types';

// Xorshift32 PRNG for deterministic random numbers
let seed = 12345;
function nextRandom32(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

const pieceStringMap = new Map<string, number>();
let nextPieceId = 0;

export function getPieceId(p: Piece): number {
  let key = `${p.color}_${p.type}_${p.pixie || ''}_${p.invulnerable ? '1' : '0'}`;
  if (p.state) {
    if (p.state.is_charged) key += '_C';
    if (p.state.capture_count) key += `_f${p.state.capture_count}`;
    if (p.state.kill_count) key += `_k${p.state.kill_count}`;
    if (p.state.dissipated) key += '_D';
  }
  let id = pieceStringMap.get(key);
  if (id === undefined) {
    id = nextPieceId++;
    pieceStringMap.set(key, id);
    
    // Expand arrays if needed
    if (ZOBRIST_LOW.length <= id) {
      ZOBRIST_LOW.push(new Int32Array(64));
      ZOBRIST_HIGH.push(new Int32Array(64));
      for (let sq = 0; sq < 64; sq++) {
        ZOBRIST_LOW[id][sq] = nextRandom32();
        ZOBRIST_HIGH[id][sq] = nextRandom32();
      }
    }
  }
  return id;
}

// Zobrist Tables (indexed by pieceId, then square 0-63)
export const ZOBRIST_LOW: Int32Array[] = [];
export const ZOBRIST_HIGH: Int32Array[] = [];

// Turn to move (if it's black's turn)
export const ZOBRIST_TURN_LOW = nextRandom32();
export const ZOBRIST_TURN_HIGH = nextRandom32();

/**
 * Computes the full Zobrist hash of a board from scratch.
 * Used for the root node, after which incremental hashing is faster.
 */
export function computeZobristHash(board: Board, maximizing: boolean): [number, number] {
  let hLow = 0;
  let hHigh = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) {
        const id = getPieceId(p);
        const sq = (r << 3) | c;
        hLow ^= ZOBRIST_LOW[id][sq];
        hHigh ^= ZOBRIST_HIGH[id][sq];
      }
    }
  }

  if (!maximizing) { // Assuming maximizing = true means White's turn in standard minimax context, wait...
    // In our engine, maximizing is true if the CURRENT turn is the original turn.
    // Actually, usually hash incorporates side to move based on 'color'. 
    // If 'maximizing' alternates every ply, we can just XOR it.
    hLow ^= ZOBRIST_TURN_LOW;
    hHigh ^= ZOBRIST_TURN_HIGH;
  }

  return [hLow >>> 0, hHigh >>> 0];
}
