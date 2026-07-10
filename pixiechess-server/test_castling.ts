import { pfenToGameState } from './src/engine/pfen';
import { generateLegalMoves } from './src/engine-v2/moveGen';
import { moveToSAN } from './src/engine/utils';

// White King on e1. Black Rook on e8 checking White King.
// White Castling rights: K
const pfen = "4r3/8/8/8/8/8/8/R3K2R w 1 0 -";
const gs = pfenToGameState(pfen);
const moves = generateLegalMoves(gs.board, 'w', gs);
const sanMoves = moves.map(m => moveToSAN(m, gs.board[m.from[0]][m.from[1]], []));
console.log("Legal Moves:", sanMoves);
