import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const fensPath = path.join(__dirname, 'fens.json');
const outputPath = path.join(__dirname, 'baseline_evals.json');

const fens = JSON.parse(fs.readFileSync(fensPath, 'utf8'));
const baseline_evals: any[] = [];

// Assuming pixie-engine-base.exe is in the build folder
// Wait, pixie-engine-base.exe is currently missing the `eval json` feature because we just added it to pixie-engine-cpp.exe!
// I need to use pixie-engine-cpp.exe to capture the baseline since it's the only one with `eval json`.
// Since we haven't changed heuristics since Experiment 3, the current pixie-engine-cpp.exe IS the new baseline for future tests.
const ENGINE_PATH = path.join(__dirname, '..', '..', '..', 'pixie-engine-cpp', 'build', 'pixie-engine-cpp.exe');

function fenToPFEN(fen: string): string {
    if (fen === 'startpos') {
        return "3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,103,101,102,104,105,102,101,103 w 15 64 - - -;-";
    }
    const parts = fen.split(' ');
    const boardPart = parts[0];
    const sideToMove = parts[1] || 'w';
    const ranks = boardPart.split('/');
    let limboStr = '-;-';
    if (ranks.length > 8) limboStr = '34;-'; 
    const pfenArray: number[] = Array(64).fill(-1);
    const StandardPieceMap: Record<string, number> = {
        'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
        'p': 100, 'n': 101, 'b': 102, 'r': 103, 'q': 104, 'k': 105,
        'M': 17, 'm': 117
    };
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
                if (StandardPieceMap[char] !== undefined) pfenArray[cppSq] = StandardPieceMap[char];
                sq++;
            }
        }
        sq = (r + 1) * 8; 
    }
    return `${pfenArray.join(',')} ${sideToMove} 15 64 - - ${limboStr}`;
}

async function evaluateFen(fenObj: any): Promise<any> {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';
        
        engine.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        engine.on('close', () => {
            try {
                // Find the JSON block
                const jsonStart = output.indexOf('{');
                const jsonEnd = output.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    const jsonStr = output.substring(jsonStart, jsonEnd + 1);
                    const parsed = JSON.parse(jsonStr);
                    resolve(parsed);
                } else {
                    resolve(null);
                }
            } catch(e) {
                resolve(null);
            }
        });
        
        let pfenStr = fenToPFEN(fenObj.fen);
        
        engine.stdin.write(`position pfen ${pfenStr}\n`);
        engine.stdin.write(`eval json\n`);
        engine.stdin.write(`quit\n`);
    });
}

async function run() {
    console.log(`Starting Baseline Capture for ${fens.length} positions...`);
    
    for (let i = 0; i < fens.length; i++) {
        const fenObj = fens[i];
        console.log(`Evaluating position ${i+1}/${fens.length}...`);
        
        const evalJson = await evaluateFen(fenObj);
        
        baseline_evals.push({
            fen: fenObj.fen,
            classes: fenObj.classes,
            eval: evalJson
        });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(baseline_evals, null, 2));
    console.log(`Baseline saved to ${outputPath}`);
}

run();
