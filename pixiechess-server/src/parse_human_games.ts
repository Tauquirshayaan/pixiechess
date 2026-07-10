import * as fs from 'fs';
import * as path from 'path';
import { pfenToGameState } from './engine/pfen';
import { evaluate } from './engine/evaluator';

const HUMAN_GAMES_DIR = path.resolve(__dirname, 'data/human_games');
const OUTPUT_FILE = path.resolve(process.cwd(), 'training_data.jsonl');

console.log('========================================================');
console.log('       PIXIECHESS HUMAN GAME INGESTION PIPELINE       ');
console.log('========================================================');

if (!fs.existsSync(HUMAN_GAMES_DIR)) {
  fs.mkdirSync(HUMAN_GAMES_DIR, { recursive: true });
  console.log(`Created directory: ${HUMAN_GAMES_DIR}`);
  console.log('Please place your human games here.');
  console.log('Format must be a JSON array: [{ "pfen": "...", "result": 1.0 }, ...]');
  console.log('result: 1.0 = White win, 0.0 = Black win, 0.5 = Draw');
  process.exit(0);
}

const files = fs.readdirSync(HUMAN_GAMES_DIR).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.log(`No .json files found in ${HUMAN_GAMES_DIR}.`);
  console.log('Add your games there and re-run this script to append to NNUE training data.');
  process.exit(0);
}

const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
let totalPositions = 0;

for (const file of files) {
  console.log(`Processing ${file}...`);
  const content = fs.readFileSync(path.join(HUMAN_GAMES_DIR, file), 'utf-8');
  try {
    const data = JSON.parse(content);
    for (const pos of data) {
      if (!pos.pfen || pos.result === undefined) {
        console.warn('Skipping invalid entry (missing pfen or result field).');
        continue;
      }
      
      // Decode PFEN string into Board and GameState
      const gs = pfenToGameState(pos.pfen);
      const color = gs.turn % 2 === 1 ? 'w' : 'b';
      
      // Calculate the GM-level static evaluation for the position
      const score = evaluate(gs.board, color, gs);
      
      // Format to match NNUE generator output
      const payload = {
        b: gs.board,
        c: color,
        s: score,
        r: pos.result
      };
      
      stream.write(JSON.stringify(payload) + '\n');
      totalPositions++;
    }
  } catch (e) {
    console.error(`Failed to parse ${file}:`, e);
  }
}

stream.end();
console.log(`Successfully ingested ${totalPositions} human positions into ${OUTPUT_FILE}`);
console.log('The NNUE model can now learn from your strategic playstyles!');
