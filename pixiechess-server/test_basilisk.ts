import { evaluatePFEN, Move } from './src/engine/engineInterface';

// Setup a simple board with a White Basilisk at D4
// PFEN format: board side castling ep dead ability limbo
// 64 pieces, D4 is rank 4 file 3 (0-indexed). C++ rank 4 is index 3 in 0-7, which is (7-3)*8+3 = 35 in PFEN array.
const pfenArray = Array(64).fill(-1);
pfenArray[35] = 23; // White Basilisk (23)

const pfen = `${pfenArray.join(',')} w 0 64 - - -;-`;

async function testBasilisk() {
    console.log("Testing Basilisk move generation...");
    try {
        const moves = await evaluatePFEN(pfen, 4, true, false);
        console.log(`Generated ${moves.length} moves for Basilisk at D4.`);
        moves.forEach(m => console.log(`${m.from} -> ${m.to} (ability: ${m.is_ability})`));
        if (moves.length === 0) {
            console.error("FAIL: Basilisk generated 0 moves!");
        } else {
            console.log("SUCCESS: Basilisk generated moves.");
        }
    } catch(e) {
        console.error(e);
    }
}

testBasilisk();
