import engine from './pixie_engine.js';
engine().then((module) => {
    const get_moves = module.cwrap('get_legal_moves_json', 'string', ['string']);
    const startpos = "3,1,2,4,5,2,1,3,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,0,0,0,0,0,0,3,1,2,4,5,2,1,3 w 0 64 - -;-";
    console.log("Calling get_legal_moves_json...");
    console.time("get_legal_moves_json");
    const json = get_moves(startpos);
    console.timeEnd("get_legal_moves_json");
    console.log(json.substring(0, 100) + "...");
}).catch(console.error);
