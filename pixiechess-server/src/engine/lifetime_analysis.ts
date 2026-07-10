import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ENGINE_TEST = path.resolve(__dirname, '../../../pixie-engine-cpp/build/pixie-engine-cpp.exe'); 
const FENS_FILE = path.resolve(__dirname, 'fens.json');


function mean(arr: number[]) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function median(arr: number[]) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function stdDev(arr: number[]) {
    if (arr.length <= 1) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / (arr.length - 1));
}

class PRNG {
    private seed: number;
    constructor(seed: number) { this.seed = seed; }
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}
function bootstrapPercentile(arr: number[], iterations: number, rng: PRNG) {
    if (arr.length <= 1) return { lower: arr[0] || 0, upper: arr[0] || 0, se: 0 };
    const means = new Float64Array(iterations);
    const n = arr.length;
    for (let i = 0; i < iterations; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
            sum += arr[Math.floor(rng.next() * n)];
        }
        means[i] = sum / n;
    }
    means.sort();
    const se = stdDev(Array.from(means));
    const lower = means[Math.floor(iterations * 0.025)];
    const upper = means[Math.floor(iterations * 0.975)];
    return { lower, upper, se };
}



function cohensD(arr: number[], baselineMean = 0) {
    if (arr.length <= 1) return 0;
    const m = mean(arr);
    const s = stdDev(arr);
    if (s === 0) return 0;
    return (m - baselineMean) / s;
}

interface TrajectoryData {
    minus8Eval: number | null;
    minus4Eval: number | null;
    minus2Eval: number | null;
    activationEval: number;
    plus2Eval: number | null;
    plus4Eval: number | null;
    plus8Eval: number | null;
}

interface SearchStats {
    nodes: number;
    qnodes: number;
    ttHits: number;
    betaCutoffs: number;
    pvChanges: number;
    pvFirstMovePersistencePct: number;
    pvEntropy: number;
}

interface HeuristicLifecycle {
    key: string;
    gameIndex: number;
    color: 'w' | 'b';
    activationPly: number;
    activePlies: number;
    activeScores: number[]; 
    
    trajectory: TrajectoryData;
    gameResult: string;
    bucketKey: string;
    rawPhase: number;
    
    // CF 
    cfDifferenceSigned: number | null;
    cfBestMoveChanged: boolean | null;
    cfPvChanged: boolean | null;
    normalStats: SearchStats | null;
    cfStats: SearchStats | null;
}

let completedLifecycles: HeuristicLifecycle[] = [];
let gamePresences: { key: string, gameIndex: number, winner: string }[] = [];
let gameOpportunities: { key: string, gameIndex: number }[] = [];

const baselineDrifts: Record<string, {
    minus8: number[], minus4: number[], minus2: number[],
    plus2: number[], plus4: number[], plus8: number[]
}> = {};

const EXCLUDED_KEYS = new Set([
    'schemaVersion', 'phase', 'material_imbalance', 'knightmares_in_limbo',
    'alive_knightmare', 'alive_marauder', 'alive_phaserook', 'alive_electroknight', 
    'alive_djinn', 'alive_basilisk', 'material', 'count_in_limbo', 'count_on_board',
    'legal_drop_count', 'safe_drops', 'checking_drop_count', 'capture_drop_count'
]);

const ROOT_CF_TARGETS: Record<string, string> = {
    'power_pieces.knightmare.total': 'knightmare',
    'power_pieces.marauder': 'marauder',
    'power_pieces.phaserook': 'phaserook',
    'power_pieces.electroknight': 'electroknight',
    'power_pieces.djinn': 'djinn',
    'mobility': 'mobility',
    'development': 'development',
    'threats': 'threats',
    'king_safety': 'king_safety',
    'center_control': 'center_control',
    'power_potential': 'power_potential'
};

const cfCache: Record<string, {score: number, bestMove: string, pv: string, stats: SearchStats}> = {};

function extractHeuristics(obj: any, prefix = ''): Record<string, number> {
    let result: Record<string, number> = {};
    for (const key in obj) {
        if (EXCLUDED_KEYS.has(key)) continue;
        if (prefix === '' && key === 'total') continue; 
        
        const val = obj[key];
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        
        if (typeof val === 'number') {
            result[newPrefix] = val;
        } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const nested = extractHeuristics(val, newPrefix);
            result = { ...result, ...nested };
        }
    }
    return result;
}

function getPhaseBucket(phase: number) {
    if (phase >= 16) return '16+';
    if (phase >= 12) return '12-15';
    if (phase >= 8) return '8-11';
    if (phase >= 4) return '4-7';
    return '0-3';
}

function getBucketKey(phase: number, evalScore: number) {
    const p = getPhaseBucket(phase);
    const evalBand = Math.round(evalScore / 50) * 50;
    return `${p}_${evalBand}`;
}

function fenToPFEN(fen: string): string {
    if (fen === 'startpos') {
        return "3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,103,101,102,104,105,102,101,103 w 15 64 - - 0;0";
    }
    const parts = fen.split(' ');
    const boardPart = parts[0];
    const sideToMove = parts[1] || 'w';
    let limboStr = '0;0'; 
    const pfenArray: number[] = Array(64).fill(-1);
    const StandardPieceMap: Record<string, number> = {
        'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
        'p': 100, 'n': 101, 'b': 102, 'r': 103, 'q': 104, 'k': 105
    };
    let sq = 0;
    for (let r = 0; r < 8; r++) {
        const rowStr = parts[0].split('/')[r];
        if (!rowStr) continue;
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

async function playTrackingGame(gameIndex: number, pfen: string, gameResultTracker: { winner: string }, searchDepth: number, engineCommit: string) {
    let moves: string[] = [];
    let turn = 'w';
    let ply = 0;
    
    let currentActive: Map<string, HeuristicLifecycle> = new Map();
    let evalHistory: {score: number, phase: number}[] = [];

    const engine = spawn(ENGINE_TEST);
    engine.stdin.write('uci\n');

    let currentResolve: ((data: {bestMove: string, pv: string, breakdown: any, isMate: boolean, stats: SearchStats}) => void) | null = null;
    let jsonOutput = '';
    let inJson = false;
    let braceCount = 0;
    let isMate = false;
    let lineBuffer = '';
    let latestBestMove = '';
    let latestPv = '';
    let latestStats: SearchStats = { nodes: 0, qnodes: 0, ttHits: 0, betaCutoffs: 0, pvChanges: 0, pvFirstMovePersistencePct: 0, pvEntropy: 0 };
    let pvHistory: Record<number, string> = {};

    engine.stdout.on('data', (data) => {
        lineBuffer += data.toString();
        let lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        
        for (let line of lines) {
            line = line.trim();
            
            if (line === '{') {
                inJson = true;
                braceCount = 0;
                jsonOutput = '';
            }
            
            if (inJson) {
                jsonOutput += line + '\n';
                if (line.includes('{')) braceCount += (line.match(/\{/g) || []).length;
                if (line.includes('}')) braceCount -= (line.match(/\}/g) || []).length;
                
                if (braceCount === 0) {
                    inJson = false;
                }
            }
            
            if (line.includes('score mate')) isMate = true;
            
            if (line.startsWith('info') && line.includes(' pv ')) {
                const depthMatch = line.match(/depth (\d+)/);
                if (depthMatch) {
                    const depth = parseInt(depthMatch[1]);
                    latestPv = line.split(' pv ')[1];
                    pvHistory[depth] = latestPv;
                }
            }
            if (line.startsWith('info string STATS')) {
                const parts = line.split(' ');
                const nIdx = parts.indexOf('nodes');
                if (nIdx !== -1) latestStats.nodes = parseInt(parts[nIdx+1]) || 0;
                const qIdx = parts.indexOf('qnodes');
                if (qIdx !== -1) latestStats.qnodes = parseInt(parts[qIdx+1]) || 0;
                const tIdx = parts.indexOf('tt_hits');
                if (tIdx !== -1) latestStats.ttHits = parseInt(parts[tIdx+1]) || 0;
                const bIdx = parts.indexOf('beta_cutoffs');
                if (bIdx !== -1) latestStats.betaCutoffs = parseInt(parts[bIdx+1]) || 0;
                const pvIdx = parts.indexOf('pv_changes');
                if (pvIdx !== -1) latestStats.pvChanges = parseInt(parts[pvIdx+1]) || 0;
            }
            
            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                if (parts.length > 1) latestBestMove = parts[1];
                
                let breakdown = {};
                try {
                    if (jsonOutput) breakdown = JSON.parse(jsonOutput);
                } catch(e) {}
                
                const sortedDepths = Object.keys(pvHistory).map(Number).sort((a,b) => a-b);
                let identicalTransitions = 0;
                let validTransitions = 0;
                const uniqueRoots = new Set<string>();
                
                for (let i = 0; i < sortedDepths.length; i++) {
                    const currMove = pvHistory[sortedDepths[i]].split(' ')[0];
                    if (currMove) uniqueRoots.add(currMove);
                    
                    if (i > 0) {
                        const prevMove = pvHistory[sortedDepths[i-1]].split(' ')[0];
                        if (prevMove && currMove) {
                            validTransitions++;
                            if (prevMove === currMove) identicalTransitions++;
                        }
                    }
                }
                latestStats.pvFirstMovePersistencePct = validTransitions > 0 ? (identicalTransitions / validTransitions) * 100 : 100;
                latestStats.pvEntropy = uniqueRoots.size;
                
                if (currentResolve) {
                    currentResolve({ bestMove: latestBestMove, pv: latestPv, breakdown, isMate, stats: latestStats });
                    currentResolve = null;
                }
            }
        }
    });

    const getMove = async (m: string[], depth: number): Promise<{bestMove: string, pv: string, breakdown: any, isMate: boolean, stats: SearchStats}> => {
        return new Promise((resolve) => {
            currentResolve = resolve;
            jsonOutput = '';
            latestBestMove = '';
            latestPv = '';
            latestStats = { nodes: 0, qnodes: 0, ttHits: 0, betaCutoffs: 0, pvChanges: 0, pvFirstMovePersistencePct: 0, pvEntropy: 0 };
            pvHistory = {};
            isMate = false;
            
            let positionCmd = `position pfen ${pfen}`;
            if (m.length > 0) {
                positionCmd += ` moves ${m.join(' ')}`;
            }
            engine.stdin.write(positionCmd + '\n');
            engine.stdin.write('eval json\n');
            engine.stdin.write(`go depth ${depth}\n`);
        });
    };

    const getCounterfactualEval = async (m: string[], target: string, depth: number) => {
        const cacheKey = `${engineCommit}|1.0.0|${pfen}|${m.join(' ')}|${target}|${depth}`;
        if (cfCache[cacheKey] !== undefined) return cfCache[cacheKey];

        engine.stdin.write(`setoption name AnalysisMode value Counterfactual\n`);
        engine.stdin.write(`setoption name CounterfactualTarget value ${target}\n`);
        
        const { breakdown, bestMove, pv, stats } = await getMove(m, depth);
        
        engine.stdin.write(`setoption name AnalysisMode value Normal\n`);
        engine.stdin.write(`setoption name CounterfactualTarget value None\n`);
        
        const cfScore = breakdown.total || 0;
        const result = { score: cfScore, bestMove, pv, stats };
        cfCache[cacheKey] = result;
        return result;
    };

    while (ply < 80) {
        const { bestMove, pv, breakdown, isMate: mateFound, stats } = await getMove(moves, searchDepth);
        
        if (!bestMove || bestMove === '(none)') {
            gameResultTracker.winner = turn === 'w' ? 'b' : 'w';
            break;
        }
        if (mateFound) gameResultTracker.winner = turn === 'w' ? 'w' : 'b';
        
        const currentTotalEval = breakdown.total || 0;
        const currentPhase = breakdown.phase || 0;
        evalHistory[ply] = {score: currentTotalEval, phase: currentPhase};

        for (let offset of [-8, -4, -2]) {
            const pastPly = ply + offset;
            if (pastPly >= 0 && evalHistory[pastPly]) {
                const pastEval = evalHistory[pastPly];
                const bk = getBucketKey(pastEval.phase, pastEval.score);
                if (!baselineDrifts[bk]) baselineDrifts[bk] = { minus8: [], minus4: [], minus2: [], plus2: [], plus4: [], plus8: [] };
                
                if (offset === -8) baselineDrifts[bk].plus8.push(currentTotalEval - pastEval.score);
                if (offset === -4) baselineDrifts[bk].plus4.push(currentTotalEval - pastEval.score);
                if (offset === -2) baselineDrifts[bk].plus2.push(currentTotalEval - pastEval.score);
                
                const currBk = getBucketKey(currentPhase, currentTotalEval);
                if (!baselineDrifts[currBk]) baselineDrifts[currBk] = { minus8: [], minus4: [], minus2: [], plus2: [], plus4: [], plus8: [] };
                if (offset === -8) baselineDrifts[currBk].minus8.push(pastEval.score - currentTotalEval);
                if (offset === -4) baselineDrifts[currBk].minus4.push(pastEval.score - currentTotalEval);
                if (offset === -2) baselineDrifts[currBk].minus2.push(pastEval.score - currentTotalEval);
            }
        }

        for (const lc of completedLifecycles) {
            if (lc.gameIndex === gameIndex) {
                if (ply === lc.activationPly + 2) lc.trajectory.plus2Eval = currentTotalEval;
                if (ply === lc.activationPly + 4) lc.trajectory.plus4Eval = currentTotalEval;
                if (ply === lc.activationPly + 8) lc.trajectory.plus8Eval = currentTotalEval;
            }
        }
        for (const lc of currentActive.values()) {
            if (ply === lc.activationPly + 2) lc.trajectory.plus2Eval = currentTotalEval;
            if (ply === lc.activationPly + 4) lc.trajectory.plus4Eval = currentTotalEval;
            if (ply === lc.activationPly + 8) lc.trajectory.plus8Eval = currentTotalEval;
        }

        const heuristics = extractHeuristics(breakdown);
        const fp = breakdown.fingerprint || {};
        
        if (fp.alive_knightmare > 0) {
            if (!gameOpportunities.find(o => o.key.startsWith('power_pieces.knightmare') && o.gameIndex === gameIndex)) {
                ['power_pieces.knightmare.outpost', 'power_pieces.knightmare.ambush_platform', 'power_pieces.knightmare.deployment_readiness', 'power_pieces.knightmare.limbo_persistence', 'power_pieces.knightmare.behind_king_pressure', 'power_pieces.knightmare.trapped_penalty', 'power_pieces.knightmare.total'].forEach(k => {
                    gameOpportunities.push({ key: k, gameIndex });
                });
            }
        }
        
        for (const key in heuristics) {
            const rawScore = heuristics[key];
            if (rawScore === 0) continue;
            
            const color = rawScore > 0 ? 'w' : 'b';
            const absScore = Math.abs(rawScore);
            const trackingKey = `${key}_${color}`;
            
            if (!currentActive.has(trackingKey)) {
                const bk = getBucketKey(currentPhase, currentTotalEval);
                
                let cfDifferenceSigned: number | null = null;
                let cfBestMoveChanged: boolean | null = null;
                let cfPvChanged: boolean | null = null;
                let cfStats: SearchStats | null = null;
                
                if (ROOT_CF_TARGETS[key]) {
                    const alreadyRan = completedLifecycles.some(l => l.key === key && l.gameIndex === gameIndex && l.color === color) ||
                                       gamePresences.some(p => p.key === key && p.gameIndex === gameIndex);
                    if (!alreadyRan) {
                        const cfTarget = ROOT_CF_TARGETS[key];
                        const cfData = await getCounterfactualEval(moves, cfTarget, searchDepth);
                        cfDifferenceSigned = currentTotalEval - cfData.score;
                        cfBestMoveChanged = (cfData.bestMove !== bestMove);
                        cfPvChanged = (cfData.pv !== pv);
                        cfStats = cfData.stats;
                    }
                }
                
                currentActive.set(trackingKey, {
                    key, gameIndex, color,
                    activationPly: ply, activePlies: 1, activeScores: [absScore],
                    bucketKey: bk, rawPhase: currentPhase,
                    cfDifferenceSigned, cfBestMoveChanged, cfPvChanged,
                    normalStats: stats, 
                    cfStats,
                    trajectory: {
                        minus8Eval: ply >= 8 ? evalHistory[ply-8].score : null,
                        minus4Eval: ply >= 4 ? evalHistory[ply-4].score : null,
                        minus2Eval: ply >= 2 ? evalHistory[ply-2].score : null,
                        activationEval: currentTotalEval,
                        plus2Eval: null, plus4Eval: null, plus8Eval: null
                    },
                    gameResult: 'd'
                });
                
                if (!gamePresences.find(p => p.key === key && p.gameIndex === gameIndex)) {
                    gamePresences.push({ key, gameIndex, winner: 'd' });
                }
                if (!gameOpportunities.find(o => o.key === key && o.gameIndex === gameIndex)) {
                    gameOpportunities.push({ key, gameIndex });
                }
            } else {
                const lc = currentActive.get(trackingKey)!;
                lc.activePlies++;
                lc.activeScores.push(absScore);
            }
        }
        
        for (const [trackingKey, lc] of currentActive.entries()) {
            const hKey = lc.key;
            const hScore = heuristics[hKey] || 0;
            const isStillActive = (lc.color === 'w' && hScore > 0) || (lc.color === 'b' && hScore < 0);
            
            if (!isStillActive) {
                completedLifecycles.push(lc);
                currentActive.delete(trackingKey);
            }
        }
        
        moves.push(bestMove);
        turn = turn === 'w' ? 'b' : 'w';
        ply++;
        
        if (mateFound) break;
    }
    
    for (const lc of currentActive.values()) {
        completedLifecycles.push(lc);
    }
    
    engine.stdin.write('quit\n');
    await new Promise(r => engine.on('close', r));
}



const globalStats = {
    maxCfDelta: 0,
    maxOscillation: 0,
};

async function run() {
    const MAX_GAMES = parseInt(process.argv[2] || '5');
    const SEARCH_DEPTH = parseInt(process.argv[3] || '5');
    const CLI_HASH = process.argv[4] || null;
    
    let engine_commit = 'unknown';
    let engine_commit_source = 'fallback';
    
    if (CLI_HASH) {
        engine_commit = CLI_HASH;
        engine_commit_source = 'cli';
    } else {
        try {
            engine_commit = execSync('git rev-parse --short HEAD', { cwd: path.dirname(ENGINE_TEST), encoding: 'utf-8' }).trim();
            engine_commit_source = 'git';
        } catch (e) {
            console.warn('Warning: Could not resolve git commit hash. Using "unknown".');
        }
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); 
    const run_id = `${timestamp}_${engine_commit}`;
    
    const EXP_DIR = path.resolve(__dirname, '../../../../experiments', run_id);
    if (!fs.existsSync(EXP_DIR)) {
        fs.mkdirSync(EXP_DIR, { recursive: true });
    }
    
    const REPORT_PATH = path.join(EXP_DIR, 'heuristic_lifetime_report.md');
    const JSON_REPORT_PATH = path.join(EXP_DIR, 'heuristic_features.json');
    const MANIFEST_PATH = path.join(EXP_DIR, 'manifest.json');
    
    console.log(`Starting Heuristic Lifetime Analysis for ${MAX_GAMES} games at depth ${SEARCH_DEPTH}...`);
    console.log(`Run ID: ${run_id}`);
    console.log(`Output Directory: ${EXP_DIR}`);
    const BOOTSTRAP_SEED = 12345;
    const rng = new PRNG(BOOTSTRAP_SEED);
    
    const positions: {fen: string}[] = JSON.parse(fs.readFileSync(FENS_FILE, 'utf-8'));
    
    for (let i = 0; i < MAX_GAMES; i++) {
        console.log(`Playing Game ${i+1}/${MAX_GAMES}...`);
        const pos = positions[i % positions.length];
        const pfen = fenToPFEN(pos.fen);
        let gameTracker = { winner: 'd' };
        await playTrackingGame(i, pfen, gameTracker, SEARCH_DEPTH, engine_commit);
        
        for (const lc of completedLifecycles) {
            if (lc.gameIndex === i) lc.gameResult = gameTracker.winner;
        }
        for (const gp of gamePresences) {
            if (gp.gameIndex === i) gp.winner = gameTracker.winner;
        }
    }

    console.log('Generating index maps...');
    const lcMap = new Map<string, HeuristicLifecycle[]>();
    const presenceMap = new Map<string, typeof gamePresences>();
    const oppMap = new Map<string, typeof gameOpportunities>();
    
    for (const lc of completedLifecycles) {
        if (!lcMap.has(lc.key)) lcMap.set(lc.key, []);
        lcMap.get(lc.key)!.push(lc);
    }
    for (const gp of gamePresences) {
        if (!presenceMap.has(gp.key)) presenceMap.set(gp.key, []);
        presenceMap.get(gp.key)!.push(gp);
    }
    for (const opp of gameOpportunities) {
        if (!oppMap.has(opp.key)) oppMap.set(opp.key, []);
        oppMap.get(opp.key)!.push(opp);
    }
    
    let md = '# Heuristic Lifetime Analysis (Statistical Refinements)\n\n';
    md += `**Telemetry Schema**: v1.0\n\n`;
    const uniqueKeys = Array.from(lcMap.keys()).sort();
    
    const jsonFeatures: any[] = [];
    
    for (const key of uniqueKeys) {
        const lcs = lcMap.get(key) || [];
        const cfDiffs = lcs.filter(l => l.cfDifferenceSigned !== null).map(l => Math.abs(l.cfDifferenceSigned!));
        if (cfDiffs.length > 0) {
            const avgCf = mean(cfDiffs);
            if (avgCf > globalStats.maxCfDelta) globalStats.maxCfDelta = avgCf;
        }
        const oscillations = lcs.map(l => stdDev(l.activeScores));
        const avgOscillation = oscillations.length > 0 ? mean(oscillations) : 0;
        if (avgOscillation > globalStats.maxOscillation) globalStats.maxOscillation = avgOscillation;
    }
    
    for (const key of uniqueKeys) {
        const lcs = lcMap.get(key) || [];
        if (lcs.length === 0) continue;
        
        let featureObj: any = {
            heuristic_key: key,
            heuristic_family: key.includes('.') ? key.substring(0, key.lastIndexOf('.')) : key,
            heuristic_leaf: key.includes('.') ? key.substring(key.lastIndexOf('.') + 1) : key,
            games_exposed: 0,
            games_activated: 0,
            activations: lcs.length,
            counterfactual_games: 0,
            
            cf: {
                delta_signed: null,
                delta_standard_error: null,
                delta_ci_lower: null,
                delta_ci_upper: null,
                delta_ci_width: null,
                relative_ci_width: null,
                delta_abs: null,
                cohens_d: null
            },
            activation: {
                persistence_pct: null,
                half_life: null,
                activation_rate: null,
                reactivation_rate: null
            },
            search: {
                node_ratio: null,
                node_growth: null,
                node_growth_ci_lower: null,
                node_growth_ci_upper: null,
                qnode_growth: null,
                qnode_growth_ci_lower: null,
                qnode_growth_ci_upper: null,
                beta_growth: null,
                beta_growth_ci_lower: null,
                beta_growth_ci_upper: null,
                pv_persistence_delta: null,
                pv_persistence_delta_ci_lower: null,
                pv_persistence_delta_ci_upper: null,
                pv_entropy_delta: null,
                pv_entropy_delta_ci_lower: null,
                pv_entropy_delta_ci_upper: null,
                root_change_rate: null,
                exposure_root_change_rate: null,
                elasticity: null,
                elasticity_missing_reason: null
            },
            trajectory: {
                minus8: null,
                minus8_ci_lower: null,
                minus8_ci_upper: null,
                minus4: null,
                minus4_ci_lower: null,
                minus4_ci_upper: null,
                minus2: null,
                minus2_ci_lower: null,
                minus2_ci_upper: null,
                plus2: null,
                plus2_ci_lower: null,
                plus2_ci_upper: null,
                plus4: null,
                plus4_ci_lower: null,
                plus4_ci_upper: null,
                plus8: null,
                plus8_ci_lower: null,
                plus8_ci_upper: null
            },
            stability: {
                amplitude: null,
                stddev: null
            },
            metadata: {
                effective_activation_rate: null,
                low_impact_rate: null,
                signal_to_noise: null,
                training_weight: null,
                heuristic_ranking_score: null,
                classification: null
            },
            
            measured_elo: null,
            predicted_elo: null
        };
        
        const parts = key.split('.');
        let headerLevel = '##';
        if (parts.length > 2) headerLevel = '####';
        else if (parts.length > 1) headerLevel = '###';
        md += `${headerLevel} ${key}\n\n`;

        const opps = oppMap.get(key) || [];
        const presences = presenceMap.get(key) || [];
        featureObj.games_exposed = opps.length;
        featureObj.games_activated = presences.length;
        
        md += `**Exposure**\n`;
        md += `- **Exposure**: ${opps.length} games\n`;
        md += `- **Activation**: ${presences.length} games (${lcs.length} total activations)\n\n`;

        const actFreq = opps.length > 0 ? lcs.length / opps.length : 0;
        let totalReactivations = 0;
        const colorGameGroups: Record<string, number> = {};
        for (const l of lcs) {
            const gk = `${l.gameIndex}_${l.color}`;
            if (colorGameGroups[gk]) {
                colorGameGroups[gk]++;
                totalReactivations++;
            } else {
                colorGameGroups[gk] = 1;
            }
        }
        const avgReactivations = totalReactivations / (presences.length || 1);
        featureObj.activation.activation_rate = actFreq;
        featureObj.activation.reactivation_rate = avgReactivations;
        
        md += `**Activation Lifecycle**\n`;
        md += `- **Mean Activations per Eligible Game**: ${actFreq.toFixed(2)} activations\n`;
        md += `- **Reactivation Count**: ${avgReactivations.toFixed(2)} reactivations\n\n`;

        let totalPersistencePercent = 0;
        for (const l of lcs) {
            const remaining = Math.max(1, 80 - l.activationPly);
            totalPersistencePercent += (l.activePlies / remaining);
        }
        const persistencePct = (totalPersistencePercent / lcs.length) * 100;
        const activeDurations = lcs.map(l => l.activePlies);
        const halfLife = median(activeDurations);
        featureObj.activation.persistence_pct = persistencePct;
        featureObj.activation.half_life = halfLife;
        
        md += `**Persistence**\n`;
        md += `- **Persistence %**: ${persistencePct.toFixed(1)}%\n`;
        md += `- **Persistence Half-Life**: ${halfLife.toFixed(1)} plies\n\n`;

        let presenceWins = 0;
        for (const p of presences) {
            const colorActivations = lcs.filter(l => l.gameIndex === p.gameIndex);
            if (colorActivations.some(l => l.color === p.winner)) {
                presenceWins++;
            }
        }
        const gameWinRate = presences.length ? (presenceWins / presences.length) * 100 : 0;
        const actWins = lcs.filter(l => l.color === l.gameResult).length;
        const actWinRateClass = lcs.length ? (actWins / lcs.length) * 100 : 0;
        
        md += `**Conversion**\n`;
        md += `- **Game Presence Win Rate**: ${gameWinRate.toFixed(1)}%\n`;
        md += `- **Activation Win Rate**: ${actWinRateClass.toFixed(1)}%\n\n`;
        
        const validStats = lcs.filter(l => l.normalStats !== null && l.cfStats !== null && l.cfDifferenceSigned !== null);
        const cfBmChanged = lcs.filter(l => l.cfBestMoveChanged !== null);
        const rootChangesCount = cfBmChanged.filter(l => l.cfBestMoveChanged).length;
        const pvChangesCount = cfBmChanged.filter(l => l.cfPvChanged).length;
        
        md += `**Search Influence**\n`;
        if (cfBmChanged.length > 0) {
            const actChangeRate = (rootChangesCount / cfBmChanged.length) * 100;
            const expChangeRate = opps.length > 0 ? (rootChangesCount / opps.length) * 100 : 0;
            featureObj.search.root_change_rate = actChangeRate;
            featureObj.search.exposure_root_change_rate = expChangeRate;
            
            md += `- **Root move changed**: ${rootChangesCount} activations\n`;
            md += `- **PV (non-root) changed**: ${Math.max(0, pvChangesCount - rootChangesCount)} activations\n`;
            md += `- **Root-change given activation**: ${actChangeRate.toFixed(1)}%\n`;
            md += `- **Root-change given exposure**: ${expChangeRate.toFixed(1)}%\n\n`;
        } else {
            md += `- *Search influence tracking requires root-level counterfactuals.*\n\n`;
        }

        let totalNodesN = 0;
        let totalPVChangesN = 0;
        
        if (validStats.length > 0) {
            const gameOverheads = new Map<number, number[]>();
            const gameQOverheads = new Map<number, number[]>();
            const gameBetaOverheads = new Map<number, number[]>();
            const gamePvPersistenceDiffs = new Map<number, number[]>();
            const gamePvEntropyDiffs = new Map<number, number[]>();
            const gameEntAbs = new Map<number, number[]>();
            
            const gamePhaseNodes = {
                '16+': new Map<number, number[]>(),
                '12-15': new Map<number, number[]>(),
                '8-11': new Map<number, number[]>(),
                '4-7': new Map<number, number[]>(),
                '0-3': new Map<number, number[]>()
            };
            
            for (const l of validStats) {
                totalNodesN += l.normalStats!.nodes;
                totalPVChangesN += l.normalStats!.pvChanges;
                
                const cfn = l.cfStats!.nodes || 1;
                const nodeOh = ((l.normalStats!.nodes - cfn) / cfn) * 100;
                if (!gameOverheads.has(l.gameIndex)) gameOverheads.set(l.gameIndex, []);
                gameOverheads.get(l.gameIndex)!.push(nodeOh);
                
                const pBucket = getPhaseBucket(l.rawPhase) as keyof typeof gamePhaseNodes;
                if (!gamePhaseNodes[pBucket].has(l.gameIndex)) gamePhaseNodes[pBucket].set(l.gameIndex, []);
                gamePhaseNodes[pBucket].get(l.gameIndex)!.push(nodeOh);
                
                const cfq = l.cfStats!.qnodes || 1;
                if (!gameQOverheads.has(l.gameIndex)) gameQOverheads.set(l.gameIndex, []);
                gameQOverheads.get(l.gameIndex)!.push(((l.normalStats!.qnodes - cfq) / cfq) * 100);
                
                const cfb = l.cfStats!.betaCutoffs || 1;
                if (!gameBetaOverheads.has(l.gameIndex)) gameBetaOverheads.set(l.gameIndex, []);
                gameBetaOverheads.get(l.gameIndex)!.push(((l.normalStats!.betaCutoffs - cfb) / cfb) * 100);
                
                if (!gamePvPersistenceDiffs.has(l.gameIndex)) gamePvPersistenceDiffs.set(l.gameIndex, []);
                gamePvPersistenceDiffs.get(l.gameIndex)!.push(l.normalStats!.pvFirstMovePersistencePct - l.cfStats!.pvFirstMovePersistencePct);

                if (!gamePvEntropyDiffs.has(l.gameIndex)) gamePvEntropyDiffs.set(l.gameIndex, []);
                gamePvEntropyDiffs.get(l.gameIndex)!.push(l.normalStats!.pvEntropy - l.cfStats!.pvEntropy);
                
                if (!gameEntAbs.has(l.gameIndex)) gameEntAbs.set(l.gameIndex, []);
                gameEntAbs.get(l.gameIndex)!.push(l.normalStats!.pvEntropy);
            }
            
            let mNodeGrowth = 0;
            const writeStatBlock = (title: string, gameMap: Map<number, number[]>, fieldPrefix: string) => {
                const gameAverages = Array.from(gameMap.values()).map(arr => mean(arr));
                if (gameAverages.length === 0) return 0;
                const m = mean(gameAverages);
                const med = median(gameAverages);
                const b = bootstrapPercentile(gameAverages, 1000, rng);
                const sign = m > 0 ? '+' : '';
                md += `**${title}**\n`;
                
                if (title.includes("Growth")) {
                    const mult = (m / 100) + 1;
                    md += `- Mean: ${sign}${m.toFixed(1)}% (${mult.toFixed(2)}x)\n`;
                } else {
                    md += `- Mean: ${sign}${m.toFixed(1)}%\n`;
                }
                md += `- Median: ${sign}${med.toFixed(1)}%\n`;
                md += `- 95% Bootstrap CI: (${b.lower.toFixed(1)}%, ${b.upper.toFixed(1)}%)\n`;
                md += `- n=${gameAverages.length} games\n\n`;
                
                if (title === "Node Growth") {
                    mNodeGrowth = m;
                }
                featureObj.search[fieldPrefix] = m;
                featureObj.search[fieldPrefix + '_ci_lower'] = b.lower;
                featureObj.search[fieldPrefix + '_ci_upper'] = b.upper;
                return m;
            };
            
            writeStatBlock("Node Growth", gameOverheads, "node_growth");
            
            const renderPhase = (key: keyof typeof gamePhaseNodes, label: string) => {
                const m = gamePhaseNodes[key];
                const avgs = Array.from(m.values()).map(arr => mean(arr));
                if (avgs.length === 0) return `- ${label}: N/A\n`;
                return `- ${label}: +${mean(avgs).toFixed(1)}% (n=${avgs.length})\n`;
            };
            
            md += `*Contextual Node Growth*\n`;
            md += renderPhase('16+', 'Opening (16+)');
            md += renderPhase('12-15', 'Late Opening (12-15)');
            md += renderPhase('8-11', 'Middlegame (8-11)');
            md += renderPhase('4-7', 'Transition (4-7)');
            md += renderPhase('0-3', 'Endgame (0-3)');
            md += `\n`;
            
            writeStatBlock("QNode Growth", gameQOverheads, "qnode_growth");
            writeStatBlock("Beta Cutoff Growth", gameBetaOverheads, "beta_growth");

            const mPvDiffAverages = Array.from(gamePvPersistenceDiffs.values()).map(arr => mean(arr));
            const mPvDiff = mean(mPvDiffAverages);
            featureObj.search.pv_persistence_delta = mPvDiff;
            const pvb = bootstrapPercentile(mPvDiffAverages, 1000, rng);
            featureObj.search.pv_persistence_delta_ci_lower = pvb.lower;
            featureObj.search.pv_persistence_delta_ci_upper = pvb.upper;
            md += `**PV Stability Delta**\n`;
            md += `- First-Move Persistence Shift: ${mPvDiff > 0 ? '+' : ''}${mPvDiff.toFixed(1)}% | 95% Boot CI (${pvb.lower.toFixed(1)}%, ${pvb.upper.toFixed(1)}%) | n=${mPvDiffAverages.length} games\n`;
            
            const mEntDiffAverages = Array.from(gamePvEntropyDiffs.values()).map(arr => mean(arr));
            const mEntDiff = mean(mEntDiffAverages);
            const entAbsAverages = Array.from(gameEntAbs.values()).map(arr => mean(arr));
            const entAbs = mean(entAbsAverages);
            featureObj.search.pv_entropy_delta = mEntDiff;
            const entb = bootstrapPercentile(mEntDiffAverages, 1000, rng);
            featureObj.search.pv_entropy_delta_ci_lower = entb.lower;
            featureObj.search.pv_entropy_delta_ci_upper = entb.upper;
            md += `- Average Root Move Diversity: ${entAbs.toFixed(2)} roots per search\n`;
            md += `- Root Diversity Shift vs CF: ${mEntDiff > 0 ? '+' : ''}${mEntDiff.toFixed(2)} | 95% Boot CI (${entb.lower.toFixed(2)}, ${entb.upper.toFixed(2)})\n\n`;
            
            md += `**Search Efficiency**\n`;
            const totalM = totalNodesN / 1_000_000;
            const bmPerM = totalM > 0 ? (rootChangesCount / totalM) : 0;
            const pvPerM = totalM > 0 ? (totalPVChangesN / totalM) : 0;
            md += `- **Best Move Changes / 1M Nodes**: ${bmPerM.toFixed(1)}\n`;
            md += `- **PV Flips / 1M Nodes**: ${pvPerM.toFixed(1)}\n`;
            
            const gameCfDeltas = new Map<number, number[]>();
            for (const l of validStats) {
                if (!gameCfDeltas.has(l.gameIndex)) gameCfDeltas.set(l.gameIndex, []);
                gameCfDeltas.get(l.gameIndex)!.push(l.cfDifferenceSigned!);
            }
            const gameCfAverages = Array.from(gameCfDeltas.values()).map(arr => mean(arr));
            const avgCfDiff = mean(gameCfAverages);
            const cfBootPre = bootstrapPercentile(gameCfAverages, 1000, rng);
            
            const cfExcludesZero = (cfBootPre.lower > 0 || cfBootPre.upper < 0);
            const nodeGrowthExcludesZero = (featureObj.search.node_growth_ci_lower > 0 || featureObj.search.node_growth_ci_upper < 0);
            const nodeRatio = mNodeGrowth !== 0 ? (mNodeGrowth / 100) + 1 : 1;
            featureObj.search.node_ratio = nodeRatio;
            
            if (cfExcludesZero && nodeGrowthExcludesZero) {
                const elasticity = nodeRatio > 1.01 || nodeRatio < 0.99 ? avgCfDiff / Math.log(nodeRatio) : 0;
                featureObj.search.elasticity = elasticity;
                md += `- **Search Elasticity (CP / ln(node_ratio))**: ${elasticity.toFixed(2)} (Interpret cautiously)\n`;
            } else {
                featureObj.search.elasticity_missing_reason = "ci_crosses_zero";
                md += `- **Search Elasticity**: Not Available (CF includes zero or node growth includes zero)\n`;
            }
            md += `\n`;

            const gameEffectiveRates = new Map<number, number>();
            const gameLowImpactRates = new Map<number, number>();
            
            const groupedByGame = new Map<number, HeuristicLifecycle[]>();
            for (const l of validStats) {
                if (!groupedByGame.has(l.gameIndex)) groupedByGame.set(l.gameIndex, []);
                groupedByGame.get(l.gameIndex)!.push(l);
            }
            
            for (const [gIdx, gLcs] of groupedByGame.entries()) {
                const effective = gLcs.filter(l => Math.abs(l.cfDifferenceSigned!) >= 5).length;
                gameEffectiveRates.set(gIdx, (effective / gLcs.length) * 100);
                gameLowImpactRates.set(gIdx, ((gLcs.length - effective) / gLcs.length) * 100);
            }
            
            const effRate = mean(Array.from(gameEffectiveRates.values()));
            const lowRate = mean(Array.from(gameLowImpactRates.values()));
            featureObj.metadata.effective_activation_rate = effRate;
            featureObj.metadata.low_impact_rate = lowRate;
            
            md += `**False Positive Profile**\n`;
            md += `- **Effective Activation Rate (|ΔCF| >= 5 cp)**: ${effRate.toFixed(1)}%\n`;
            md += `- **Low-Impact Activation Rate (|ΔCF| < 5 cp)**: ${lowRate.toFixed(1)}%\n\n`;
        }

        md += `**Estimated Elo Efficiency**\n`;
        md += `- **Status**: Not Available\n`;
        md += `- **Reason**: No statistically validated SPRT result associated with this heuristic.\n\n`;

        md += `**Evaluation Influence**\n`;
        
        let avgCfDiff = 0;
        let cfBootLower = 0;
        let cfBootUpper = 0;
        let cfN = 0;
        
        if (validStats.length > 0) {
            const gameCfDeltas = new Map<number, number[]>();
            for (const l of validStats) {
                if (!gameCfDeltas.has(l.gameIndex)) gameCfDeltas.set(l.gameIndex, []);
                gameCfDeltas.get(l.gameIndex)!.push(l.cfDifferenceSigned!);
            }
            const gameCfAverages = Array.from(gameCfDeltas.values()).map(arr => mean(arr));
            avgCfDiff = mean(gameCfAverages);
            cfN = gameCfAverages.length;
            const cfBoot = bootstrapPercentile(gameCfAverages, 1000, rng);
            cfBootLower = cfBoot.lower;
            cfBootUpper = cfBoot.upper;
            featureObj.counterfactual_games = cfN;
            const cf_se = cfBoot.se;
            featureObj.cf.delta_signed = avgCfDiff;
            featureObj.cf.delta_standard_error = cf_se;
            featureObj.cf.delta_ci_lower = cfBootLower;
            featureObj.cf.delta_ci_upper = cfBootUpper;
            const ciWidth = cfBootUpper - cfBootLower;
            featureObj.cf.delta_ci_width = ciWidth;
            featureObj.cf.relative_ci_width = ciWidth / Math.max(Math.abs(avgCfDiff), 0.001);
            
            const signalToNoise = cf_se > 0 ? Math.abs(avgCfDiff) / cf_se : 0;
            featureObj.metadata.signal_to_noise = signalToNoise;
            featureObj.metadata.training_weight = Math.sqrt(featureObj.games_activated) * Math.min(signalToNoise, 10);
            
            const gameAbs = new Map<number, number[]>();
            for (const l of validStats) {
                if (!gameAbs.has(l.gameIndex)) gameAbs.set(l.gameIndex, []);
                gameAbs.get(l.gameIndex)!.push(Math.abs(l.cfDifferenceSigned!));
            }
            const gameAbsMeans = Array.from(gameAbs.values()).map(arr => mean(arr));
            const avgAbsDiff = mean(gameAbsMeans);
            featureObj.cf.delta_abs = avgAbsDiff;
            
            // Cohen's D game-normalized
            const cohen = cohensD(gameCfAverages, 0);
            featureObj.cf.cohens_d = cohen;
            
            md += `- **Signed Counterfactual Delta**: ${avgCfDiff > 0 ? '+' : ''}${avgCfDiff.toFixed(1)} cp | 95% Bootstrap CI: (${cfBootLower.toFixed(1)}, ${cfBootUpper.toFixed(1)}) | n=${gameCfAverages.length} games\n`;
            md += `- **Mean Absolute Effect**: ${avgAbsDiff.toFixed(1)} cp\n`;
            md += `- **Standardized Effect (Cohen's d)**: ${cohen.toFixed(2)}\n`;
        } else {
            md += `- **Direct Counterfactual Delta**: Not Available\n`;
        }
        
        const amplitudes = lcs.map(l => Math.max(...l.activeScores) - Math.min(...l.activeScores));
        const avgAmplitude = mean(amplitudes);
        const oscillations = lcs.map(l => stdDev(l.activeScores));
        const avgOscillation = mean(oscillations);
        featureObj.stability.amplitude = avgAmplitude;
        featureObj.stability.stddev = avgOscillation;
        md += `- **Stability Amplitude (Max-Min)**: ${avgAmplitude.toFixed(1)} cp\n`;
        md += `- **Stability Oscillation (StdDev)**: ${avgOscillation.toFixed(1)} cp\n\n`;
        
        const getMarginalSigned = (lcsSlice: HeuristicLifecycle[], offsetField: keyof TrajectoryData, baselineArray: keyof typeof baselineDrifts[string], fieldPrefix: string) => {
            const gameMarginals = new Map<number, number[]>();
            
            for (const l of lcsSlice) {
                if (l.trajectory[offsetField] !== null) {
                    const observedSignedDrift = l.trajectory[offsetField]! - l.trajectory.activationEval;
                    const baseline = baselineDrifts[l.bucketKey] ? mean(baselineDrifts[l.bucketKey][baselineArray]) : 0;
                    const normalizedDrift = observedSignedDrift - baseline;
                    
                    if (!gameMarginals.has(l.gameIndex)) gameMarginals.set(l.gameIndex, []);
                    gameMarginals.get(l.gameIndex)!.push(normalizedDrift);
                }
            }
            
            const gameAverages = Array.from(gameMarginals.values()).map(arr => mean(arr));
            const m = gameAverages.length > 0 ? mean(gameAverages) : 0;
            let tb = {lower: m, upper: m, se: 0};
            
            if (gameAverages.length > 0) {
                tb = bootstrapPercentile(gameAverages, 1000, rng);
                const p = fieldPrefix.replace('trajectory_', '');
                featureObj.trajectory[p] = m;
                featureObj.trajectory[p + '_ci_lower'] = tb.lower;
                featureObj.trajectory[p + '_ci_upper'] = tb.upper;
            }
            
            return {
                mean: m, ciLower: tb.lower, ciUpper: tb.upper, n: gameAverages.length
            };
        };

        const m8 = getMarginalSigned(lcs, 'minus8Eval', 'minus8', 'trajectory_minus8');
        const m4 = getMarginalSigned(lcs, 'minus4Eval', 'minus4', 'trajectory_minus4');
        const m2 = getMarginalSigned(lcs, 'minus2Eval', 'minus2', 'trajectory_minus2');
        const p2 = getMarginalSigned(lcs, 'plus2Eval', 'plus2', 'trajectory_plus2');
        const p4 = getMarginalSigned(lcs, 'plus4Eval', 'plus4', 'trajectory_plus4');
        const p8 = getMarginalSigned(lcs, 'plus8Eval', 'plus8', 'trajectory_plus8');
        
        md += `**Signed Marginal Trajectory Drift (vs Matched Baselines)**\n`;
        md += `- **-8 plies**: Mean ${m8.mean > 0 ? '+' : ''}${m8.mean.toFixed(1)} cp | 95% CI (${m8.ciLower.toFixed(1)}, ${m8.ciUpper.toFixed(1)}) | n=${m8.n} games\n`;
        md += `- **-4 plies**: Mean ${m4.mean > 0 ? '+' : ''}${m4.mean.toFixed(1)} cp | 95% CI (${m4.ciLower.toFixed(1)}, ${m4.ciUpper.toFixed(1)}) | n=${m4.n} games\n`;
        md += `- **-2 plies**: Mean ${m2.mean > 0 ? '+' : ''}${m2.mean.toFixed(1)} cp | 95% CI (${m2.ciLower.toFixed(1)}, ${m2.ciUpper.toFixed(1)}) | n=${m2.n} games\n`;
        md += `- ** 0 plies**: (Activation)\n`;
        md += `- **+2 plies**: Mean ${p2.mean > 0 ? '+' : ''}${p2.mean.toFixed(1)} cp | 95% CI (${p2.ciLower.toFixed(1)}, ${p2.ciUpper.toFixed(1)}) | n=${p2.n} games\n`;
        md += `- **+4 plies**: Mean ${p4.mean > 0 ? '+' : ''}${p4.mean.toFixed(1)} cp | 95% CI (${p4.ciLower.toFixed(1)}, ${p4.ciUpper.toFixed(1)}) | n=${p4.n} games\n`;
        md += `- **+8 plies**: Mean ${p8.mean > 0 ? '+' : ''}${p8.mean.toFixed(1)} cp | 95% CI (${p8.ciLower.toFixed(1)}, ${p8.ciUpper.toFixed(1)}) | n=${p8.n} games\n\n`;
        
        const normCf = globalStats.maxCfDelta > 0 ? (Math.abs(avgCfDiff) / globalStats.maxCfDelta) * 100 : 0;
        const persistenceFactor = persistencePct;
        const normStability = globalStats.maxOscillation > 0 ? Math.max(0, 100 - (avgOscillation / globalStats.maxOscillation) * 100) : 100;
        const activationRateVal = opps.length > 0 ? (presences.length / opps.length) * 100 : 0;
        const normConv = (activationRateVal / 100) * actWinRateClass; 
        
        const rankScore = (normCf * 0.40) + (normStability * 0.20) + (persistenceFactor * 0.15) + (Math.min(100, actFreq * 50) * 0.15) + (normConv * 0.10); 
        featureObj.metadata.heuristic_ranking_score = rankScore;
        
        let classification = 'Neutral';
        const cfExcludesZero = cfN > 0 && (cfBootLower > 0 || cfBootUpper < 0);
        
        if (!cfExcludesZero && cfN < 30 && avgCfDiff > 5) classification = 'Promising';
        else if (!cfExcludesZero && cfN < 30) classification = 'Needs More Data';
        else if (!cfExcludesZero && cfN >= 30 && avgCfDiff > 5) classification = 'Promising';
        else if (!cfExcludesZero && cfN >= 30) classification = 'Neutral';
        else if (cfExcludesZero && avgCfDiff > 0) classification = 'Strong Positive';
        else if (cfExcludesZero && avgCfDiff < 0) classification = 'Negative';
        
        featureObj.metadata.classification = classification;
        
        md += `**Heuristic Ranking Score**: ${rankScore.toFixed(1)}\n`;
        md += `**Auto-Classification**: \`${classification}\`\n\n`;
        
        jsonFeatures.push(featureObj);
    }
    
    fs.writeFileSync(REPORT_PATH, md);
    console.log(`Report written to ${REPORT_PATH}`);
    
    const jsonOutput = {
        schema_version: "1.0.0",
        generated_at: new Date().toISOString(),
        games: MAX_GAMES,
        search_depth: SEARCH_DEPTH,
        engine_version: "PixieChess Counterfactual Build",
        features: jsonFeatures
    };
    fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(jsonOutput, null, 2));
    console.log(`JSON Feature vector written to ${JSON_REPORT_PATH}`);
    
    const manifest = {
        run_id,
        timestamp: new Date().toISOString(),
        engine_commit,
        engine_commit_source,
        feature_schema_version: "1.0.0",
        analysis_version: "1.0.0",
        validator_version: "1.0.0",
        search_depth: SEARCH_DEPTH,
        games: MAX_GAMES,
        experiment_type: "heuristic_ablation",
        bootstrap_method: "percentile",
        bootstrap_resamples: 1000,
        bootstrap_seed: BOOTSTRAP_SEED,
        status: "completed"
    };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`Experiment manifest written to ${MANIFEST_PATH}`);
}

run();
