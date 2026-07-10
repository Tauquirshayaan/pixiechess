import * as fs from 'fs';
import { spawn } from 'child_process';

const ENGINE_PATH = 'G:/Pixiechessbot/Stable Bot/pixie-engine-cpp/build/pixie-engine-cpp.exe';

const StandardPieceMap: Record<string, number> = {
    'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
    'p': 100, 'n': 101, 'b': 102, 'r': 103, 'q': 104, 'k': 105,
    'M': 17, 'm': 117
};

function fenToPFEN(fen: string): string {
    if (fen === 'startpos') {
        return "3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,103,101,102,104,105,102,101,103 w 15 64 - - -;-";
    }

    const parts = fen.split(' ');
    const boardStr = parts[0];
    const sideToMove = parts[1];
    
    let pfenArray = new Array(64).fill(-1);
    
    let limboStr = '-;-'; 
    if (parts.length > 8) {
        limboStr = parts.slice(6).join(' ');
    }

    const ranks = boardStr.split('/');
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
                
                let pieceVal = -1;
                if (char === 'O') pieceVal = 14;
                if (char === 'o') pieceVal = 114;
                if (StandardPieceMap[char] !== undefined) pieceVal = StandardPieceMap[char];
                
                if (pieceVal !== -1) pfenArray[cppSq] = pieceVal;
                sq++;
            }
        }
        sq = (r + 1) * 8; 
    }
    return `${pfenArray.join(',')} ${sideToMove} 15 64 - - ${limboStr}`;
}

interface ComponentMetric {
    name: string;
    mean: number;
    stdDev: number;
    activeRate: number;
}

interface PieceState {
    [key: string]: any;
}

interface InteractionMetric {
    piece: string;
    synergyScore: number;
}

interface PowerPieceDiagnostics {
    name: string;
    components: ComponentMetric[];
    state: PieceState;
    interactionMetrics: InteractionMetric[];
    activationRate: number;
    contribution: number;
    decisionImpact: number;
    stabilityScore: number;
}

const KnightmareConfig = {
    name: 'knightmare',
    components: ['limbo_persistence', 'ambush_platform', 'deployment_readiness', 'behind_king_pressure', 'trapped_penalty']
};

const Depths = [4, 6];

async function analyzeDepth(pfenStr: string, depth: number, disablePiece: string = "None"): Promise<any> {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';
        
        engine.stdin.write(`position pfen ${pfenStr}\n`);
        if (disablePiece !== "None") {
            engine.stdin.write(`setoption name AnalysisMode value Counterfactual\n`);
            engine.stdin.write(`setoption name CounterfactualTarget value ${disablePiece}\n`);
        }
        engine.stdin.write(`setoption name MultiPV value 2\n`);
        engine.stdin.write(`go depth ${depth}\n`);
        
        engine.stdout.on('data', (data) => {
            const str = data.toString();
            output += str;
            if (output.includes('bestmove')) {
                engine.stdin.write('quit\n');
            }
        });
        
        engine.on('close', () => {
            try {
                let score1 = 0, score2 = 0;
                let pv1 = "", pv2 = "";
                let bestMove = "";
                let stats = {
                    nodes: 0, seldepth: 0, tt_hits: 0, beta_cutoffs: 0,
                    null_move_prunes: 0, qnodes: 0, fail_highs: 0, fail_lows: 0,
                    branching_factor_sum: 0, pv_changes: 0
                };
                
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes('info depth') && line.includes('multipv 1')) {
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        if (scoreMatch) score1 = parseInt(scoreMatch[1]);
                        const pvMatch = line.match(/pv (.+)/);
                        if (pvMatch) pv1 = pvMatch[1];
                    }
                    if (line.includes('info depth') && line.includes('multipv 2')) {
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        if (scoreMatch) score2 = parseInt(scoreMatch[1]);
                        const pvMatch = line.match(/pv (.+)/);
                        if (pvMatch) pv2 = pvMatch[1];
                    }
                    if (line.includes('info string STATS')) {
                        const keys = ['nodes', 'seldepth', 'tt_hits', 'beta_cutoffs', 'null_move_prunes', 'qnodes', 'fail_highs', 'fail_lows', 'branching_factor_sum', 'pv_changes'];
                        for (const k of keys) {
                            const match = line.match(new RegExp(`${k} (\\d+)`));
                            if (match) (stats as any)[k] = parseInt(match[1]);
                        }
                    }
                    if (line.startsWith('bestmove ')) {
                        bestMove = line.split(' ')[1];
                    }
                }
                
                resolve({
                    score: score1,
                    score2,
                    decisionDelta: Math.abs(score1 - score2),
                    bestMove,
                    pv: pv1,
                    stats
                });
            } catch(e) {
                resolve(null);
            }
        });
    });
}

async function getStaticEval(pfenStr: string): Promise<any> {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';
        
        engine.stdin.write(`position pfen ${pfenStr}\n`);
        engine.stdin.write(`eval json\n`);
        
        engine.stdout.on('data', (data) => {
            const str = data.toString();
            output += str;
            if (output.includes('"king_under_attack":') && output.includes('}')) {
                const jsonStart = output.indexOf('{');
                if (jsonStart !== -1) {
                    let openCount = 0, closedCount = 0;
                    for (let i = jsonStart; i < output.length; i++) {
                        if (output[i] === '{') openCount++;
                        if (output[i] === '}') closedCount++;
                    }
                    if (openCount > 0 && openCount === closedCount) {
                        engine.stdin.write('quit\n');
                    }
                }
            }
        });
        
        engine.on('close', () => {
            try {
                const jsonStart = output.indexOf('{');
                const jsonEnd = output.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                    const jsonStr = output.substring(jsonStart, jsonEnd + 1);
                    resolve(JSON.parse(jsonStr));
                } else { resolve(null); }
            } catch (e) { resolve(null); }
        });
    });
}

function calculateMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function calculateStdDev(arr: number[], mean: number): number {
    if (arr.length === 0) return 0;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

function getPercentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    arr.sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
}

function getDecisionStabilityScore(bestMoves: string[], scores: number[]): number {
    let score = 100;
    const uniqueMoves = new Set(bestMoves).size;
    
    // Penalize for move changing
    if (uniqueMoves > 1) {
        score -= (uniqueMoves - 1) * 20;
    }
    
    // Penalize for score variance
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const stdDev = calculateStdDev(scores, mean);
    if (stdDev > 20) score -= 10;
    if (stdDev > 50) score -= 20;
    
    return Math.max(0, score);
}

function getRecommendation(activeRate: number, stdDev: number, decisionImpact: number): string {
    if (activeRate < 5 && decisionImpact < 10) return 'Candidate Review';
    if (stdDev > 40 || decisionImpact > 150) return 'Investigate';
    return 'Keep';
}

function renderHeatmap(val: number, max: number): string {
    if (max === 0) return '░';
    const numBlocks = Math.max(1, Math.floor((Math.abs(val) / max) * 10));
    return '█'.repeat(numBlocks);
}

async function runStudy() {
    console.log("Starting Phase 15 Refined Evaluation Research Platform...");
    const fensData = JSON.parse(fs.readFileSync('fens.json', 'utf8'));
    
    const classStats: Record<string, any> = {};
    const totalPositions = Math.min(12, fensData.length); // Limit for demonstration speed
    let processed = 0;
    
    let globalRegression = {
        material: 0, mobility: 0, center_control: 0, development: 0, threats: 0, king_safety: 0
    };
    let globalFingerprint: Record<string, number> = {};
    let globalSearchStats: Record<string, number> = {};
    
    for (let i = 0; i < totalPositions; i++) {
        const item = fensData[i];
        let pfenStr = fenToPFEN(item.fen);
        if (item.classes.includes('Knightmare Dominance') || item.classes.includes('Power Pieces')) {
            pfenStr = pfenStr.replace('-;-', '14;-');
        }

        const staticEval = await getStaticEval(pfenStr);
        if (!staticEval) continue;
        
        // Aggregate regression fingerprints
        globalRegression.material += staticEval.material;
        globalRegression.mobility += staticEval.mobility;
        globalRegression.center_control += staticEval.center_control;
        globalRegression.development += staticEval.development;
        globalRegression.threats += staticEval.threats;
        globalRegression.king_safety += staticEval.king_safety;
        
        for (const [k, v] of Object.entries(staticEval.fingerprint)) {
            globalFingerprint[k] = (globalFingerprint[k] || 0) + (v as number);
        }
        
        const pieceEval = staticEval.power_pieces[KnightmareConfig.name];
        
        let depthResults = [];
        for (const d of Depths) {
            const res = await analyzeDepth(pfenStr, d);
            if (res) depthResults.push(res);
        }
        
        // Counterfactual Analysis (at depth 6)
        const cfRes = await analyzeDepth(pfenStr, 6, KnightmareConfig.name);
        const cfMobilityRes = await analyzeDepth(pfenStr, 6, "mobility");
        
        const normalRes = depthResults.find(r => Depths.indexOf(6) !== -1);
        let cfDiff = 0, cfMobilityDiff = 0;
        if (cfRes && normalRes) cfDiff = normalRes.score - cfRes.score;
        if (cfMobilityRes && normalRes) cfMobilityDiff = normalRes.score - cfMobilityRes.score;
        
        // Synergy Simulation
        // In real use, we run Eval(Knightmare + Mobility), but since mobility is a base bucket, we use it as baseline
        const synergyScore = normalRes ? (normalRes.score - (cfRes ? cfRes.score : 0) - (cfMobilityRes ? cfMobilityRes.score : 0)) : 0;
        
        for (const cls of item.classes) {
            if (!classStats[cls]) {
                classStats[cls] = {
                    count: 0,
                    components: {},
                    decisionDeltas: [],
                    pvOccurrences: [],
                    searchStats: {},
                    cfDiffs: [],
                    stabilityScores: [],
                    synergies: []
                };
                for (const comp of KnightmareConfig.components) {
                    classStats[cls].components[comp] = [];
                }
            }
            
            const stats = classStats[cls];
            stats.count++;
            
            for (const comp of KnightmareConfig.components) {
                stats.components[comp].push(Math.abs(pieceEval ? pieceEval[comp] : 0));
            }
            
            if (depthResults.length > 0) {
                const bestMoves = depthResults.map(r => r.bestMove);
                const scores = depthResults.map(r => r.score);
                stats.stabilityScores.push(getDecisionStabilityScore(bestMoves, scores));
                
                const maxDepthRes = depthResults[depthResults.length - 1];
                stats.decisionDeltas.push(maxDepthRes.decisionDelta);
                
                // Track PV occurrences
                let firstApp = -1, lastApp = -1, consecutive = 0;
                for (let j = 0; j < depthResults.length; j++) {
                    const isKm = depthResults[j].pv.includes('O@') || depthResults[j].pv.includes('o@');
                    if (isKm) {
                        if (firstApp === -1) firstApp = j;
                        lastApp = j;
                        consecutive++;
                    }
                }
                if (firstApp !== -1) stats.pvOccurrences.push({ firstApp, lastApp, consecutive });
                
                // Aggregate Search Stats
                for (const [k, v] of Object.entries(maxDepthRes.stats)) {
                    stats.searchStats[k] = (stats.searchStats[k] || 0) + (v as number);
                    globalSearchStats[k] = (globalSearchStats[k] || 0) + (v as number);
                }
            }
            
            stats.cfDiffs.push(cfDiff);
            stats.synergies.push(synergyScore);
        }
        processed++;
        process.stdout.write(`\nAnalyzed position ${processed}/${totalPositions}\n`);
    }
    
    console.log("\n\nGenerating Refined Research Report...");
    
    let report = `# Phase 15 Refinement: Evaluation Research Platform\n\n`;
    report += `**Positions Evaluated**: ${processed}\n`;
    report += `**Tested Depths**: ${Depths.join(', ')}\n\n`;
    
    report += `## Global Regression Fingerprint\n\n`;
    report += `### Evaluation Topology\n`;
    report += `| Metric | Aggregate |\n|---|---|\n`;
    for (const [k, v] of Object.entries(globalFingerprint)) report += `| ${k.replace(/_/g, ' ')} | ${(v/processed).toFixed(1)} |\n`;
    for (const [k, v] of Object.entries(globalRegression)) report += `| ${k.replace(/_/g, ' ')} | ${(v/processed).toFixed(1)} cp |\n`;
    
    report += `\n### Search Profiling\n`;
    report += `| Metric | Average |\n|---|---|\n`;
    for (const [k, v] of Object.entries(globalSearchStats)) report += `| ${k.replace(/_/g, ' ')} | ${(v/processed).toFixed(1)} |\n`;
    
    report += `\n---\n\n`;
    
    for (const [cls, stats] of Object.entries(classStats)) {
        if ((stats as any).count === 0) continue;
        const count = (stats as any).count;
        
        report += `## Class: ${cls} (n=${count})\n\n`;
        
        let maxMean = 0;
        const compStats: any = {};
        for (const k of KnightmareConfig.components) {
            const arr = (stats as any).components[k];
            const mean = arr.reduce((a: number, b: number) => a + b, 0) / count;
            if (mean > maxMean) maxMean = mean;
            compStats[k] = {
                mean,
                median: calculateMedian(arr),
                stdDev: calculateStdDev(arr, mean),
                activeRate: (arr.filter((x: number) => x > 0).length / count) * 100
            };
        }
        
        const avgCfDiff = (stats as any).cfDiffs.reduce((a: number, b: number) => a + b, 0) / count;
        
        report += `### Component Diagnostics & Recommendations\n`;
        report += `| Component | Heatmap | Mean | StdDev | Active % | Recommendation |\n`;
        report += `|-----------|---------|------|--------|----------|----------------|\n`;
        for (const k of KnightmareConfig.components) {
            const c = compStats[k];
            const rec = getRecommendation(c.activeRate, c.stdDev, avgCfDiff);
            report += `| ${k.replace(/_/g, ' ')} | \`${renderHeatmap(c.mean, maxMean)}\` | ${c.mean.toFixed(1)} | ${c.stdDev.toFixed(1)} | ${c.activeRate.toFixed(0)}% | ${rec} |\n`;
        }
        
        report += `\n### Counterfactual Confidence Distribution\n`;
        const diffs = (stats as any).cfDiffs;
        const diffMean = diffs.reduce((a: number, b: number) => a + b, 0) / count;
        const diffStd = calculateStdDev(diffs, diffMean);
        report += `- **Target**: Knightmare\n`;
        report += `- **Impact Mean**: ${diffMean.toFixed(1)} cp\n`;
        report += `- **Impact Median**: ${calculateMedian(diffs).toFixed(1)} cp\n`;
        report += `- **Impact 95th %ile**: ${getPercentile(diffs, 95).toFixed(1)} cp\n`;
        report += `- **Impact StdDev**: ${diffStd.toFixed(1)} cp\n\n`;
        
        const synMean = (stats as any).synergies.reduce((a: number, b: number) => a + b, 0) / count;
        report += `### Synergy Matrix (Normalized)\n`;
        report += `- **Knightmare + Mobility Interaction Score**: ${synMean.toFixed(1)} cp\n\n`;
        
        const stabMean = (stats as any).stabilityScores.reduce((a: number, b: number) => a + b, 0) / count;
        report += `### Search Context & Decision Stability\n`;
        report += `- **Stability Score**: ${stabMean.toFixed(0)}/100\n`;
        
        const ss = (stats as any).searchStats;
        report += `- **Average TT Hits**: ${(ss.tt_hits / count).toFixed(0)}\n`;
        report += `- **Average Beta Cutoffs**: ${(ss.beta_cutoffs / count).toFixed(0)}\n`;
        report += `- **Average Fail Highs**: ${(ss.fail_highs / count).toFixed(0)}\n`;
        report += `- **Average Fail Lows**: ${(ss.fail_lows / count).toFixed(0)}\n`;
        report += `- **Average QNodes**: ${(ss.qnodes / count).toFixed(0)}\n\n`;
        
        report += `### Principal Variation Attribution\n`;
        const pvs = (stats as any).pvOccurrences;
        if (pvs.length > 0) {
            const avgFirst = pvs.reduce((a: number, b: any) => a + b.firstApp, 0) / pvs.length;
            const avgCons = pvs.reduce((a: number, b: any) => a + b.consecutive, 0) / pvs.length;
            report += `- **Average First Appearance (Depth Index)**: ${avgFirst.toFixed(1)}\n`;
            report += `- **Average Consecutive Depths in PV**: ${avgCons.toFixed(1)}\n\n`;
        } else {
            report += `- **Appears in PV**: 0%\n\n`;
        }
        
        report += `---\n\n`;
    }
    
    fs.writeFileSync('power_piece_research_report.md', report);
    console.log("Study completed. Report saved to power_piece_research_report.md.");
}

runStudy().catch(console.error);
