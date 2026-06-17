import type { Board, Move, GameState, AbilityState, AbilityTracker } from './types';
import { calcBasiliskParalysis } from './utils';
import { boardToBitboard, generateStandardMoves, generatePixieMoves } from '../engine-v2';
import { applyMove } from './applyMove';
import { boardToPFEN } from './pfen';

// ── WASM Engine (optional, for bot analysis acceleration) ──
let wasmEngine: any = null;
let getLegalMovesWasm: any = null;

export async function initWasmEngine() {
  if (wasmEngine) return;
  try {
    // @ts-ignore
    const createPixieEngine = (await import('./wasm/pixie_engine.js')).default;
    wasmEngine = await createPixieEngine();
    wasmEngine.ccall('init_engine', null, [], []);
    getLegalMovesWasm = wasmEngine.cwrap('get_legal_moves_json', 'string', ['string']);
    console.log("PixieChess WASM Engine initialized successfully!");
  } catch (error) {
    console.warn("WASM Engine not available, using pure TS engine:", error);
  }
}

// Non-blocking init — don't gate the UI on this
initWasmEngine();

class DummyTracker implements AbilityTracker {
  push(_gs: GameState) {}
  pop() { return null; }
  decrementFreezes(gameState: GameState) {
    gameState.frozen = gameState.frozen
      .map(f => ({ ...f, turns_remaining: f.turns_remaining - 1 }))
      .filter(f => f.turns_remaining > 0);
  }
}
const dummyTracker = new DummyTracker();

export function simulateMoveAndCheck(board: Board, move: Move, color: 'w' | 'b', gameState: GameState): boolean {
  const res = applyMove(board, move, gameState, dummyTracker);
  return isCheck(res.board, color, res.gameState);
}

export function isCheck(board: Board, color: 'w' | 'b', gameState: GameState): boolean {
  let kingPos: [number, number] | null = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'K' && p.color === color) { kingPos = [r, c]; break; }
    }
    if (kingPos) break;
  }
  if (!kingPos) return false;
  
  const enemyColor = color === 'w' ? 'b' : 'w';
  const conversion = boardToBitboard(board);
  
  // Dynamically calculate paralysis for the enemy on this board state
  const enemyParalyzed = calcBasiliskParalysis(board, enemyColor);

  const isFrozenOrParalyzed = (r: number, c: number) => {
    if (gameState.frozen.some(f => f.square[0] === r && f.square[1] === c)) return true;
    if (enemyParalyzed.some(sq => sq[0] === r && sq[1] === c)) return true;
    return false;
  };

  const canCapture = (move: Move, isBladeThru = false) => {
    if (!move.capture && !isBladeThru) return false;
    const r = move.from[0];
    const c = move.from[1];
    if (isFrozenOrParalyzed(r, c)) return false;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = board[nr][nc];
        if (p && p.color === color && p.pixie === 'ANTI_VIOLENCE') {
          return false;
        }
      }
    }
    return true;
  };
  
  const bbMoves = generateStandardMoves(conversion.bbState, enemyColor, gameState);
  if (bbMoves.some(m => {
    if (!canCapture(m)) return false;
    if (m.to[0] === kingPos![0] && m.to[1] === kingPos![1]) return true;
    return false;
  })) return true;

  const migratedPixieMoves = generatePixieMoves(conversion.bbState, enemyColor, gameState);
  if (migratedPixieMoves.some(m => {
    if (canCapture(m) && m.to[0] === kingPos![0] && m.to[1] === kingPos![1]) return true;
    // Bladerunner doom-through king detection
    if (m.bladeThru && canCapture(m, true)) {
      if (m.bladeThru.some((sq: [number, number]) => sq[0] === kingPos![0] && sq[1] === kingPos![1])) return true;
    }
    // Shrike capture-through king detection
    if (m.shrikePath && canCapture(m, true)) {
      if (m.shrikePath[0] === kingPos![0] && m.shrikePath[1] === kingPos![1]) return true;
    }
    return false;
  })) return true;

  for (const ob of (gameState.offBoardPieces || [])) {
    if (ob.piece.color === enemyColor && ob.piece.pixie === 'KNIGHTMARE') {
      const [obR, obC] = ob.obSq;
      if (!isFrozenOrParalyzed(obR, obC)) {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          if (obR + dr === kingPos![0] && obC + dc === kingPos![1]) return true;
        }
      }
    }
  }

  return false;
}

export function getAllMovesForColor(board: Board, color: 'w' | 'b', gameState: GameState): Move[] {
  // 1. Calculate dynamic paralysis via Basilisk sweeps
  const freshParalysis = calcBasiliskParalysis(board, color);
  const liveGameState: GameState = {
    ...gameState,
    paralyzed: { ...gameState.paralyzed, [color]: freshParalysis }
  };
  const allMoves: Move[] = [];

  const conversion = boardToBitboard(board);

  // Generate all TS pseudo-legal moves
  let bbMoves = generateStandardMoves(conversion.bbState, color, liveGameState);
  let migratedPixieMoves = generatePixieMoves(conversion.bbState, color, liveGameState);
  const dropMoves: Move[] = [];

  // Knightmare off-board limbo DROP moves (pseudo)
  for (const ob of (liveGameState.offBoardPieces || [])) {
    if (ob.piece.color === color && ob.piece.pixie === 'KNIGHTMARE') {
      const [obR, obC] = ob.obSq;
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const r = obR + dr, c = obC + dc;
        if (r >= -3 && r <= 10 && c >= -3 && c <= 10) {
          if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
            const target = board[r][c];
            if (!target || (target.color !== color && !target.invulnerable && target.type !== 'K')) {
              dropMoves.push({ from: ob.obSq, to: [r, c], capture: !!target, drop: 'KNIGHTMARE' });
            }
          } else {
            let enemyObFound = false;
            let allyObFound = false;
            for (const otherOb of (liveGameState.offBoardPieces || [])) {
              if (otherOb.obSq[0] === r && otherOb.obSq[1] === c) {
                if (otherOb.piece.color !== color) enemyObFound = true;
                else allyObFound = true;
              }
            }
            if (!allyObFound) {
              if (enemyObFound) {
                dropMoves.push({ from: ob.obSq, to: [r, c], capture: true, drop: 'KNIGHTMARE', obJump: true, obCapSq: [r, c] });
              } else {
                dropMoves.push({ from: ob.obSq, to: [r, c], capture: false, drop: 'KNIGHTMARE', obJump: true });
              }
            }
          }
        }
      }
    }
  }

  let useWasmLegality = false;
  if (getLegalMovesWasm) {
    try {
      const pfen = boardToPFEN(board, color, liveGameState);
      const jsonStr = getLegalMovesWasm(pfen);
      const wasmMoves: any[] = JSON.parse(jsonStr);
      
      const allTsMoves = [...bbMoves, ...migratedPixieMoves, ...dropMoves];
      const filteredMoves: Move[] = [];

      for (const tsM of allTsMoves) {
        if (tsM.drop === 'KNIGHTMARE' || tsM.hordeSpawn || tsM.obJump || tsM.epCapSq) {
           filteredMoves.push(tsM);
           continue;
        }

        const isLegal = wasmMoves.some(m => {
          const data = m.moveValue;
          const pr = (data >> 24) & 0x3F;

          if (tsM.promotion) {
            const promoMap: Record<string, number> = { 'Q': 4, 'R': 3, 'B': 2, 'N': 1 };
            if (pr !== promoMap[tsM.promotion]) return false;
          }

          return m.from[0] === tsM.from[0] && m.from[1] === tsM.from[1] &&
                 m.to[0] === tsM.to[0] && m.to[1] === tsM.to[1];
        });

        if (isLegal) {
          filteredMoves.push(tsM);
        } else if (tsM.from[0] === 3 && tsM.from[1] === 6 && tsM.to[0] === 5 && tsM.to[1] === 7) {
          console.log("DEBUG: WASM rejected [3,6]->[5,7] in getAllMovesForColor!");
        }
      }

      bbMoves = [];
      migratedPixieMoves = [];
      dropMoves.length = 0; // clear

      for (const m of filteredMoves) {
        if (m.drop === 'KNIGHTMARE') {
          dropMoves.push(m);
        } else if (m.obJump || m.dissipate || m.duel || m.hordeSpawn) {
          migratedPixieMoves.push(m);
        } else {
          bbMoves.push(m);
        }
      }

      useWasmLegality = true;
    } catch (e) {
      console.error("WASM move generation failed, falling back to TS:", e);
    }
  }

  // ── Dancer Mid-Sequence Locking ──
  let activeDancer: { r: number, c: number } | null = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.pixie === 'DANCER' && (p.state?.bonus_moves ?? 0) > 0 && p.state?.active_flag) {
        activeDancer = { r, c };
      }
    }
  }
  
  if (activeDancer) {
    bbMoves = bbMoves.filter(m => m.from[0] === activeDancer!.r && m.from[1] === activeDancer!.c);
    migratedPixieMoves = migratedPixieMoves.filter(m => m.from[0] === activeDancer!.r && m.from[1] === activeDancer!.c);
  }

  const isFrozenOrParalyzed = (r: number, c: number) => {
    if (liveGameState.frozen.some(f => f.square[0] === r && f.square[1] === c)) return true;
    if (freshParalysis.some(sq => sq[0] === r && sq[1] === c)) return true;
    return false;
  };

  // ── Anti-Violence aura check for V2 moves ──
  const enemyColor = color === 'w' ? 'b' : 'w';
  const filterAntiViolence = (move: Move) => {
    if (!move.capture) return true;
    const r = move.from[0];
    const c = move.from[1];
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = board[nr][nc];
        if (p && p.color === enemyColor && p.pixie === 'ANTI_VIOLENCE') {
          return false;
        }
      }
    }
    return true;
  };

  // ── King Capture Check ──
  const filterKingCapture = (move: Move) => {
    if (move.capture) {
      if (move.to[0] >= 0 && move.to[0] <= 7 && move.to[1] >= 0 && move.to[1] <= 7) {
        const target = board[move.to[0]][move.to[1]];
        if (target && target.type === 'K') return false;
      }
    }
    return true;
  };

  for (let i = 0; i < bbMoves.length; i++) {
    const move = bbMoves[i];
    if (!isFrozenOrParalyzed(move.from[0], move.from[1]) && filterAntiViolence(move) && filterKingCapture(move)) {
      if (useWasmLegality || !simulateMoveAndCheck(board, move, color, liveGameState)) {
        allMoves.push(move);
        if (move.from[0] === 3 && move.from[1] === 6 && move.to[0] === 5 && move.to[1] === 7) {
            console.log("DEBUG: Pushed [3,6]->[5,7] to allMoves from bbMoves!");
        }
      }
    }
  }

  for (let i = 0; i < migratedPixieMoves.length; i++) {
    const move = migratedPixieMoves[i];
    if (!isFrozenOrParalyzed(move.from[0], move.from[1]) && filterAntiViolence(move) && filterKingCapture(move)) {
      if (useWasmLegality || !simulateMoveAndCheck(board, move, color, liveGameState)) {
        allMoves.push(move);
        if (move.from[0] === 3 && move.from[1] === 6 && move.to[0] === 5 && move.to[1] === 7) {
            console.log("DEBUG: Pushed [3,6]->[5,7] to allMoves from migratedPixieMoves!");
        }
      }
    }
  }

  // ── Knightmare off-board limbo DROP moves check ──
  for (const m of dropMoves) {
    if (useWasmLegality) {
      allMoves.push(m);
    } else {
      const nb = board.map(row => row.map(p => p ? { ...p } : null));
      if (m.to[0] >= 0 && m.to[0] <= 7 && m.to[1] >= 0 && m.to[1] <= 7) {
        const ob = liveGameState.offBoardPieces?.find(p => p.obSq[0] === m.from[0] && p.obSq[1] === m.from[1]);
        if (ob) nb[m.to[0]][m.to[1]] = { ...ob.piece };
      }
      if (!isCheck(nb, color, liveGameState)) {
        allMoves.push(m);
      }
    }
  }

  return allMoves;
}

export function getLegalMoves(board: Board, r: number, c: number, gameState: GameState, _abilityState?: AbilityState): Move[] {
  let piece = null;
  if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
    piece = board[r]?.[c];
  } else {
    const ob = gameState.offBoardPieces?.find(p => p.obSq[0] === r && p.obSq[1] === c);
    if (ob) piece = ob.piece;
  }
  if (!piece) return [];
  const allMoves = getAllMovesForColor(board, piece.color, gameState);
  return allMoves.filter(m => m.from[0] === r && m.from[1] === c);
}
