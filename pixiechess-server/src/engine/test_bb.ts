import { findBestMoveUCI } from './uciEngine';
import { Board, Piece, GameState } from './types';
import { boardToPFEN } from './pfen';

const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

// White King at h1
board[7][7] = { type: 'K', color: 'w', id: 'wK' };
// Black King at h8
board[0][7] = { type: 'K', color: 'b', id: 'bK' };

// White Bladerunner at c3 (5, 2)
board[5][2] = { type: 'B', color: 'w', id: 'wBR', pixie: 'BLADERUNNER' };

// Black Queen at f6 (2, 5) -> Exact diagonal path of Bladerunner!
board[2][5] = { type: 'Q', color: 'b', id: 'bQ' };

// White Bouncer at a4 (4, 0)
board[4][0] = { type: 'B', color: 'w', id: 'wBO', pixie: 'BOUNCER' };

// Black Rook at d7 (1, 3) -> If Bouncer shoots NE to d7? No, (4,0) NE is (3,1), (2,2), (1,3). It directly hits the Rook without bouncing!
board[1][3] = { type: 'R', color: 'b', id: 'bR' };

// Let's place a Black piece where Bouncer HAS to bounce to hit it.
// Bouncer at a4 (4,0). NW goes to (-1, -1) but bounces off a8 (0,0) and a7 (1,0) wall.
// If it goes NE to d7 (1,3) it hits it directly.
// If it goes SE to b1 (7,1), it bounces off b1 (rank 0 in C++) -> heads NE to c2 (6,2), d3 (5,3), e4 (4,4), f5 (3,5), g6 (2,6), h7 (1,7).
// Let's put a Black Fission Reactor at g6 (2,6).
board[2][6] = { type: 'Q', color: 'b', id: 'bFR', pixie: 'FISSION_REACTOR' };

const gameState: GameState = {
    frozen: [], paralyzed: { w: [], b: [] }, promotionBlock: false, doomed: {},
    turn: 1, offBoardPieces: [], pendingIcicle: [], deadPieces: [],
    castling: { K: false, Q: false, k: false, q: false }
};

async function run() {
    console.log("PFEN:", boardToPFEN(board, 'w', gameState));
    console.log("Asking engine for best move for White...");
    try {
        const result = await findBestMoveUCI(board, 'w', 5, gameState, 3000);
        console.log("Engine chose move:", result);
    } catch (err) {
        console.error("Engine failed:", err);
    }
    process.exit(0);
}
run();
