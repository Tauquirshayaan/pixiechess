import type { Board, GameState, Move } from './types';

// Generate a simple Move object for the book
function makeBookMove(fromR: number, fromC: number, toR: number, toC: number): Move {
  return {
    from: [fromR, fromC],
    to: [toR, toC],
    capture: false // The search engine only needs from/to/capture to match
  };
}

export function getOpeningBookMoves(board: Board, gameState: GameState, isWhite: boolean): Move[] | null {
  // Only intercept the first 2 moves for each color (Turns 1-4)
  if (gameState.turn > 4) return null;

  // ── TURN 1: White's 1st Move ──
  if (gameState.turn === 1 && isWhite) {
    return [
      makeBookMove(6, 4, 4, 4), // e4 (Aggressive King's Pawn)
      makeBookMove(6, 3, 4, 3), // d4 (Queen's Pawn)
    ];
  }

  // ── TURN 2: Black's 1st Move ──
  if (gameState.turn === 2 && !isWhite) {
    if (board[4][4]?.type === 'P' && board[4][4]?.color === 'w') { // e4
      return [
        makeBookMove(1, 4, 3, 4), // e5 (Open Game - Aggressive Center)
        makeBookMove(1, 2, 3, 2), // c5 (Sicilian Defense)
        makeBookMove(1, 3, 3, 3), // d5 (Scandinavian Defense - Aggressive)
      ];
    }
    if (board[4][3]?.type === 'P' && board[4][3]?.color === 'w') { // d4
      return [
        makeBookMove(1, 3, 3, 3), // d5 (Queen's Pawn Game)
        makeBookMove(1, 2, 3, 2)  // c5 (Old Benoni - Aggressive)
      ];
    }
    if (board[4][2]?.type === 'P' && board[4][2]?.color === 'w') { // c4
      return [
        makeBookMove(1, 4, 3, 4), // e5 (Reversed Sicilian)
        makeBookMove(1, 3, 3, 3)  // d5
      ];
    }
    return [
      makeBookMove(1, 4, 3, 4), // e5
      makeBookMove(1, 3, 3, 3)  // d5
    ];
  }

  // ── TURN 3: White's 2nd Move ──
  if (gameState.turn === 3 && isWhite) {
    // If board has e4 e5
    if (board[4][4]?.type === 'P' && board[4][4]?.color === 'w' && board[3][4]?.type === 'P' && board[3][4]?.color === 'b') {
      return [
        makeBookMove(6, 3, 4, 3), // d4 (Center Game - Highly Aggressive Pawn Break)
        makeBookMove(6, 5, 4, 5)  // f4 (King's Gambit - Legendary Aggressive Pawn Opening)
      ];
    }
    // If board has d4 d5
    if (board[4][3]?.type === 'P' && board[4][3]?.color === 'w' && board[3][3]?.type === 'P' && board[3][3]?.color === 'b') {
      return [
        makeBookMove(6, 2, 4, 2), // c4 (Queen's Gambit - Aggressive Pawn Sacrifice)
        makeBookMove(6, 4, 4, 4)  // e4 (Blackmar-Diemer Gambit)
      ];
    }
    // If board has e4 c5 (Sicilian)
    if (board[4][4]?.type === 'P' && board[4][4]?.color === 'w' && board[3][2]?.type === 'P' && board[3][2]?.color === 'b') {
      return [
        makeBookMove(6, 3, 4, 3), // d4 (Smith-Morra Gambit / Open Sicilian break)
        makeBookMove(6, 2, 5, 2)  // c3 (Alapin Variation - Solid Pawn Center)
      ];
    }
  }

  // ── TURN 4: Black's 2nd Move ──
  if (gameState.turn === 4 && !isWhite) {
    // If Queen's Gambit (d4 d5 c4)
    if (board[4][3]?.type === 'P' && board[3][3]?.type === 'P' && board[4][2]?.type === 'P') {
      return [
        makeBookMove(1, 4, 2, 4), // e6 (QGD)
        makeBookMove(1, 2, 2, 2)  // c6 (Slav)
      ];
    }
    // If King's Gambit (e4 e5 f4)
    if (board[4][4]?.type === 'P' && board[3][4]?.type === 'P' && board[4][5]?.type === 'P') {
      return [
        makeBookMove(3, 4, 4, 5), // exf4 (Accept the Gambit)
        makeBookMove(1, 3, 3, 3)  // d5 (Falkbeer Countergambit - Aggressive Pawn Strike)
      ];
    }
    // If Center Game (e4 e5 d4)
    if (board[4][4]?.type === 'P' && board[3][4]?.type === 'P' && board[4][3]?.type === 'P') {
      return [
        makeBookMove(3, 4, 4, 3) // exd4 (Take the center pawn)
      ];
    }
  }

  return null;
}
