const createPixieEngine = require('./src/engine/wasm/pixie_engine.js');
async function test() {
  const engine = await createPixieEngine();
  engine.ccall('init_engine', null, [], []);
  const getMoves = engine.cwrap('get_legal_moves_json', 'string', ['string']);
  // PFEN with Warp Jumper on E2, Enemy pawn on D3
  // White to move
  const pfen = "8/8/8/8/8/3p4/4W3/8 w - - 0 1 | {}";
  const json = getMoves(pfen);
  console.log(json);
}
test();
