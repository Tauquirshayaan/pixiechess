import { spawn } from 'child_process';
import * as path from 'path';

console.log('--- PIXIECHESS ENGINE FUZZER ---');
console.log('Generating random power piece scenarios...');

// Helper to generate a completely random, valid PFEN
function generateRandomPFEN(): string {
    const board = Array(64).fill(-1);
    
    // Ensure kings exist
    const wKingSq = Math.floor(Math.random() * 32);
    const bKingSq = 32 + Math.floor(Math.random() * 32);
    board[wKingSq] = 5;
    board[bKingSq] = 105;

    // Randomly place 5-15 other pieces per side
    for (let c = 0; c < 2; c++) {
        const numPieces = 5 + Math.floor(Math.random() * 10);
        for (let i = 0; i < numPieces; i++) {
            let sq = Math.floor(Math.random() * 64);
            while (board[sq] !== -1) {
                sq = Math.floor(Math.random() * 64);
            }
            // Pick a random piece type (0-35)
            // Weight heavily towards complex power pieces (20-35)
            let pt = Math.floor(Math.random() * 36);
            if (Math.random() > 0.3) {
                pt = 20 + Math.floor(Math.random() * 16);
            }
            board[sq] = c === 0 ? pt : pt + 100;
        }
    }

    const side = Math.random() > 0.5 ? 'w' : 'b';
    
    // We omit abilities string and limbo for raw movegen and SEE fuzzing,
    // as random abilities can easily create mathematically impossible board states
    // (e.g. 5 pieces claiming to be the active dancer) which the engine correctly rejects anyway.
    
    return `${board.join(',')} ${side} 0 64 - - -;-`;
}

const numTests = 200;
let testsCompleted = 0;
let testsFailed = 0;
const enginePath = path.join(__dirname, 'bin', 'pixie-engine-cpp.exe');

async function runTest(testId: number): Promise<boolean> {
    return new Promise((resolve) => {
        const pfen = generateRandomPFEN();
        const p = spawn(enginePath);
        
        let success = false;
        let timeout = setTimeout(() => {
            p.kill();
            console.error(`[Test ${testId}] TIMEOUT`);
            resolve(false);
        }, 10000); // Max 10s per depth 3 search

        p.stdout.on('data', (d) => {
            const out = d.toString();
            if (out.includes('bestmove')) {
                success = true;
                clearTimeout(timeout);
                p.kill();
                resolve(true);
            }
        });

        p.stderr.on('data', (d) => {
            console.error(`[Test ${testId}] ENGINE ERROR: ${d.toString()}`);
            success = false;
        });

        p.on('close', (code) => {
            clearTimeout(timeout);
            if (!success) {
                console.error(`[Test ${testId}] Crashed with code ${code}`);
                console.error(`FAILING PFEN: ${pfen}`);
                resolve(false);
            }
        });

        p.stdin.write(`uci\n`);
        p.stdin.write(`position pfen ${pfen}\n`);
        p.stdin.write(`go depth 3\n`);
    });
}

async function runFuzzer() {
    console.log(`Running ${numTests} fuzzy positions...`);
    const startTime = Date.now();
    for (let i = 1; i <= numTests; i++) {
        if (i % 25 === 0) console.log(`Progress: ${i}/${numTests}`);
        const passed = await runTest(i);
        if (passed) {
            testsCompleted++;
        } else {
            testsFailed++;
        }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n--- FUZZER RESULTS ---');
    console.log(`Total Positions Tested: ${numTests}`);
    console.log(`Passed: ${testsCompleted}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`Time Elapsed: ${elapsed} seconds`);
    
    if (testsFailed === 0) {
        console.log('STATUS: PASS - Engine is perfectly stable.');
    } else {
        console.log('STATUS: FAIL - Instability detected.');
    }
    process.exit(0);
}

runFuzzer();
