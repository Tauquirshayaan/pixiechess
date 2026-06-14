import { Worker } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const numCPUs = Math.max(1, os.cpus().length - 2); // Leave 2 cores free for live server
const DATA_FILE = path.resolve(process.cwd(), 'training_data.jsonl');
const WORKER_SCRIPT = path.resolve(__dirname, 'engine/trainingWorker.ts');

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        PIXIECHESS NNUE TRAINING DATA GENERATOR              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`\n🚀 Spawning ${numCPUs} concurrent AI self-play workers...`);
console.log(`📂 Writing output to: ${DATA_FILE}\n`);

let totalPositionsSaved = 0;
let totalGamesPlayed = 0;
let lastLogTime = Date.now();

// Create write stream in append mode
const stream = fs.createWriteStream(DATA_FILE, { flags: 'a' });

function spawnWorker(id: number) {
  const worker = new Worker(`
    require('ts-node').register({ transpileOnly: true });
    require('${WORKER_SCRIPT.replace(/\\/g, '/')}');
  `, { eval: true });

  worker.on('message', (gamePositions: any[]) => {
    totalGamesPlayed++;
    totalPositionsSaved += gamePositions.length;
    
    // Write all positions from the game as JSON lines
    if (gamePositions.length > 0) {
      const payload = gamePositions.map(p => JSON.stringify(p)).join('\n') + '\n';
      stream.write(payload);
    }

    // Logging progress
    const now = Date.now();
    if (now - lastLogTime > 5000) { // Log every 5 seconds
      lastLogTime = now;
      console.log(`[Status] Generated ${totalPositionsSaved} positions across ${totalGamesPlayed} games. (Using ${numCPUs} cores)`);
    }
  });

  worker.on('error', (err) => {
    console.error(`Worker ${id} error:`, err);
    // Restart worker on crash to ensure 24/7 generation
    console.log(`Restarting Worker ${id}...`);
    spawnWorker(id);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Worker ${id} stopped with exit code ${code}`);
    }
  });
}

// Spawn workers for each CPU core
for (let i = 0; i < numCPUs; i++) {
  spawnWorker(i);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully. Closing file streams...');
  stream.end(() => {
    console.log(`✅ Successfully saved ${totalPositionsSaved} total positions!`);
    process.exit(0);
  });
});
