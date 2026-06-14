import createPixieEngine from './src/engine/wasm/pixie_engine.js';
async function test() {
  const engine = await createPixieEngine();
  engine.ccall('init_engine', null, [], []);
  const getMoves = engine.cwrap('get_legal_moves_json', 'string', ['string']);
  
  const arr = Array(64).fill(-1);
  arr[12] = 13; // White Warp Jumper on e2 (index 12)
  arr[19] = 100; // Black Pawn on d3 (index 19)
  
  const pfen = `${arr.join(',')} w 0 64 -`;
  console.log("PFEN:", pfen);
  
  const jsonStr = getMoves(pfen);
  console.log("Moves:", jsonStr);
}
test();
