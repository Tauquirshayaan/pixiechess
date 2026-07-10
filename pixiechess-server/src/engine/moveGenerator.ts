import type { Board, Move, GameState, AbilityState, AbilityTracker } from './types';
import { calcBasiliskParalysis } from './utils';
import { boardToBitboard, generateStandardMoves, generatePixieMoves } from '../engine-v2';
import { applyMove } from './applyMove';

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
  // forLegalityCheck=true: suppresses War Automaton auto-advances during this probe.
  // A King's legality to capture an enemy piece is evaluated by whether the destination
  // is defended on the CURRENT board — not by War Automaton side-effects triggered by
  // the King's own capture. Without this flag, a War Automaton could slide into a
  // Bouncer's diagonal path and falsely make a defended square appear safe for the King,
  // turning a genuine checkmate into a mistaken "King can escape" assessment.
  const res = applyMove(board, move, gameState, dummyTracker, true);
  const isTargetMove = move.from[0] === 6 && move.from[1] === 0 && move.to[0] === 6 && move.to[1] === 1;

  return isCheck(res.board, color, res.gameState, isTargetMove);
}

export function isCheck(board: Board, color: 'w' | 'b', gameState: GameState, debug?: boolean): boolean {

  let kingPositions: Array<[number, number]> = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'K' && p.color === color) { kingPositions.push([r, c]); }
    }
  }
  if (kingPositions.length === 0) return false;
  
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
  
  const bbMoves = generateStandardMoves(conversion.bbState, enemyColor, gameState, board);
  if (debug) {
    console.log("isCheck debug! color=", color);
    console.log("kingPositions:", kingPositions);
    console.log("bbMoves capturing [3,4]:", bbMoves.filter(m => m.to[0]===3 && m.to[1]===4));
    console.log("bbMoves capturing [3,4] canCapture:", bbMoves.filter(m => m.to[0]===3 && m.to[1]===4).map(m => canCapture(m)));
  }
  if (bbMoves.some(m => {
    if (!canCapture(m)) return false;
    if (kingPositions.some(kp => m.to[0] === kp[0] && m.to[1] === kp[1])) {
      
      if (debug) console.log('bb check by', m);
      return true;
    }
    return false;
  })) return true;

  const migratedPixieMoves = generatePixieMoves(conversion.bbState, enemyColor, gameState);
  if (debug) {
    console.log("migratedPixieMoves capturing [3,4]:", migratedPixieMoves.filter(m => m.to[0]===3 && m.to[1]===4));
  }
  if (migratedPixieMoves.some(m => {
    if (canCapture(m) && kingPositions.some(kp => m.to[0] === kp[0] && m.to[1] === kp[1])) {
      
      if (debug) console.log('pixie check by', m);
      return true;
    }
    // m.bladeThru intentionally omitted: standing in Bladerunner's path is not considered 'Check' until it passes through.
    if (m.shrikePath && canCapture(m, true)) {
      if (kingPositions.some(kp => m.shrikePath![0] === kp[0] && m.shrikePath![1] === kp[1])) {
        if (debug) console.log('shrike check by', m);
        return true;
      }
    }
    return false;
  })) return true;

  for (const ob of (gameState.offBoardPieces || [])) {
    if (ob.piece.color === enemyColor && ob.piece.pixie === 'KNIGHTMARE') {
      const [obR, obC] = ob.obSq;
      if (!isFrozenOrParalyzed(obR, obC)) {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          // TS uses r=0 at top; off-board coords use same space.
          // Drop convention: landR = obR - dr (matches getAllMovesForColor drop logic)
          const landR = obR - dr;
          const landC = obC + dc;
          if (kingPositions.some(kp => landR === kp[0] && landC === kp[1])) return true;
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
  let bbMoves = generateStandardMoves(conversion.bbState, color, liveGameState, board);
  let migratedPixieMoves = generatePixieMoves(conversion.bbState, color, liveGameState);

  let activeDancer: { r: number, c: number } | null = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.pixie === 'DANCER' && (p.state?.bonus_moves ?? 0) > 0) {
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
    if (!isFrozenOrParalyzed(move.from[0], move.from[1]) && filterAntiViolence(move) && filterKingCapture(move) && !simulateMoveAndCheck(board, move, color, liveGameState)) {
      allMoves.push(move);
    }
  }

  for (let i = 0; i < migratedPixieMoves.length; i++) {
    const move = migratedPixieMoves[i];
    if (!isFrozenOrParalyzed(move.from[0], move.from[1]) && filterAntiViolence(move) && filterKingCapture(move) && !simulateMoveAndCheck(board, move, color, liveGameState)) {
      allMoves.push(move);
    }
  }

  for (const f of liveGameState.frozen) {
    const p = board[f.square[0]][f.square[1]];
    if (p && p.color === color) {
      const unfreezeMove: Move = {
        from: [f.square[0], f.square[1]],
        to: [f.square[0], f.square[1]],
        capture: false,
        unfreeze: true
      };
      if (!simulateMoveAndCheck(board, unfreezeMove, color, liveGameState)) {
        allMoves.push(unfreezeMove);
      }
    }
  }

  // ── Knightmare off-board limbo DROP moves ──
  for (const ob of (gameState.offBoardPieces || [])) {
    if (ob.piece.color === color && ob.piece.pixie === 'KNIGHTMARE') {
      const dropMoves: Move[] = [];
      const kmDirs = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
      for (const [dr, dc] of kmDirs) {
        // C++ uses r=0 as bottom, TS uses r=0 as top. dr must be inverted for rows!
        const r = ob.obSq[0] - dr;
        const c = ob.obSq[1] + dc;
        if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
          const target = board[r][c];
          if (!target || (target.color !== color && !target.invulnerable && target.type !== 'K')) {
            dropMoves.push({ from: ob.obSq, to: [r, c], capture: !!target, drop: 'KNIGHTMARE' });
          }
        } else if (r >= -3 && r <= 10 && c >= -3 && c <= 10) {
          const enemyObIdx = gameState.offBoardPieces?.findIndex(
            (o) => o.obSq[0] === r && o.obSq[1] === c && o.piece.color !== color
          ) ?? -1;
          const allyObFound = gameState.offBoardPieces?.some(
            (o) => o.obSq[0] === r && o.obSq[1] === c && o.piece.color === color
          );
          if (!allyObFound) {
            if (enemyObIdx !== -1) {
              dropMoves.push({ from: ob.obSq, to: [r, c], capture: true, obJump: true, obCapSq: [r, c], drop: 'KNIGHTMARE' });
            } else {
              dropMoves.push({ from: ob.obSq, to: [r, c], capture: false, obJump: true, drop: 'KNIGHTMARE' });
            }
          }
        }
      }
      const legal = dropMoves.filter(m => {
        const obR = ob.obSq[0], obC = ob.obSq[1];
        
        // --- LIMBO AURA PROJECTION ---
        let frozenByIcicle = false;
        let inAvAura = false;
        for (let ir = Math.max(0, obR - 1); ir <= Math.min(7, obR + 1); ir++) {
          for (let ic = Math.max(0, obC - 1); ic <= Math.min(7, obC + 1); ic++) {
            const p = board[ir][ic];
            if (p && p.color === enemyColor) {
               if (p.pixie === 'ICICLE') frozenByIcicle = true;
               if (p.pixie === 'ANTI_VIOLENCE') inAvAura = true;
            }
          }
        }
        if (frozenByIcicle) return false;
        if (m.capture && inAvAura) return false;

        const nb = board.map(row => row.map(p => p ? { ...p } : null));
        if (m.to[0] >= 0 && m.to[0] <= 7 && m.to[1] >= 0 && m.to[1] <= 7) {
          nb[m.to[0]][m.to[1]] = { ...ob.piece };
        }
        return !isCheck(nb, color, liveGameState);
      });
      allMoves.push(...legal);
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

