const fs = require('fs');
let c = fs.readFileSync('g:/Pixiechessbot/pixiechess-bot/src/engine-v2/pixieGen.ts', 'utf8');

c = c.replace(/const enemies\s*=\s*pixie\.color === 'w' \? state\.blackAll : state\.whiteAll;/g, 
  "const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;");

c = c.replace(/& ~friendly;/g, "& ~friendly & ~state.invulnerable;");

c = c.replace(/if \(\(b & friendly\) !== ZERO\)/g, 
  "if ((b & friendly) !== ZERO || (b & state.invulnerable) !== ZERO)");

c = c.replace(/if \(\(targetBit & friendly\) !== ZERO\)/g, 
  "if ((targetBit & friendly) !== ZERO || (targetBit & state.invulnerable) !== ZERO)");

fs.writeFileSync('g:/Pixiechessbot/pixiechess-bot/src/engine-v2/pixieGen.ts', c);
