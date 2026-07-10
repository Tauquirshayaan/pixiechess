import { findBestMoveUCI } from './uciEngine';
import { Board, Piece, GameState } from './types';

const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

// Black pieces (row 0 and 1)
const blackBackRank: Piece['type'][] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
for(let i=0; i<8; i++) {
    board[0][i] = { type: blackBackRank[i], color: 'b', id: `b${blackBackRank[i]}${i}` };
    board[1][i] = { type: 'P', color: 'b', id: `bP${i}`, pixie: 'IRONPAWN' };
}

// White pieces (row 6 and 7)
const whiteBackRank: Piece['type'][] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
for(let i=0; i<8; i++) {
    board[6][i] = { type: 'P', color: 'w', id: `wP${i}`, pixie: 'IRONPAWN' };
    board[7][i] = { type: whiteBackRank[i], color: 'w', id: `w${whiteBackRank[i]}${i}` };
}

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

async function run() {
    console.log("Starting Full Board UCI Engine Test...");
    try {
        const { boardToPFEN } = require('./pfen'); console.log('PFEN:', boardToPFEN(board, 'w')); const result = await findBestMoveUCI(board, 'w', 5, gameState, 3000);
        console.log("Engine chose move:", result);
    } catch (err) {
        console.error("Engine failed:", err);
    }
}

run();
