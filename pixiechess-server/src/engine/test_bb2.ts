import { findBestMoveUCI } from './uciEngine';
import { Board, Piece, GameState } from './types';

const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

board[7][7] = { type: 'K', color: 'w', id: 'wK' };
board[0][7] = { type: 'K', color: 'b', id: 'bK' };

// White Bouncer at a4 (4, 0)
board[4][0] = { type: 'B', color: 'w', id: 'wBO', pixie: 'BOUNCER' };
// Black Fission Reactor at g6 (2, 6)
// Bouncer path NW: (4,0) -> (3,-1) BOUNCE -> (3,0)? No, at (4,0) if it goes SE (1,1) -> (5,1), (6,2), (7,3).
// If it goes NE (-1, 1): (3,1), (2,2), (1,3), (0,4) -> BOUNCE off rank 0 -> (1,5), (2,6) !
// Perfect! The Bouncer moving NE from a4 will bounce off e8 and hit g6 (the Fission Reactor)!
board[2][6] = { type: 'Q', color: 'b', id: 'bFR', pixie: 'FISSION_REACTOR' };

const gameState: GameState = {
    frozen: [], paralyzed: { w: [], b: [] }, promotionBlock: false, doomed: {},
    turn: 1, offBoardPieces: [], pendingIcicle: [], deadPieces: [],
    castling: { K: false, Q: false, k: false, q: false }
};

async function run() {
    try {
        const result = await findBestMoveUCI(board, 'w', 5, gameState, 3000);
        console.log("Engine chose move:", result);
    } catch (err) {
        console.error("Engine failed:", err);
    }
    process.exit(0);
}
run();
