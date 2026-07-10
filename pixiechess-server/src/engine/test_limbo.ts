import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 10 curated FENs representing various Knightmare situations
const FENS = [
    // 1. Knightmare opening: Knightmare should ideally drop into Limbo or advance.
    { desc: 'Opening Position', fen: 'startpos' },
    
    // 2. Knightmare in Limbo ready to drop and fork
    { desc: 'Limbo Ready to Drop', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R/1~X~M w KQkq - 2 3' },
    
    // 3. Enemy Knightmare in Limbo, our King exposed
    { desc: 'Defending against Limbo', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R/~x~m w KQkq - 2 3' },
    
    // 4. Knightmare vs Marauder trade-off
    { desc: 'Knightmare vs Marauder', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2M1P3/5N2/PPPP1PPP/RNBQK1R1/X w KQkq - 2 3' },
    
    // 5. Endgame Knightmare (should utilize Limbo for mobility)
    { desc: 'Endgame Mobility', fen: '8/8/4k3/8/8/4K3/8/8/X w - - 0 1' }
];

const ENGINE_PATH = path.resolve(__dirname, '../../../pixie-engine-cpp/build/pixie-engine-cpp.exe');

async function testPosition(desc: string, fen: string): Promise<string> {
    return new Promise((resolve) => {
        const engine = spawn(ENGINE_PATH);
        let output = '';
        let capturing = false;

        engine.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.includes('--- DECISION EXPLANATION MODE ---')) {
                    capturing = true;
                }
                if (capturing) {
                    output += line + '\n';
                }
                if (line.startsWith('bestmove')) {
                    engine.stdin.write('quit\n');
                }
            }
        });

        engine.on('close', () => {
            resolve(`### ${desc}\n**FEN:** \`${fen}\`\n\`\`\`text\n${output.trim()}\n\`\`\`\n`);
        });

        engine.stdin.write('uci\n');
        engine.stdin.write('setoption name MultiPV value 100\n');
        
        if (fen === 'startpos') {
            engine.stdin.write('position startpos\n');
        } else {
            // PFEN needs to go through applyMove parser ideally, but C++ handles standard FENs + limbo extension.
            engine.stdin.write(`position fen ${fen}\n`);
        }
        
        engine.stdin.write('go depth 4\n');
    });
}

async function runSuite() {
    console.log('Starting Limbo Decision Validation Suite...');
    let report = '# Limbo Decision Validation Report\n\n';
    
    for (const test of FENS) {
        console.log(`Testing: ${test.desc}`);
        const result = await testPosition(test.desc, test.fen);
        report += result + '\n';
    }
    
    const outPath = path.resolve(__dirname, '../../../../limbo_test_results.md');
    fs.writeFileSync(outPath, report);
    console.log(`Report generated at: ${outPath}`);
}

runSuite();
