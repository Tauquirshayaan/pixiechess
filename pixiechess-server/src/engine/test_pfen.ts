
const StandardPieceMap: Record<string, number> = {
    'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
    'p': 100, 'n': 101, 'b': 102, 'r': 103, 'q': 104, 'k': 105,
    'M': 17, 'm': 117
};

function fenToPFEN(fen: string): string {
    const parts = fen.split(' ');
    const boardPart = parts[0];
    const sideToMove = parts[1] || 'w';
    const ranks = boardPart.split('/');
    let limboStr = '-;-';
    if (ranks.length > 8) {
        ranks.pop();
    }
    const pfenArray: number[] = Array(64).fill(-1);
    let sq = 0;
    for (let r = 0; r < 8; r++) {
        const rowStr = ranks[r];
        for (let i = 0; i < rowStr.length; i++) {
            const char = rowStr[i];
            if (/\d/.test(char)) {
                sq += parseInt(char);
            } else {
                const rank = r;
                const file = sq % 8;
                const cppSq = (7 - rank) * 8 + file;
                if (StandardPieceMap[char] !== undefined) {
                    pfenArray[cppSq] = StandardPieceMap[char];
                }
                sq++;
            }
        }
        sq = (r + 1) * 8; 
    }
    return pfenArray.join(',') + ' ' + sideToMove + ' 15 64 - - ' + limboStr;
}
import { spawn } from 'child_process';
const pfen = fenToPFEN('M1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
const p = spawn('..\\\\..\\\\..\\\\pixie-engine-cpp\\\\build\\\\pixie-engine-cpp.exe');
p.stdout.on('data', d => console.log(d.toString()));
p.stdin.write('uci\\nposition pfen ' + pfen + '\\ngo depth 3\\nquit\\n');

