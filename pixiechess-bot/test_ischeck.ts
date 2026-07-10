import { isCheck } from './src/engine/moveGenerator';
import { Board, GameState } from './src/engine/types';

const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

// White King at f7 (r=1, c=5)
board[1][5] = { id: 'wk', type: 'K', color: 'w' };

const gameState: GameState = {
  deadPieces: [],
  castling: { K: false, Q: false, k: false, q: false },
  frozen: [],
  offBoardPieces: [
    {
      id: 'km',
      piece: { id: 'km', type: 'N', color: 'b', pixie: 'KNIGHTMARE' },
      obSq: [-1, 6]
    }
  ]
};

console.log('White in check:', isCheck(board, 'w', gameState));
console.log('Black in check:', isCheck(board, 'b', gameState));
