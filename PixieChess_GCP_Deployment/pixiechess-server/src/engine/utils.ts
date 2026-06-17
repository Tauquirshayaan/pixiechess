import type { Board, Piece, GameState } from './types';
import { isCheck } from './moveGenerator';

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(piece => piece ? { ...piece, state: piece.state ? { ...piece.state } : undefined } : null));
}

export function chebyshevDist(r1: number, c1: number, r2: number, c2: number): number {
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

export function hasAristocrat(board: Board, color: 'w' | 'b'): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.pixie === 'ARISTOCRAT') {
        return true;
      }
    }
  }
  return false;
}

export function calcBasiliskParalysis(board: Board, ownColor: 'w' | 'b'): [number, number][] {
  const paralyzedSquares: [number, number][] = [];
  const enemyColor = ownColor === 'w' ? 'b' : 'w';

  // Find all enemy Basilisks
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === enemyColor && p.pixie === 'BASILISK') {
        // Basilisk paralysis aura (diagonal lines of sight)
        const directions = [
          [-1, -1], [-1, 1], [1, -1], [1, 1]
        ];

        for (const [dr, dc] of directions) {
          let currR = r + dr;
          let currC = c + dc;
          
          while (inBounds(currR, currC)) {
            const target = board[currR][currC];
            if (target) {
              if (target.color === ownColor) {
                // Own piece is paralyzed by enemy Basilisk
                paralyzedSquares.push([currR, currC]);
              }
              // LOS blocked by any piece
              break;
            }
            currR += dr;
            currC += dc;
          }
        }
      }
    }
  }

  return paralyzedSquares;
}

// ── Mission 3 Helpers ──────────────────────────────────────────────────

export function getBestLightningTarget(toSq: [number, number], board: Board, ownColor: 'w' | 'b'): [number, number] | null {
  const enemyColor = ownColor === 'w' ? 'b' : 'w';
  const adjacencies = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  let bestTarget: [number, number] | null = null;
  let highestDanger = -1;
  
  // We can't import PIECE_CATALOG here due to circular deps or just keep it simple.
  // Actually we can, but let's just pick any enemy piece for now, prioritizing Queens/Kings.
  // For standard chess, King=10, Queen=9, Rook=5, Bishop/Knight=3, Pawn=1
  const dangerMap: Record<string, number> = { 'K': 10, 'Q': 9, 'R': 5, 'B': 3, 'N': 3, 'P': 1 };

  for (const [dr, dc] of adjacencies) {
    const r = toSq[0] + dr;
    const c = toSq[1] + dc;
    if (inBounds(r, c)) {
      const target = board[r][c];
      if (target && target.color === enemyColor && !target.invulnerable) {
        const danger = dangerMap[target.type] || 0;
        if (danger > highestDanger) {
          highestDanger = danger;
          bestTarget = [r, c];
        }
      }
    }
  }

  return bestTarget;
}

export function findMostAdvancedOwnPawn(board: Board, color: 'w' | 'b'): Piece | null {
  let mostAdvancedPawn: Piece | null = null;
  let mostAdvancedRank = color === 'w' ? 7 : 0; // The starting ranks

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'P' && p.color === color && p.pixie !== 'GOLDEN_PAWN') {

        // For white, r=0 is rank 8 (promotion). So lower r is more advanced.
        // For black, r=7 is rank 1 (promotion). So higher r is more advanced.
        if (color === 'w') {
          if (r < mostAdvancedRank) {
            mostAdvancedRank = r;
            mostAdvancedPawn = p;
          }
        } else {
          if (r > mostAdvancedRank) {
            mostAdvancedRank = r;
            mostAdvancedPawn = p;
          }
        }
      }
    }
  }

  return mostAdvancedPawn;
}

export function givesCheck(_toSq: [number, number], board: Board, color: 'w' | 'b', gameState: GameState): boolean {
  // Check if the piece at `toSq` gives check to the enemy king.
  // Since we already have isCheck, we can just call isCheck for the ENEMY color.
  const enemyColor = color === 'w' ? 'b' : 'w';
  return isCheck(board, enemyColor, gameState);
}
