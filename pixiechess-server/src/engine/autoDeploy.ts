import { Board, GameState, Piece } from './types';
import { evaluate } from './evaluator';
import { StatefulAccumulator } from './nnue/accumulator';
import { PIECE_CATALOG } from '../data/pieceCatalog';

const BASE_VALUES: Record<string, number> = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };

export function autoDeploy(board: Board, gameState: GameState, color: 'w' | 'b', loadout: string[]): Board {
  const newBoard = board.map(row => row.map(p => p ? { ...p } : null)) as Board;

  // 1. Gather existing power pieces for this color on the board
  const existingPixies = new Set<string>();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = newBoard[r][c];
      if (p && p.color === color && p.pixie) {
        existingPixies.add(p.pixie);
        // Revert to standard piece
        delete p.pixie;
        p.state = {};
      }
    }
  }

  // Combine loadout with existing pieces, up to 6 max
  const toDeploySet = new Set([...loadout, ...Array.from(existingPixies)]);
  const toDeployList = Array.from(toDeploySet).slice(0, 6);
  if (toDeployList.length === 0) return newBoard;

  // Sort by strategic value (Q > R > B/N > P)
  toDeployList.sort((a, b) => {
    const valA = BASE_VALUES[PIECE_CATALOG[a as keyof typeof PIECE_CATALOG].base] || 0;
    const valB = BASE_VALUES[PIECE_CATALOG[b as keyof typeof PIECE_CATALOG].base] || 0;
    return valB - valA;
  });

  // 2. Identify candidate squares (only standard pieces, no Kings)
  const candidates: [number, number][] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = newBoard[r][c];
      if (p && p.color === color && p.type !== 'K' && !p.pixie) {
        candidates.push([r, c]);
      }
    }
  }

  const baseAcc = new StatefulAccumulator();
  baseAcc.refresh(newBoard);

  const remainingLoadout = [...toDeployList];
  let deployments = 0;

  // Greedy Placement Loop
  while (deployments < 6 && remainingLoadout.length > 0 && candidates.length > 0) {
    let bestScore = color === 'w' ? -Infinity : Infinity;
    let bestMove: { pixieIndex: number, squareIndex: number, powerPiece: Piece } | null = null;

    for (let pIdx = 0; pIdx < remainingLoadout.length; pIdx++) {
      const pixieName = remainingLoadout[pIdx];
      const baseType = PIECE_CATALOG[pixieName as keyof typeof PIECE_CATALOG].base;
      const powerPiece: Piece = {
        type: baseType as any,
        color,
        pixie: pixieName as any,
        id: `auto_${pixieName}_${Date.now()}`,
        state: {}
      };

      // STRICT BASE TYPE MATCHING ONLY
      const typeMatches = candidates.map((sq, idx) => ({ sq, idx })).filter(({ sq }) => newBoard[sq[0]][sq[1]]?.type === baseType);
      
      if (typeMatches.length === 0) continue; // Cannot deploy this piece if no matching standard piece remains

      for (const { sq: [r, c], idx: sIdx } of typeMatches) {
        const oldPiece = newBoard[r][c];

        // Temporarily swap
        newBoard[r][c] = powerPiece;
        const nextAcc = baseAcc.clone();
        if (oldPiece) nextAcc.removePiece(oldPiece, r, c);
        nextAcc.addPiece(powerPiece, r, c);

        const score = evaluate(newBoard, gameState, nextAcc);

        const isBetter = color === 'w' ? score > bestScore : score < bestScore;
        if (isBetter) {
          bestScore = score;
          bestMove = { pixieIndex: pIdx, squareIndex: sIdx, powerPiece };
        }

        // Revert
        newBoard[r][c] = oldPiece;
      }
    }

    if (bestMove) {
      // Commit the absolute best move found in this pass
      const { pixieIndex, squareIndex, powerPiece } = bestMove;
      const [br, bc] = candidates[squareIndex];
      const finalPiece = { ...powerPiece, id: `auto_${powerPiece.pixie}_${br}_${bc}` };

      const oldPiece = newBoard[br][bc];
      newBoard[br][bc] = finalPiece;
      
      if (oldPiece) baseAcc.removePiece(oldPiece, br, bc);
      baseAcc.addPiece(finalPiece, br, bc);

      remainingLoadout.splice(pixieIndex, 1);
      candidates.splice(squareIndex, 1);
      deployments++;
    } else {
      break; // No improvements or valid matches possible
    }
  }

  return newBoard;
}
