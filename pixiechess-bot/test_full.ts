import { Board, GameState } from './src/engine/types';
import { getLegalMoves } from './src/engine/moveGenerator';

// Set up a board with Warp Jumper on e2 and Black Pawn on d3
const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

board[6][4] = { type: 'P', color: 'w', pixie: 'WARP_JUMPER', id: 'w1' };
board[5][3] = { type: 'P', color: 'b', id: 'b1' };

const gameState: GameState = {
  frozen: [],
  paralyzed: { w: [], b: [] },
  promotionBlock: false,
  doomed: {},
  turn: 1,
  offBoardPieces: [],
  pendingIcicle: [],
  deadPieces: []
};

// getLegalMoves for Warp Jumper
setTimeout(() => {
  const moves = getLegalMoves(board, 6, 4, gameState);
  console.log("Legal Moves:", JSON.stringify(moves));
}, 1000); // Wait for WASM to initialize
