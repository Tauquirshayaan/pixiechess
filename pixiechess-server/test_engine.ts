import { execSync } from 'child_process';

const enginePath = 'g:\\Pixiechessbot\\pixie-engine-cpp\\pixie-engine-cpp.exe';

const PFEN = '-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1 w 0 64 - - -;51';

console.log('Sending PFEN:', PFEN);

// 5 is White King at e2 (sq 52)
// 51 is ( (r+2)<<4 | (c+2) ). 
// Let's decode 51:
// 51 >> 4 = 3 -> 3-2 = 1 (ob_r = 1)
// 51 & 0xF = 3 -> 3-2 = 1 (ob_c = 1)
// Black Knightmare is at (1, 1).
// L-shape from (1, 1) -> (3, 2), (3, 0), (0, 3), (2, 3), etc.
// In C++, e2 is rank 6 (7-1), col 4. Wait, White King at e2 is r=6, c=4.
// Let's create a scenario where White King is at (0, 3).
// r=0, c=3.
// PFEN sq = (7-0)*8 + 3 = 59 (d1). 
// So 59 is White King (5).

const testPFEN = '-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,5,-1,-1,-1,-1 w 0 64 - - -;51';

// White King is on d1 (sq 59).
// Black Knightmare is at (ob_r=1, ob_c=1).
// Knightmare at (1,1) attacks (0,3) because 1-1=0, 1+2=3! dr=-1, dc=2.
// So d1 IS in check!
// Let's see if the engine realizes d1 is in check.
// If it is in check, the engine should ONLY suggest moves that escape the check.
// Since it's the only piece, it MUST move the King.

const cmd = `${enginePath}`;
const input = `position pfen ${testPFEN}\ngo depth 1\nquit\n`;

try {
  const result = execSync(cmd, { input, encoding: 'utf-8' });
  console.log(result);
} catch (e) {
  console.error(e);
}
