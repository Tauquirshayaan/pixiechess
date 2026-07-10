import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ENGINE_PATH = path.resolve(__dirname, '../../../pixie-engine-cpp/build/pixie-engine-cpp.exe');
const FENS_FILE = path.resolve(__dirname, 'fens.json');
const REPORT_PATH = path.resolve(__dirname, '../../../../limbo_stability.md');

const DEPTHS = [8, 10, 12, 14];

interface Trajectory {
    depthScores: Record<number, number>;
    status: 'Stable' | 'Unstable';
    variance: number;
}

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

async function getScoreAtDepth(pfen: string, targetMove: string, depth: number): Promise<number | null> {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let score: number | null = null;
        let bestMoveFound = false;
        
        engine.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (let line of lines) {
                line = line.trim();
                
                // We use MultiPV to ensure the move is evaluated
                if (line.includes(`info depth ${depth}`) && line.includes(targetMove)) {
                    const match = line.match(/score cp (-?\d+)/);
                    if (match) {
                        score = parseInt(match[1]);
                    }
                }
                
                if (line.startsWith('bestmove')) {
                    bestMoveFound = true;
                    engine.stdin.write('quit\n');
                }
            }
        });

        engine.on('close', () => {
            resolve(score);
        });

        engine.stdin.write('uci\n');
        engine.stdin.write('setoption name MultiPV value 10\n'); // Search top 10 moves
        engine.stdin.write(`position pfen ${pfen}\n`);
        engine.stdin.write(`go depth ${depth}\n`);
    });
}

function calculateVariance(scores: number[]): number {
    if (scores.length === 0) return 0;
    const mean = scores.reduce((a, b) => a + b) / scores.length;
    return scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
}

async function run() {
    if (!fs.existsSync(FENS_FILE)) {
        console.error('fens.json not found!');
        return;
    }

    const positions: {fen: string, classes: string[]}[] = JSON.parse(fs.readFileSync(FENS_FILE, 'utf-8'));
    console.log(`Analyzing Decision Stability for ${positions.length} positions...`);

    let md = '# Phase 7: Decision Stability Metric\n\n';
    md += 'Tracking Knightmare evaluation trajectories across varying search depths to detect Horizon Effects.\n\n';
    
    // We will track the stability of the first Knightmare Limbo Jump we found in our heatmap test: a8a8-jump0
    const TARGET_MOVE = 'a8a8-jump0';
    
    for (const pos of positions) {
        if (!pos.fen.includes('M')) continue; // Only test FENs that explicitly have Knightmares for this demo
        
        const pfen = fenToPFEN(pos.fen);
        md += `### Position: \`${pos.fen}\`\n`;
        md += `Target Move: \`${TARGET_MOVE}\`\n\n`;
        md += '| Depth | Score (cp) |\n';
        md += '|-------|------------|\n';
        
        const scores: number[] = [];
        for (const depth of DEPTHS) {
            console.log(`Searching depth ${depth} for ${pos.fen}...`);
            const score = await getScoreAtDepth(pfen, TARGET_MOVE, depth);
            const displayScore = score !== null ? score : 'Pruned / Not in Top 10';
            md += `| ${depth} | ${displayScore} |\n`;
            if (score !== null) scores.push(score);
        }
        
        const variance = calculateVariance(scores);
        const status = variance > 1000 ? 'Unstable (Horizon Effect Detected)' : 'Stable';
        md += `\n**Status**: ${status} (Variance: ${variance.toFixed(1)})\n\n---\n\n`;
    }

    fs.writeFileSync(REPORT_PATH, md);
    console.log(`Stability Report saved to ${REPORT_PATH}`);
}

run();
