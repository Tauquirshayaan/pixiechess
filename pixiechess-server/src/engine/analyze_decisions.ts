import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ENGINE_PATH = path.resolve(__dirname, '../../../pixie-engine-cpp/build/pixie-engine-cpp.exe');
const FENS_FILE = path.resolve(__dirname, 'fens.json');
const REPORT_PATH = path.resolve(__dirname, '../../../../limbo_heatmap.md');

interface HeatmapData {
    term: string;
    rejections: number;
    totalDelta: number;
    confidences: string[];
}

const ALL_TERMS = ['Material', 'Mobility', 'King Safety', 'Center Control', 'Threats', 'Development', 'Power Potential'];

// Class -> Term -> Data
const classHeatmaps: Record<string, Record<string, HeatmapData>> = {};

function initHeatmap(className: string) {
    if (!classHeatmaps[className]) {
        classHeatmaps[className] = {};
        for (const term of ALL_TERMS) {
            classHeatmaps[className][term] = { term, rejections: 0, totalDelta: 0, confidences: [] };
        }
    }
}

function isKnightmareMove(move: string): boolean {
    return move.includes('limbo') || move.includes('drop') || move.includes('jump');
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

async function analyzePosition(fen: string, classes: string[]): Promise<void> {
    return new Promise((resolve) => {
        const pfen = fenToPFEN(fen);
        const engine = spawn(ENGINE_PATH);
        let capturing = false;
        let bestMove = '';
        let currentAlternative = '';
        let localDeltas: Record<string, number> = {};
        let currentConfidence = '';

        engine.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (let line of lines) {
                line = line.trim();
                if (line.includes('--- DECISION EXPLANATION MODE ---')) capturing = true;
                if (capturing) {
                    if (line.startsWith('info string 1. ')) {
                        bestMove = line.split('1. ')[1].split(' ')[0];
                    }
                    const altMatch = line.match(/info string \d+\. (\S+) \(Score:/);
                    if (altMatch && !line.startsWith('info string 1. ')) {
                        currentAlternative = altMatch[1];
                        localDeltas = {};
                    }
                    if (currentAlternative && line.includes('Delta:')) {
                        const termMatch = line.match(/> (.*) Delta: (-?\d+)/);
                        if (termMatch) {
                            const term = termMatch[1].trim();
                            const val = parseInt(termMatch[2]);
                            const mapTerm = term === 'Center' ? 'Center Control' : term;
                            localDeltas[mapTerm] = val;
                        }
                    }
                    if (currentAlternative && line.includes('Decision Confidence:')) {
                        const confMatch = line.match(/Decision Confidence: (Low|Medium|High)/);
                        if (confMatch) currentConfidence = confMatch[1];
                        if (isKnightmareMove(currentAlternative)) {
                            // End of alternative block for Knightmare
                            if (!isKnightmareMove(bestMove)) {
                                let worstTerm = '';
                                let worstDelta = 0;
                                for (const [t, d] of Object.entries(localDeltas)) {
                                    if (d < worstDelta) { worstDelta = d; worstTerm = t; }
                                }
                                if (worstTerm) {
                                    for (const cls of classes) {
                                        initHeatmap(cls);
                                        if (classHeatmaps[cls][worstTerm]) {
                                            classHeatmaps[cls][worstTerm].rejections += 1;
                                            classHeatmaps[cls][worstTerm].totalDelta += worstDelta;
                                            classHeatmaps[cls][worstTerm].confidences.push(currentConfidence);
                                        }
                                    }
                                }
                            }
                            currentAlternative = '';
                        }
                    }
                }
                if (line.startsWith('bestmove')) engine.stdin.write('quit\n');
            }
        });
        engine.on('close', () => resolve());
        engine.stdin.write('uci\n');
        engine.stdin.write('setoption name MultiPV value 100\n');
        engine.stdin.write(`position pfen ${pfen}\n`);
        engine.stdin.write('go depth 4\n');
    });
}

function getMode(arr: string[]): string {
    if (arr.length === 0) return 'N/A';
    const counts = arr.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {} as Record<string, number>);
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

async function run() {
    let positions: {fen: string, classes: string[]}[] = [];
    if (fs.existsSync(FENS_FILE)) {
        positions = JSON.parse(fs.readFileSync(FENS_FILE, 'utf-8'));
    } else {
        console.error('fens.json not found!');
        return;
    }

    console.log(`Analyzing ${positions.length} positions for Limbo rejections by Class...`);
    
    // Initialize "Global" class just in case
    initHeatmap('Global');

    for (const pos of positions) {
        // Automatically inject Global class
        const classes = [...pos.classes, 'Global'];
        await analyzePosition(pos.fen, classes);
    }

    let md = '# Strategic Decision Validation: Position-Class Influence Report\n\n';
    
    for (const [className, heatmap] of Object.entries(classHeatmaps)) {
        md += `## Class: ${className}\n\n`;
        md += '| Evaluation Term | Times Responsible for Rejecting Knightmare | Average Delta | Avg Decision Confidence |\n';
        md += '|-----------------|--------------------------------------------|---------------|-------------------------|\n';
        
        const sorted = Object.values(heatmap).sort((a, b) => b.rejections - a.rejections);
        for (const row of sorted) {
            const avg = row.rejections > 0 ? (row.totalDelta / row.rejections).toFixed(1) : '0';
            const modeConf = getMode(row.confidences);
            md += `| **${row.term}** | ${row.rejections} | ${avg} cp | ${modeConf} |\n`;
        }
        md += '\n';
    }
    
    fs.writeFileSync(REPORT_PATH, md);
    console.log(`Class Heatmap saved to ${REPORT_PATH}`);
}

run();
