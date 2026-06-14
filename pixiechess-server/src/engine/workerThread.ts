import { parentPort } from 'worker_threads';
import { findBestMoveUCI } from './uciEngine';

parentPort?.on('message', async (msg) => {
  const { board, gameState, color, depth, workerId, timeLimitMs, taskId } = msg;

  // Stagger workers slightly if doing multi-threading
  setTimeout(async () => {
    try {
      // Call the C++ Engine Oracle
      const result = await findBestMoveUCI(board, color, depth, gameState, timeLimitMs);

      parentPort?.postMessage({
        taskId,
        workerId,
        move: result.move,
        score: result.score,
        nodes: result.nodes,
        effects: [],
        depth: result.depth,
        ttHits: 0,
        multiPv: []
      });
    } catch (err) {
      console.error(`Worker error:`, err);
    }
  }, workerId * 5);
});
