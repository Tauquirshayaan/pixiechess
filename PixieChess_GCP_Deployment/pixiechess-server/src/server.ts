import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { findBestMoveUCI } from './engine/uciEngine';
import { suggestPlacements } from './engine/placementAdvisor';
import { autoDeploy } from './engine/autoDeploy';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In production (Docker), FRONTEND_DIST env var points to the built frontend.
// In development, it's the sibling pixiechess-bot/dist folder.
const frontendDistPath = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(__dirname, '../../pixiechess-bot/dist');
app.use(express.static(frontendDistPath));

const MAX_VCPUS = Math.min(8, Math.max(2, os.cpus().length));
let activeCalculations = 0;

// Health check endpoint for GCP uptime monitoring and nginx
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    activeSessions: activeCalculations,
    maxVcpus: MAX_VCPUS,
    memoryMb: Math.floor(process.memoryUsage().rss / 1024 / 1024)
  });
});

app.post('/api/calculate', async (req, res) => {
  try {
    activeCalculations++;
    const { board, gameState, color, depth, timeLimitMs, multiPv, pfenHistory } = req.body;
    if (!board || !gameState || !color) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Dynamic Thread Allocator
    let engineThreads = 1;
    
    if (activeCalculations == 1) {
      engineThreads = MAX_VCPUS; // Give 1 user all cores
    } else if (activeCalculations == 2) {
      engineThreads = Math.floor(MAX_VCPUS / 2);
    } else if (activeCalculations <= 4) {
      engineThreads = Math.floor(MAX_VCPUS / 4);
    } else {
      engineThreads = 1;
    }
    
    console.log(`[ThreadManager] Active Games: ${activeCalculations}. Allocating ${engineThreads} threads to C++ Engine.`);

    const start = Date.now();
    const minWait = timeLimitMs || 0;

    const [result] = await Promise.all([
      findBestMoveUCI(board, color, depth || 7, gameState, timeLimitMs, engineThreads, multiPv || 1, undefined, pfenHistory || []),
      new Promise(resolve => setTimeout(resolve, minWait))
    ]);
    
    res.json(result);
  } catch (error: any) {
    console.error('Calculation error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    activeCalculations--;
  }
});

app.post('/api/calculate-stream', async (req, res) => {
  try {
    activeCalculations++;
    const { board, gameState, color, depth, timeLimitMs, multiPv, pfenHistory } = req.body;
    if (!board || !gameState || !color) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Dynamic Thread Allocator
    let engineThreads = 1;
    if (activeCalculations == 1) {
      engineThreads = MAX_VCPUS;
    } else if (activeCalculations == 2) {
      engineThreads = Math.floor(MAX_VCPUS / 2);
    } else if (activeCalculations <= 4) {
      engineThreads = Math.floor(MAX_VCPUS / 4);
    } else {
      engineThreads = 1;
    }

    console.log(`[ThreadManager] Active Games: ${activeCalculations}. Allocating ${engineThreads} threads to C++ Engine (Streaming).`);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const onInfo = (info: { depth: number; nodes: number; score?: number; pv?: string }) => {
      res.write(JSON.stringify({ type: 'info', ...info }) + '\n');
    };

    const bestMove = await findBestMoveUCI(
      board, color, depth || 7, gameState, timeLimitMs, engineThreads, multiPv || 1, onInfo, pfenHistory || []
    );

    res.write(JSON.stringify({ type: 'bestmove', result: bestMove }) + '\n');
    res.end();
  } catch (error: any) {
    console.error('Calculation streaming error:', error);
    // If headers are already sent, we can't send a 500 status code
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ type: 'error', message: error.message }) + '\n');
      res.end();
    }
  } finally {
    activeCalculations--;
  }
});

app.post('/api/suggest-placement', (req, res) => {
  try {
    const { board, gameState, color, pieceType, pixieName } = req.body;
    if (!board || !gameState || !color || !pieceType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const suggestions = suggestPlacements(board, gameState, color, pieceType, pixieName);
    res.json({ suggestions });
  } catch (error: any) {
    console.error('Suggest placement error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auto-deploy', (req, res) => {
  try {
    const { board, gameState, color, loadout } = req.body;
    if (!board || !gameState || !color || !loadout) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const newBoard = autoDeploy(board, gameState, color, loadout);
    res.json({ board: newBoard });
  } catch (error: any) {
    console.error('Auto deploy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fallback to React app
app.use((req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PixieChess Grandmaster Engine Server running on port ${PORT} (Max vCPUs: ${MAX_VCPUS})`);
});
