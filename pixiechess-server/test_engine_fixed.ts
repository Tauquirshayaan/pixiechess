import { execSync } from 'child_process';

const enginePath = 'g:\\Pixiechessbot\\pixiechess-server\\pixie-engine-cpp.exe';

const pfenArray = Array(64).fill(-1);
pfenArray[53] = 5; // White King at sq 53
const testPFEN = `${pfenArray.join(',')} w 0 64 - - -;168`; // Black Knightmare at encoded 168

const cmd = `${enginePath}`;
const input = `position pfen ${testPFEN}\ngo depth 1\nquit\n`;

try {
  const result = execSync(cmd, { input, encoding: 'utf-8' });
  console.log(result);
} catch (e) {
  console.error(e);
}
