import { Board, GameState, Piece } from './types';
import { evaluate } from './evaluator';
import { StatefulAccumulator } from './nnue/accumulator';

export interface PlacementSuggestion {
  square: [number, number];
  score: number;
}

export function suggestPlacements(
  board: Board,
  gameState: GameState,
  color: 'w' | 'b',
  pieceType: string,
  pixieName?: string
): PlacementSuggestion[] {
  const suggestions: PlacementSuggestion[] = [];
  
  // Create a base accumulator for the current board
  const baseAcc = new StatefulAccumulator();
  baseAcc.refresh(board);

  // We only allow placing on the player's side of the board (ranks 0-3 for black, 4-7 for white)
  const startRow = color === 'b' ? 0 : 4;
  const endRow = color === 'b' ? 3 : 7;

  for (let r = startRow; r <= endRow; r++) {
    for (let c = 0; c < 8; c++) {
      // Must be an empty square
      if (board[r][c] !== null) continue;

      // Cannot place pawns on the absolute back rank (rank 0 or 7)
      if (pieceType === 'P' && (r === 0 || r === 7)) continue;

      // Temporarily place the piece
      const mockPiece: Piece = {
        type: pieceType as any,
        color,
        pixie: pixieName as any,
        id: 'mock_placement',
        state: {} // State is mostly empty on placement anyway
      };
      
      board[r][c] = mockPiece;
      
      // Update accumulator (O(1) update)
      const nextAcc = baseAcc.clone();
      nextAcc.addPiece(mockPiece, r, c);

      // Evaluate the board
      let score = evaluate(board, gameState, nextAcc);

      // If we are evaluating for black, we negate the score so higher is better for black
      if (color === 'b') score = -score;

      suggestions.push({ square: [r, c], score });

      // Revert the board
      board[r][c] = null;
    }
  }

  // Sort descending by score
  suggestions.sort((a, b) => b.score - a.score);

  // Return the top 3 suggestions
  return suggestions.slice(0, 3);
}
