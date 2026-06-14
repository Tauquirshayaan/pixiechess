import type { Board, Move, GameState, AbilityTracker } from './types';
import { getAllMovesForColor, isCheck } from './moveGenerator';
import { applyMove } from './applyMove';
import { evaluate } from './evaluator';
import { getOpeningBookMoves } from './openingBook';

export interface SearchResult {
  move: Move | null;
  score: number;
  nodes: number;
  effects: string[];
  depth: number;
  ttHits: number;
  multiPv?: { move: Move; score: number }[];
}

// ── Piece values for MVV-LVA move ordering ──────────────────────────────
const PIECE_VAL: Record<string, number> = {
  'P': 10, 'N': 30, 'B': 32, 'R': 50, 'Q': 90, 'K': 1000
};

// ── Transposition Table ─────────────────────────────────────────────────
const TT_EXACT = 0;
const TT_LOWER_BOUND = 1;
const TT_UPPER_BOUND = 2;
type TTFlag = typeof TT_EXACT | typeof TT_LOWER_BOUND | typeof TT_UPPER_BOUND;

export const TT_MAX_SIZE = 32_000_000; // 32M entries (512 MB)
let ttArray: Int32Array | null = null;

export function initTT(buffer?: SharedArrayBuffer | ArrayBuffer) {
  if (!buffer) {
    buffer = new ArrayBuffer(TT_MAX_SIZE * 16); // 16 bytes per entry (4x Int32)
  }
  ttArray = new Int32Array(buffer);
}

function ttStore(hashLow: number, hashHigh: number, depth: number, score: number, flag: TTFlag, bestMove: Move | null): void {
  if (!ttArray) return;
  const index = (hashLow >>> 0) % TT_MAX_SIZE;
  const offset = index * 4;

  const existingDepth = ttArray[offset + 1] & 0xFF;
  if (ttArray[offset] === hashHigh && existingDepth > depth) return;

  let moveInt = 0;
  if (bestMove) {
    let prom = 0;
    if (bestMove.promotion === 'Q') prom = 1;
    else if (bestMove.promotion === 'R') prom = 2;
    else if (bestMove.promotion === 'B') prom = 3;
    else if (bestMove.promotion === 'N') prom = 4;
    
    moveInt = ((bestMove.from[0] + 2) & 0xF) | 
              (((bestMove.from[1] + 2) & 0xF) << 4) | 
              (((bestMove.to[0] + 2) & 0xF) << 8) | 
              (((bestMove.to[1] + 2) & 0xF) << 12) | 
              (prom << 16);
  }

  const dataInt = (depth & 0xFF) | ((flag & 0x3) << 8) | ((score & 0xFFFF) << 16);

  ttArray[offset] = hashHigh;
  ttArray[offset + 1] = dataInt;
  ttArray[offset + 2] = moveInt;
}

function ttLookup(hashLow: number, hashHigh: number, depth: number, alpha: number, beta: number): { score: number; bestMoveInt: number } | null {
  if (!ttArray) return null;
  const index = (hashLow >>> 0) % TT_MAX_SIZE;
  const offset = index * 4;

  if (ttArray[offset] !== hashHigh) return null;

  const dataInt = ttArray[offset + 1];
  const entryDepth = dataInt & 0xFF;

  const flag = (dataInt >> 8) & 0x3;
  let score = (dataInt >> 16) & 0xFFFF;
  if (score > 32767) score -= 65536; // Two's complement signed 16-bit
  const bestMoveInt = ttArray[offset + 2];

  if (entryDepth >= depth) {
    if (flag === TT_EXACT) return { score, bestMoveInt };
    if (flag === TT_LOWER_BOUND && score >= beta) return { score, bestMoveInt };
    if (flag === TT_UPPER_BOUND && score <= alpha) return { score, bestMoveInt };
  }

  // If we can't use the score for a cutoff, we can still use the best move for ordering
  // But we only return it if we actually want to signal a cutoff. For ordering, we use ttGetBestMoveInt.
  return null;
}

function ttGetBestMoveInt(hashLow: number, hashHigh: number): number | null {
  if (!ttArray) return null;
  const index = (hashLow >>> 0) % TT_MAX_SIZE;
  const offset = index * 4;
  if (ttArray[offset] !== hashHigh) return null;
  const moveInt = ttArray[offset + 2];
  return moveInt === 0 ? null : moveInt;
}

// ── Zobrist-like Board Hashing ──────────────────────────────────────────
import { computeZobristHash } from './zobrist';

// We now use computeZobristHash instead of string building!

// ── Killer Move Table ───────────────────────────────────────────────────
// 2 killer moves per ply, up to 64 ply deep. Killer moves caused a beta
// cutoff in a sibling node at the same depth — try them first!
const MAX_PLY = 64;
const killerMoves: Array<[Move | null, Move | null]> = Array.from({ length: MAX_PLY }, () => [null, null]);

function storeKiller(ply: number, move: Move): void {
  if (ply >= MAX_PLY) return;
  // Don't store captures as killers (MVV-LVA handles those)
  if (move.capture) return;
  const [k1, k2] = killerMoves[ply];
  // Already stored
  if (k1 && k1.from[0] === move.from[0] && k1.from[1] === move.from[1] &&
      k1.to[0] === move.to[0] && k1.to[1] === move.to[1]) return;
  killerMoves[ply] = [move, k1];
  void k2; // shift out k2
}

function isKiller(move: Move, ply: number): boolean {
  if (ply >= MAX_PLY) return false;
  const [k1, k2] = killerMoves[ply];
  const match = (k: Move | null) => !!(k &&
    k.from[0] === move.from[0] && k.from[1] === move.from[1] &&
    k.to[0] === move.to[0] && k.to[1] === move.to[1]);
  return match(k1) || match(k2);
}

// ── History Heuristic Table ─────────────────────────────────────────────
// Tracks how often each [from][to] quiet move caused a beta cutoff.
// Higher score = this move is usually good. Used to sort quiet moves.
// 64 * 64 = 4096 entries, indexed by (from_sq * 64 + to_sq)
const historyTable = new Int32Array(64 * 64);

function historyKey(move: Move): number {
  return (move.from[0] * 8 + move.from[1]) * 64 + (move.to[0] * 8 + move.to[1]);
}

function updateHistory(move: Move, depth: number): void {
  if (move.capture) return; // Only quiet moves
  const key = historyKey(move);
  historyTable[key] += depth * depth; // Deeper cutoffs are more valuable
  // Aging: prevent overflow
  if (historyTable[key] > 1_000_000) {
    for (let i = 0; i < historyTable.length; i++) historyTable[i] >>= 1;
  }
}

// ── Move Ordering ───────────────────────────────────────────────────────
export function orderMoves(moves: Move[], board: Board, ttBestMoveInt: number | null, ply = 0): Move[] {
  return moves.sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    // 0. TT Best Move — always first
    if (ttBestMoveInt !== null) {
      const ttFromR = (ttBestMoveInt & 0xF) - 2;
      const ttFromC = ((ttBestMoveInt >> 4) & 0xF) - 2;
      const ttToR = ((ttBestMoveInt >> 8) & 0xF) - 2;
      const ttToC = ((ttBestMoveInt >> 12) & 0xF) - 2;
      
      if (a.from[0] === ttFromR && a.from[1] === ttFromC && a.to[0] === ttToR && a.to[1] === ttToC) scoreA += 10_000_000;
      if (b.from[0] === ttFromR && b.from[1] === ttFromC && b.to[0] === ttToR && b.to[1] === ttToC) scoreB += 10_000_000;
    }

    const pieceA = board[a.from[0]][a.from[1]];
    const pieceB = board[b.from[0]][b.from[1]];

    // 1. Golden Pawn win
    if (pieceA?.pixie === 'GOLDEN_PAWN' && (a.to[0] === 0 || a.to[0] === 7)) scoreA += 1_000_000;
    if (pieceB?.pixie === 'GOLDEN_PAWN' && (b.to[0] === 0 || b.to[0] === 7)) scoreB += 1_000_000;

    // 2. Captures — MVV-LVA
    if (a.capture) {
      const victim = board[a.to[0]][a.to[1]];
      scoreA += 100_000 + (victim ? (PIECE_VAL[victim.type] || 0) * 10 : 0) - (pieceA ? (PIECE_VAL[pieceA.type] || 0) : 0);
    }
    if (b.capture) {
      const victim = board[b.to[0]][b.to[1]];
      scoreB += 100_000 + (victim ? (PIECE_VAL[victim.type] || 0) * 10 : 0) - (pieceB ? (PIECE_VAL[pieceB.type] || 0) : 0);
    }

    // 3. Promotions
    if (a.promotion) scoreA += 80_000;
    if (b.promotion) scoreB += 80_000;

    // 4. Special ability triggers
    if (a.icicleFreeze || a.bladeThru || a.lineCap || a.lightning || a.push) scoreA += 50_000;
    if (b.icicleFreeze || b.bladeThru || b.lineCap || b.lightning || b.push) scoreB += 50_000;

    // 5. Killer moves — quiet moves that previously caused cutoffs at this ply
    if (!a.capture && isKiller(a, ply)) scoreA += 20_000;
    if (!b.capture && isKiller(b, ply)) scoreB += 20_000;

    // 6. History heuristic — quiet moves sorted by learned effectiveness
    if (!a.capture) scoreA += historyTable[historyKey(a)] || 0;
    if (!b.capture) scoreB += historyTable[historyKey(b)] || 0;

    return scoreB - scoreA;
  });
}

// ── Static Exchange Evaluation (SEE) ───────────────────────────────────
// Quick check: will this capture gain or lose material?
// Used to skip bad captures in quiescence search.
function seeSign(board: Board, move: Move): number {
  if (!move.capture) return 1;
  const attacker = board[move.from[0]][move.from[1]];
  const victim = board[move.to[0]][move.to[1]];
  if (!attacker || !victim) return 1;
  // Simple: if attacker value <= victim value, capture is winning/neutral
  return (PIECE_VAL[victim.type] || 0) - (PIECE_VAL[attacker.type] || 0);
}

// ── Quiescence Search ───────────────────────────────────────────────────
function quiescence(
  board: Board,
  alpha: number,
  beta: number,
  maximizing: boolean,
  gameState: GameState,
  tracker: AbilityTracker,
  stats: { nodes: number; ttHits: number; startTime?: number; timeLimitMs?: number; abort?: boolean },
  qDepth: number
): number {
  stats.nodes++;

  let wKing = false, bKing = false;
  for (let r = 0; r < 8 && (!wKing || !bKing); r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p?.type === 'K') { if (p.color === 'w') wKing = true; else bKing = true; }
    }
  }
  if (!wKing) return -9999;
  if (!bKing) return 9999;

  const standPat = evaluate(board, gameState);
  if (qDepth <= 0) return standPat;

  if (maximizing) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) return alpha;
    if (standPat < beta) beta = standPat;
  }

  const color = maximizing ? 'w' : 'b';
  const allMoves = getAllMovesForColor(board, color, gameState);
  const noisyMoves = allMoves.filter(m =>
    m.capture || m.icicleFreeze || m.bladeThru?.length || m.lineCap?.length ||
    m.lightning || m.push || m.promotion ||
    (board[m.from[0]][m.from[1]]?.pixie === 'GOLDEN_PAWN' && (m.to[0] === 0 || m.to[0] === 7))
  );

  if (noisyMoves.length === 0) return standPat;

  // Filter losing captures with SEE
  const goodMoves = noisyMoves.filter(m => !m.capture || seeSign(board, m) >= -50);
  const movesToSearch = goodMoves.length > 0 ? goodMoves : noisyMoves;
  const ordered = orderMoves(movesToSearch, board, null, 0);

  if (maximizing) {
    for (const move of ordered) {
      if (move.rocket) continue;
      tracker.push(gameState);
      const { board: nb, effects, gameState: ngs } = applyMove(board, move, gameState, tracker);
      if (effects.includes('PIXIE_WIN')) { tracker.pop(); return 10000; }
      const score = quiescence(nb, alpha, beta, false, ngs, tracker, stats, qDepth - 1);
      tracker.pop();
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return alpha;
  } else {
    for (const move of ordered) {
      if (move.rocket) continue;
      tracker.push(gameState);
      const { board: nb, effects, gameState: ngs } = applyMove(board, move, gameState, tracker);
      if (effects.includes('PIXIE_WIN')) { tracker.pop(); return -10000; }
      const score = quiescence(nb, alpha, beta, true, ngs, tracker, stats, qDepth - 1);
      tracker.pop();
      if (score < beta) beta = score;
      if (alpha >= beta) break;
    }
    return beta;
  }
}

// ── Alpha-Beta with PVS + NMP + LMR + Killers + History ─────────────────
export function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  gameState: GameState,
  tracker: AbilityTracker,
  stats: { nodes: number; ttHits: number; startTime?: number; timeLimitMs?: number; abort?: boolean },
  ply = 0,
  allowNullMove = true
): number {
  stats.nodes++;

  // Terminal: king missing
  let wKing = false, bKing = false;
  for (let r = 0; r < 8 && (!wKing || !bKing); r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p?.type === 'K') { if (p.color === 'w') wKing = true; else bKing = true; }
    }
  }
  if (!wKing) return -9999;
  if (!bKing) return 9999;

  const pvNode = beta - alpha > 1; // True in PVS full-window nodes

  // ── TT Probe ──
  const [hashLow, hashHigh] = computeZobristHash(board, maximizing);
  const ttHit = ttLookup(hashLow, hashHigh, depth, alpha, beta);
  if (ttHit) {
    stats.ttHits++;
    return ttHit.score;
  }

  // ── Leaf: Quiescence ──
  if (depth === 0) {
    return quiescence(board, alpha, beta, maximizing, gameState, tracker, stats, 2);
  }

  const color = maximizing ? 'w' : 'b';

  // ── Null Move Pruning (NMP) ─────────────────────────────────────────────
  // If we "pass" our turn (null move) and still cause a beta cutoff at
  // reduced depth, this position is almost certainly too good — prune it.
  // Only safe in non-PV nodes, when not in check, and depth >= 3.
  if (allowNullMove && !pvNode && depth >= 3) {
    const inCheck = isCheck(board, color, gameState);
    if (!inCheck) {
      const R = depth >= 6 ? 3 : 2;
      tracker.push(gameState);
      const nullGs = { ...gameState };
      // Pass the same gameState — null move just flips the turn perspective
      const nullScore = minimax(board, depth - 1 - R, -beta, -beta + 1, !maximizing, nullGs, tracker, stats, ply + 1, false);
      tracker.pop();
      // The returned score is from the opponent's view; negate for our view
      if (-nullScore >= beta) {
        return beta; // Pruned — position is too good, no need to search further
      }
    }
  }

  const moves = getAllMovesForColor(board, color, gameState);

  if (moves.length === 0) {
    if (isCheck(board, color, gameState)) {
      return maximizing ? -9000 + ply : 9000 - ply; // Prefer faster mates
    }
    return 0; // Stalemate
  }

  const ttBestInt = ttGetBestMoveInt(hashLow, hashHigh);
  const orderedMoves = orderMoves(moves, board, ttBestInt, ply);

  let bestMoveInNode: Move | null = null;
  let moveCount = 0;

  if (maximizing) {
    let maxEval = -Infinity;

    for (const move of orderedMoves) {
      if (move.rocket) continue;
      moveCount++;
      tracker.push(gameState);
      const { board: nb, effects, gameState: ngs } = applyMove(board, move, gameState, tracker);

      if (effects.includes('PIXIE_WIN')) {
        tracker.pop();
        ttStore(hashLow, hashHigh, depth, 10000, TT_EXACT, move);
        return 10000;
      }

      let evalScore: number;

      // ── Futility Pruning (maximizing) ──
      // If at depth 1-2, static eval is so far below alpha that even a good move can't help, skip it
      const isQuietMove = !move.capture && !move.promotion && !move.push;
      if (isQuietMove && depth <= 2 && moveCount > 1) {
        const FUTILITY_MARGIN = depth === 1 ? 1.5 : 2.5;
        const staticEval = evaluate(board, gameState);
        if (staticEval + FUTILITY_MARGIN <= alpha) {
          tracker.pop();
          continue;
        }
      }

      // ── DANCER special: bonus quiet moves after giving check ──
      if (effects.includes('DANCER_CHECK') && depth > 1) {
        const bonusMoves = getAllMovesForColor(nb, color, ngs).filter(m => !m.capture && !m.rocket);
        if (bonusMoves.length > 0) {
          const orderedBonus = orderMoves(bonusMoves, nb, null, ply + 1);
          let bonusBest = -Infinity;
          for (let bi = 0; bi < Math.min(2, orderedBonus.length); bi++) {
            tracker.push(ngs);
            const { board: nb2, gameState: ngs2 } = applyMove(nb, orderedBonus[bi], ngs, tracker);
            const bs = minimax(nb2, depth - 1, alpha, beta, false, ngs2, tracker, stats, ply + 1);
            tracker.pop();
            if (bs > bonusBest) bonusBest = bs;
          }
          evalScore = bonusBest;
        } else {
          evalScore = minimax(nb, depth - 1, alpha, beta, false, ngs, tracker, stats, ply + 1);
        }
      }
      // ── Principal Variation Search (PVS) ──
      else if (moveCount === 1) {
        // Search first move (likely best from TT) with full window
        evalScore = minimax(nb, depth - 1, alpha, beta, false, ngs, tracker, stats, ply + 1);
      } else {
        // ── Late Move Reductions (LMR) ──
        // Later moves are likely worse — search at reduced depth first
        let lmrDepth = depth - 1;
        const isQuiet = !move.capture && !move.promotion && !move.push;
        if (isQuiet && depth >= 3 && moveCount >= 4) {
          // More aggressive reduction: log-based, scales with both depth and move count
          const reduction = Math.floor(Math.sqrt(depth - 1) * Math.sqrt(moveCount - 1) * 0.75);
          lmrDepth = Math.max(1, depth - 1 - reduction);
        }

        // Zero-window search with possible reduction
        evalScore = minimax(nb, lmrDepth, alpha, alpha + 1, false, ngs, tracker, stats, ply + 1);

        // If reduced search fails high, re-search at full depth with full window
        if (evalScore > alpha && lmrDepth < depth - 1) {
          evalScore = minimax(nb, depth - 1, alpha, beta, false, ngs, tracker, stats, ply + 1);
        } else if (evalScore > alpha && evalScore < beta) {
          // PVS re-search: zero-window failed high, do full re-search
          evalScore = minimax(nb, depth - 1, alpha, beta, false, ngs, tracker, stats, ply + 1);
        }
      }
      tracker.pop();

      if (evalScore > maxEval) { maxEval = evalScore; bestMoveInNode = move; }
      if (evalScore > alpha) alpha = evalScore;
      if (beta <= alpha) {
        // Beta cutoff — update heuristics
        storeKiller(ply, move);
        updateHistory(move, depth);
        break;
      }
    }

    const flag = maxEval <= alpha ? TT_UPPER_BOUND : (maxEval >= beta ? TT_LOWER_BOUND : TT_EXACT);
    ttStore(hashLow, hashHigh, depth, maxEval, flag, bestMoveInNode);
    return maxEval;

  } else {
    let minEval = Infinity;

    for (const move of orderedMoves) {
      if (move.rocket) continue;
      moveCount++;
      tracker.push(gameState);
      const { board: nb, effects, gameState: ngs } = applyMove(board, move, gameState, tracker);

      if (effects.includes('PIXIE_WIN')) {
        tracker.pop();
        ttStore(hashLow, hashHigh, depth, -10000, TT_EXACT, move);
        return -10000;
      }

      let evalScore: number;

      // ── Futility Pruning (minimizing) ──
      const isQuietMoveMin = !move.capture && !move.promotion && !move.push;
      if (isQuietMoveMin && depth <= 2 && moveCount > 1) {
        const FUTILITY_MARGIN = depth === 1 ? 1.5 : 2.5;
        const staticEval = evaluate(board, gameState);
        if (staticEval - FUTILITY_MARGIN >= beta) {
          tracker.pop();
          continue;
        }
      }

      // ── DANCER special: bonus quiet moves after giving check ──
      if (effects.includes('DANCER_CHECK') && depth > 1) {
        const bonusMoves = getAllMovesForColor(nb, color, ngs).filter(m => !m.capture && !m.rocket);
        if (bonusMoves.length > 0) {
          const orderedBonus = orderMoves(bonusMoves, nb, null, ply + 1);
          let bonusBest = Infinity;
          for (let bi = 0; bi < Math.min(2, orderedBonus.length); bi++) {
            tracker.push(ngs);
            const { board: nb2, gameState: ngs2 } = applyMove(nb, orderedBonus[bi], ngs, tracker);
            const bs = minimax(nb2, depth - 1, alpha, beta, true, ngs2, tracker, stats, ply + 1);
            tracker.pop();
            if (bs < bonusBest) bonusBest = bs;
          }
          evalScore = bonusBest;
        } else {
          evalScore = minimax(nb, depth - 1, alpha, beta, true, ngs, tracker, stats, ply + 1);
        }
      }
      else if (moveCount === 1) {
        evalScore = minimax(nb, depth - 1, alpha, beta, true, ngs, tracker, stats, ply + 1);
      } else {
        let lmrDepth = depth - 1;
        const isQuiet = !move.capture && !move.promotion && !move.push;
        if (isQuiet && depth >= 3 && moveCount >= 4) {
          const reduction = Math.floor(Math.sqrt(depth - 1) * Math.sqrt(moveCount - 1) * 0.75);
          lmrDepth = Math.max(1, depth - 1 - reduction);
        }

        evalScore = minimax(nb, lmrDepth, beta - 1, beta, true, ngs, tracker, stats, ply + 1);

        if (evalScore < beta && lmrDepth < depth - 1) {
          evalScore = minimax(nb, depth - 1, alpha, beta, true, ngs, tracker, stats, ply + 1);
        } else if (evalScore < beta && evalScore > alpha) {
          evalScore = minimax(nb, depth - 1, alpha, beta, true, ngs, tracker, stats, ply + 1);
        }
      }
      tracker.pop();

      if (evalScore < minEval) { minEval = evalScore; bestMoveInNode = move; }
      if (evalScore < beta) beta = evalScore;
      if (beta <= alpha) {
        storeKiller(ply, move);
        updateHistory(move, depth);
        break;
      }
    }

    const flag = minEval >= beta ? TT_LOWER_BOUND : (minEval <= alpha ? TT_UPPER_BOUND : TT_EXACT);
    ttStore(hashLow, hashHigh, depth, minEval, flag, bestMoveInNode);
    return minEval;
  }
}

// ── Iterative Deepening with Aspiration Windows ──────────────────────────
export function findBestMove(
  board: Board,
  color: 'w' | 'b',
  depth: number,
  gameState: GameState,
  tracker: AbilityTracker,
  timeLimitMs?: number,
  multiPvCount?: number
): SearchResult {
  const isWhite = color === 'w';

  // ── OPENING BOOK INJECTION REMOVED (moved to root moves filter) ──

  const stats = { nodes: 0, ttHits: 0, startTime: performance.now(), timeLimitMs, abort: false };
  const maximizing = color === 'w';

  // We intentionally do NOT clear the TT table between searches now!
  for (let i = 0; i < killerMoves.length; i++) killerMoves[i] = [null, null];
  historyTable.fill(0);

  let finalMultiPv: { move: Move; score: number; effects: string[] }[] = [];
  let overallDepth = 0;

  const targetPvCount = multiPvCount || 1;
  const maxSearchDepth = timeLimitMs ? 100 : Math.max(1, depth);

  // ── Iterative Deepening Loop ──
  for (let d = 1; d <= maxSearchDepth; d++) {
    // Check time budget BEFORE starting next depth (clean boundary)
    if (stats.timeLimitMs && performance.now() - stats.startTime >= stats.timeLimitMs) {
      break;
    }
    stats.abort = false; // Reset abort flag for this depth so minimax can run

    const currentDepthPv: { move: Move; score: number; effects: string[] }[] = [];
    const excludedMoves: Move[] = [];

    // ── Multi-PV Loop ──
    for (let pv = 0; pv < targetPvCount; pv++) {
      if (stats.abort) break;

      let moves = getAllMovesForColor(board, color, gameState);

      // ── AI OPENING BOOK INTEGRATION ──
      const bookCandidates = getOpeningBookMoves(board, gameState, isWhite);
      if (bookCandidates && bookCandidates.length > 0) {
        // Evaluate ONLY the standard book candidates, using the AI to pick the best one
        const filtered = moves.filter(m => 
          bookCandidates.some(bm => m.from[0] === bm.from[0] && m.from[1] === bm.from[1] && m.to[0] === bm.to[0] && m.to[1] === bm.to[1])
        );
        if (filtered.length > 0) {
          moves = filtered;
        }
      }

      // Filter out already found PV moves
      const rootMoves = moves.filter(m => !excludedMoves.some(ex => 
        ex.from[0] === m.from[0] && ex.from[1] === m.from[1] &&
        ex.to[0] === m.to[0] && ex.to[1] === m.to[1] &&
        ex.promotion === m.promotion
      ));

      if (rootMoves.length === 0) break;

      const [hashLow, hashHigh] = computeZobristHash(board, maximizing);
      const ttBestInt = ttGetBestMoveInt(hashLow, hashHigh);
      const orderedMoves = orderMoves(rootMoves, board, ttBestInt, 0);

      let iterBest: Move | null = null;
      let iterScore = maximizing ? -Infinity : Infinity;
      let iterEffects: string[] = [];

      // Only use aspiration windows for the principal variation (pv === 0)
      let alpha = -Infinity;
      let beta = Infinity;
      if (pv === 0 && d >= 4 && finalMultiPv[0]) {
        const WINDOW = 0.5;
        alpha = finalMultiPv[0].score - WINDOW;
        beta = finalMultiPv[0].score + WINDOW;
      }

      let aspirationFailed = false;
      do {
        aspirationFailed = false;
        iterBest = null;
        iterScore = maximizing ? -Infinity : Infinity;
        iterEffects = [];

        for (const move of orderedMoves) {
          if (move.rocket) continue;
          tracker.push(gameState);
          const { board: nb, effects, gameState: ngs } = applyMove(board, move, gameState, tracker);

          if (effects.includes('PIXIE_WIN')) {
            tracker.pop();
            iterBest = move;
            iterScore = maximizing ? 10000 : -10000;
            iterEffects = effects;
            break; // Stop evaluating sibling moves, we found a forced win!
          }

          const score = minimax(nb, d - 1, alpha, beta, !maximizing, ngs, tracker, stats, 1);
          tracker.pop();

          if (stats.abort) break; // Break out of move loop immediately

          if (maximizing ? score > iterScore : score < iterScore) {
            iterScore = score;
            iterBest = move;
            iterEffects = effects;
          }
        }

        if (stats.abort) break;

        if (pv === 0 && d >= 4 && iterBest) {
          if (iterScore <= alpha) {
            alpha = Math.max(alpha - 1.0, -Infinity);
            aspirationFailed = true;
          } else if (iterScore >= beta) {
            beta = Math.min(beta + 1.0, Infinity);
            aspirationFailed = true;
          }
        }
      } while (aspirationFailed);

      if (stats.abort) break; // Discard this PV iteration, time ran out

      if (iterBest) {
        currentDepthPv.push({ move: iterBest, score: iterScore, effects: iterEffects });
        excludedMoves.push(iterBest);
        
        // Only store the absolute best move (pv 0) in the TT to avoid trashing it with PV2/PV3 lines
        if (pv === 0) {
          const [rootHL, rootHH] = computeZobristHash(board, maximizing);
          ttStore(rootHL, rootHH, d, iterScore, TT_EXACT, iterBest);
        }
      }
    }

    if (stats.abort) {
      break; // Discard this depth because it was aborted mid-way
    }

    // Successfully completed all requested PVs for depth `d`
    if (currentDepthPv.length > 0) {
      finalMultiPv = currentDepthPv;
      overallDepth = d;
    }
  }

  // Fallback if aborted instantly on ply 1
  if (finalMultiPv.length === 0) {
    const moves = getAllMovesForColor(board, color, gameState);
    if (moves.length > 0) {
      finalMultiPv = [{ move: moves[0], score: 0, effects: [] }];
    }
  }

  const bestLine = finalMultiPv[0];
  
  return {
    move: bestLine ? bestLine.move : null,
    score: bestLine ? bestLine.score : 0,
    nodes: stats.nodes,
    effects: bestLine ? bestLine.effects : [],
    depth: overallDepth,
    ttHits: stats.ttHits,
    multiPv: finalMultiPv
  };
}
