import { pfenToGameState } from './src/engine/pfen';
import { getLegalMoves } from './src/engine/moveGenerator';

const pfenStr = '-1,37,-1,-1,5,-1,-1,3,0,0,0,-1,-1,0,0,0,-1,-1,19,-1,0,-1,-1,-1,-1,-1,-1,0,120,119,-1,-1,-1,2,20,100,-1,100,-1,-1,-1,-1,-1,-1,1,-1,-1,-1,100,100,100,-1,100,-1,100,100,137,-1,-1,105,-1,102,101,103 b 1 64 - 56,0,0,0,0,0,0,0,0,64,0,0,64,0,0|59,0,0,0,0,0,0,0,0,64,0,0,64,0,1|44,0,0,0,0,0,0,0,0,64,0,0,64,0,1|33,0,0,0,0,0,0,0,0,64,0,0,64,0,0|34,0,0,0,0,0,0,0,0,64,0,0,64,0,0|35,0,0,0,0,0,0,0,0,64,0,0,64,0,0|37,0,0,0,0,0,0,0,0,64,0,0,64,0,0|27,0,0,0,0,0,0,0,0,64,0,0,64,0,0|28,0,0,0,0,0,0,0,0,64,0,0,64,0,0|29,0,0,0,0,0,0,0,0,64,0,0,64,0,0|18,0,0,0,0,0,0,0,0,64,0,0,64,0,0|20,0,0,0,0,0,0,0,0,64,0,0,64,0,0 51;163';
const gameState = pfenToGameState(pfenStr);
const moves = getLegalMoves(gameState.board, gameState);

for (let r=0; r<8; r++) {
    let row = '';
    for (let c=0; c<8; c++) {
        const p = gameState.board[r][c];
        if (!p) row += '.  ';
        else {
            const sym = p.pixie ? p.pixie.substring(0,2) : p.type;
            row += (p.color==='w' ? sym.toUpperCase() : sym.toLowerCase()) + ' ';
        }
    }
    console.log(row);
}
console.log('--- Legal Moves ---');
for (const m of moves) {
    if (m.isDrop) console.log('Drop to', m.to);
    else console.log('from', m.from, 'to', m.to, 'piece', gameState.board[m.from[0]][m.from[1]]?.pixie || gameState.board[m.from[0]][m.from[1]]?.type);
}
