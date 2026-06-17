const { isCheck } = require('./dist/engine/moveGenerator');

const board = Array(8).fill(null).map(() => Array(8).fill(null));
board[0][4] = { type: 'K', color: 'w', pixie: 'ROCKETMAN' }; // White King on e1
const gameState = {
  frozen: [],
  offBoardPieces: [
    { piece: { type: 'N', color: 'b', pixie: 'KNIGHTMARE' }, obSq: [-2, 3] }, // Black Knightmare on (-2, 3), behind e1(0,4)? (-2+2=0, 3+1=4) -> valid L shape!
    { piece: { type: 'N', color: 'w', pixie: 'KNIGHTMARE' }, obSq: [-1, 6] }  
  ]
};

console.log("Is White in check? ", isCheck(board, 'w', gameState));

board[7][4] = { type: 'K', color: 'b', pixie: 'ROCKETMAN' }; // Black King on e8
gameState.offBoardPieces.push({ piece: { type: 'N', color: 'w', pixie: 'KNIGHTMARE' }, obSq: [9, 3] }); // White Knightmare on (9, 3), behind e8(7,4)? (9-2=7, 3+1=4) -> valid L shape!
console.log("Is Black in check? ", isCheck(board, 'b', gameState));
