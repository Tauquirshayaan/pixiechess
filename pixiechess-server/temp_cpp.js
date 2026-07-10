const { spawnSync } = require('child_process');
const pfen = '32,16,26,12,5,2,1,3,-1,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,100,100,100,100,100,100,100,132,116,126,112,105,102,101,103 b 15 64 - 16,0,0,0,0,0,0,0,0,64,0,0,64,0,1 -;-';
const result = spawnSync('g:/Pixiechessbot/Stable Bot/Old bot/pixiechess-server/src/engine/bin/pixie-engine-cpp.exe', [], {
    input: 'position pfen ' + pfen + '\ngo depth 5\nquit\n',
    encoding: 'utf-8'
});
console.log(result.stdout);
