import { Board, GameState } from './src/engine/types';
import { getLegalMoves } from './src/engine/moveGenerator';

// Set up a board with Black Warp Jumper on d3 and White Pawn on e2
const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

board[5][3] = { type: 'P', color: 'b', pixie: 'WARP_JUMPER', id: 'b1' };
board[6][4] = { type: 'P', color: 'w', id: 'w1' };
board[6][2] = { type: 'P', color: 'w', id: 'w2' };

const gameState: GameState = {
  frozen: [],
  paralyzed: { w: [], b: [] },
  promotionBlock: false,
  doomed: {},
  turn: 2,
  offBoardPieces: [],
  pendingIcicle: [],
  deadPieces: []
};

// getLegalMoves for Warp Jumper
setTimeout(() => {
  const moves = getLegalMoves(board, 5, 3, gameState);
  console.log("Legal Moves:", JSON.stringify(moves));
}, 1000); // Wait for WASM to initialize
