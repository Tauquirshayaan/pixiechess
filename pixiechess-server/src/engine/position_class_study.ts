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
    
    // In standard FEN, there is no Limbo block. We inject one if needed later, but this simple converter just passes -;-
    let limboStr = '-;-'; 
    if (parts.length > 8) {
        limboStr = parts.slice(6).join(' '); // If custom PFEN has extra blocks
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
                // Add Knightmare support for custom FENs
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
            } catch (e) {
                resolve(null);
            }
        });
        
        let pfenStr = fenToPFEN(fenObj.fen);
        // If it's a Power Piece test and requires a Limbo Knightmare, we inject it for testing
        if (fenObj.classes.includes('Knightmare Dominance') || fenObj.classes.includes('Power Pieces')) {
            // Give white 1 knightmare in limbo
            pfenStr = pfenStr.replace('-;-', '14;-');
        }
        
        engine.stdin.write(`position pfen ${pfenStr}\n`);
        engine.stdin.write(`eval json\n`);
        engine.stdin.write(`quit\n`);
    });
}

async function runStudy() {
    console.log("Starting Position-Class Attribution Study...");
    const fensData = JSON.parse(fs.readFileSync('fens.json', 'utf8'));
    
    // Aggregation maps
    const classStats: Record<string, any> = {};
    const totalPositions = fensData.length;
    let processed = 0;
    
    for (const item of fensData) {
        const evalJson = await evaluateFen(item);
        if (!evalJson) {
            console.log(`[!] Failed to evaluate ${item.fen}`);
            continue;
        }
        
        const km = evalJson.power_pieces.knightmare;
        if (!km) continue;
        
        // Add stats to each class this position belongs to
        for (const cls of item.classes) {
            if (!classStats[cls]) {
                classStats[cls] = {
                    count: 0,
                    material: 0,
                    limbo_persistence: 0,
                    ambush_platform: 0,
                    deployment_readiness: 0,
                    behind_king_pressure: 0,
                    trapped_penalty: 0,
                    
                    activation_counts: {
                        limbo_persistence: 0,
                        ambush_platform: 0,
                        deployment_readiness: 0,
                        behind_king_pressure: 0,
                        trapped_penalty: 0
                    }
                };
            }
            
            const stats = classStats[cls];
            stats.count++;
            
            stats.material += Math.abs(km.material);
            stats.limbo_persistence += Math.abs(km.limbo_persistence);
            stats.ambush_platform += Math.abs(km.ambush_platform);
            stats.deployment_readiness += Math.abs(km.deployment_readiness);
            stats.behind_king_pressure += Math.abs(km.behind_king_pressure);
            stats.trapped_penalty += Math.abs(km.trapped_penalty);
            
            if (km.limbo_persistence !== 0) stats.activation_counts.limbo_persistence++;
            if (km.ambush_platform !== 0) stats.activation_counts.ambush_platform++;
            if (km.deployment_readiness !== 0) stats.activation_counts.deployment_readiness++;
            if (km.behind_king_pressure !== 0) stats.activation_counts.behind_king_pressure++;
            if (km.trapped_penalty !== 0) stats.activation_counts.trapped_penalty++;
        }
        processed++;
        process.stdout.write(`Evaluated position ${processed}/${totalPositions}\r`);
    }
    
    console.log("\n\nGenerating Markdown Report...");
    
    let report = `# Phase 14: Position-Class Attribution Study (Knightmare)\n\n`;
    report += `**Total Positions Evaluated**: ${processed}\n\n`;
    
    report += `## Component Averages & Activation Rates\n\n`;
    
    for (const [cls, stats] of Object.entries(classStats)) {
        if ((stats as any).count === 0) continue;
        const count = (stats as any).count;
        
        report += `### ${cls} (n=${count})\n`;
        report += `| Component | Avg Score (Abs) | Activation Rate |\n`;
        report += `|-----------|-----------------|-----------------|\n`;
        
        const c = stats as any;
        report += `| Limbo Persistence | ${(c.limbo_persistence / count).toFixed(1)} cp | ${((c.activation_counts.limbo_persistence / count) * 100).toFixed(0)}% |\n`;
        report += `| Ambush Platform | ${(c.ambush_platform / count).toFixed(1)} cp | ${((c.activation_counts.ambush_platform / count) * 100).toFixed(0)}% |\n`;
        report += `| Deployment Readiness | ${(c.deployment_readiness / count).toFixed(1)} cp | ${((c.activation_counts.deployment_readiness / count) * 100).toFixed(0)}% |\n`;
        report += `| Behind King Pressure | ${(c.behind_king_pressure / count).toFixed(1)} cp | ${((c.activation_counts.behind_king_pressure / count) * 100).toFixed(0)}% |\n`;
        report += `| Trapped Penalty | ${(c.trapped_penalty / count).toFixed(1)} cp | ${((c.activation_counts.trapped_penalty / count) * 100).toFixed(0)}% |\n\n`;
    }
    
    fs.writeFileSync('knightmare_attribution_study.md', report);
    console.log("Study completed. Report saved to knightmare_attribution_study.md.");
}

runStudy().catch(console.error);
