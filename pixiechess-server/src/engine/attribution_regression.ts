import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const fensPath = path.join(__dirname, 'fens.json');
const baselinesPath = path.join(__dirname, 'baseline_evals.json');
const ENGINE_PATH = path.join(__dirname, '..', '..', '..', 'pixie-engine-cpp', 'build', 'pixie-engine-cpp.exe');

if (!fs.existsSync(baselinesPath)) {
    console.error("Baseline not found! Run capture_baselines.ts first.");
    process.exit(1);
}

const fens = JSON.parse(fs.readFileSync(fensPath, 'utf8'));
const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf8'));

// Tolerance for highlighting changes (centipawns)
const TOLERANCE = 5;

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
                const jsonStart = output.indexOf('{');
                const jsonEnd = output.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    const jsonStr = output.substring(jsonStart, jsonEnd + 1);
                    resolve(JSON.parse(jsonStr));
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

function compareEvals(base: any, test: any, positionName: string) {
    if (!base || !test) {
        console.log(`[!] FAILED to evaluate ${positionName}`);
        return;
    }
    
    let hasDeviation = false;
    let report = `\n--- Regression Check: ${positionName} ---\n`;
    
    const buckets = [
        'material', 'mobility', 'center_control', 'development', 
        'threats', 'king_safety', 'power_potential', 'total'
    ];
    
    for (const b of buckets) {
        const diff = test[b] - base[b];
        if (Math.abs(diff) > TOLERANCE) {
            hasDeviation = true;
            report += `[!] ${b.toUpperCase()} SHIFT: Base ${base[b]} -> Test ${test[b]} (Delta: ${diff > 0 ? '+'+diff : diff})\n`;
        }
    }
    
    // Compare power pieces
    const pPieces = ['marauder', 'phaserook', 'electroknight', 'djinn'];
    for (const p of pPieces) {
        const baseV = base.power_pieces[p] || 0;
        const testV = test.power_pieces[p] || 0;
        const diff = testV - baseV;
        if (Math.abs(diff) > TOLERANCE) {
            hasDeviation = true;
            report += `[!] ${p.toUpperCase()} SCORE SHIFT: Base ${baseV} -> Test ${testV} (Delta: ${diff > 0 ? '+'+diff : diff})\n`;
        }
    }
    
    // Compare decomposed Knightmare buckets
    const kmBuckets = ['material', 'limbo_persistence', 'ambush_platform', 'deployment_readiness', 'behind_king_pressure', 'trapped_penalty', 'total'];
    if (base.power_pieces.knightmare && test.power_pieces.knightmare) {
        for (const k of kmBuckets) {
            const baseV = base.power_pieces.knightmare[k] || 0;
            const testV = test.power_pieces.knightmare[k] || 0;
            const diff = testV - baseV;
            if (Math.abs(diff) > TOLERANCE) {
                hasDeviation = true;
                report += `[!] KNIGHTMARE ${k.toUpperCase()} SHIFT: Base ${baseV} -> Test ${testV} (Delta: ${diff > 0 ? '+'+diff : diff})\n`;
            }
        }
    }
    
    if (hasDeviation) {
        console.log(report);
    } else {
        console.log(`[PASS] ${positionName} (No bucket shifted > ${TOLERANCE}cp)`);
    }
}

async function run() {
    console.log(`Starting Evaluation Attribution Regression Suite...`);
    
    for (let i = 0; i < fens.length; i++) {
        const fenObj = fens[i];
        const baseSnapshot = baselines.find((b: any) => b.fen === fenObj.fen);
        
        if (!baseSnapshot) {
            console.log(`[WARNING] No baseline found for position ${i+1}. Skipping.`);
            continue;
        }
        
        const testEval = await evaluateFen(fenObj);
        compareEvals(baseSnapshot.eval, testEval, `Position ${i+1}`);
    }
    
    console.log(`\nRegression Check Complete.`);
}

run();
