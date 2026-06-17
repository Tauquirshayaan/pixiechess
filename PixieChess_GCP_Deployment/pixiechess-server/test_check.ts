import { execSync } from 'child_process';

const enginePath = 'g:\\Pixiechessbot\\pixiechess-server\\pixie-engine-cpp.exe';

// Let's create a PFEN where White King is on e1 (sq=4 after flip)
// Black Knightmare is at obSq=(8, 2) which becomes cppR=-1, cppC=2 => encoded=20
const pfenArray = Array(64).fill(-1);
pfenArray[4] = 5; // White King
pfenArray[27] = 0; // White Pawn on d4 (r=4, c=3) -> cppRank=3 -> sq=27
pfenArray[36] = 100; // Black Pawn on e5 (r=3, c=4) -> cppRank=4 -> sq=36

const testPFEN = `${pfenArray.join(',')} w 0 64 - - -;20`;

const cmd = `${enginePath}`;
const input = `position pfen ${testPFEN}\ngo depth 2\nquit\n`;

try {
  const result = execSync(cmd, { input, encoding: 'utf-8' });
  console.log(result);
} catch (e) {
  console.error(e);
}
