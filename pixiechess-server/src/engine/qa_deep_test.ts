import { spawn } from 'child_process';
import * as path from 'path';

// Construct a complex PFEN that pushes the limits of the engine:
// 1. White Bouncer (23) on a1 (0) to test wall-bounce physics
// 2. Black Basilisk (121) on d5 (35) to test paralyzing aura
// 3. White Marauder (31) on h2 (15) with 5 kills to test range extension
// 4. Black Knightmare (117) in Limbo to test Limbo drop mechanics
// 5. White Fission Reactor (34) on e1 (4) with 4 captures to test explosion detection

// PFEN format:
// 64 squares (0-63, -1 for empty)
// Side to move (w)
// Castling rights (0)
// En Passant (64)
// Dead Pieces (-)
// Ability States (sq,frozen,electro_moves,electro_idle,marauder,fission,used,pilgrim,djinn_diss,djinn_home,dancer_bonus,dancer_act,gun_target,gun_ply,fish_moved)
// Limbo (-; encoded_sq)

const pfenArray = Array(64).fill(-1);
pfenArray[0] = 23; // White Bouncer on a1
pfenArray[35] = 121; // Black Basilisk on d5
pfenArray[15] = 31; // White Marauder on h2
pfenArray[4] = 34; // White Fission Reactor on e1
pfenArray[53] = 105; // Black King on f7
pfenArray[6] = 5; // White King on g1
pfenArray[27] = 0; // White Pawn on d4 (paralyzed by Basilisk)

const boardStr = pfenArray.join(',');

// Ability states:
// Marauder at sq 15: 5 kills
const marauderState = '15,0,0,0,5,0,0,0,0,64,0,0,64,0,0';
// Fission Reactor at sq 4: 4 captures
const reactorState = '4,0,0,0,0,4,0,0,0,64,0,0,64,0,0';
// Pawn at sq 27: frozen for 2 turns
const pawnState = '27,2,0,0,0,0,0,0,0,64,0,0,64,0,0';

const abilities = `${marauderState}|${reactorState}|${pawnState}`;

// Black Knightmare in Limbo (encoded square: let's say hovering over h8, which is cppR=7, cppC=7 -> (10<<4)|10 = 170)
const limbo = '-;170';

const pfen = `${boardStr} w 0 64 - ${abilities} ${limbo}`;

console.log('--- STARTING QA DEEP TEST ---');
console.log('Sending Complex PFEN:');
console.log(pfen);

const enginePath = path.join(__dirname, 'bin', 'pixie-engine-cpp.exe');
const p = spawn(enginePath);

p.stdout.on('data', (d) => {
    const output = d.toString();
    // Filter output to show the most relevant decisions and evaluations
    const lines = output.split('\n');
    for (const line of lines) {
        if (line.includes('info string 1.') || line.includes('info string   > ') || line.includes('bestmove') || line.includes('info string DIAGNOSTICS')) {
            console.log(line.trim());
        }
    }
});

p.stderr.on('data', (d) => {
    console.error(`ENGINE ERROR: ${d.toString()}`);
});

p.on('close', (code) => {
    console.log(`\nEngine exited with code ${code}`);
});

// Run engine at depth 5 to test stability and SEE evaluations
p.stdin.write(`uci\n`);
p.stdin.write(`position pfen ${pfen}\n`);
p.stdin.write(`go depth 5\n`);
// Wait a few seconds then quit
setTimeout(() => {
    p.stdin.write(`quit\n`);
}, 3000);
