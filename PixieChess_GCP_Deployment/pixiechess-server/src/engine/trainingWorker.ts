import { parentPort, workerData } from 'worker_threads';
import { Board, GameState, Move, AbilityTracker } from './types';
import { applyMove } from './applyMove';
import { getAllMovesForColor, isCheck } from './moveGenerator';
import { findBestMove, initTT } from './search';
import { PIECE_CATALOG } from '../data/pieceCatalog';

// Initialize a small local TT for this specific worker so it doesn't collide with others
initTT();

class SimTracker implements AbilityTracker {
  private h: GameState[] = [];
  push(s: GameState) { this.h.push({ ...s }); }
  pop() { return this.h.pop() || null; }
  clear() { this.h = []; }
  decrementFreezes(gs: GameState) {
    gs.frozen = gs.frozen.map(f => ({ ...f, turns_remaining: f.turns_remaining - 1 })).filter(f => f.turns_remaining > 0);
  }
}

function createStartingBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  // Black back rank
  b[0][0] = { type: 'R', color: 'b', id: 'bR0', state: {} };
  b[0][1] = { type: 'N', color: 'b', id: 'bN0', state: {} };
  b[0][2] = { type: 'B', color: 'b', id: 'bB0', state: {} };
  b[0][3] = { type: 'Q', color: 'b', id: 'bQ',  state: {} };
  b[0][4] = { type: 'K', color: 'b', id: 'bK',  state: {} };
  b[0][5] = { type: 'B', color: 'b', id: 'bB1', state: {} };
  b[0][6] = { type: 'N', color: 'b', id: 'bN1', state: {} };
  b[0][7] = { type: 'R', color: 'b', id: 'bR1', state: {} };
  for (let c = 0; c < 8; c++) b[1][c] = { type: 'P', color: 'b', id: `bP${c}`, state: {} };
  // White back rank
  b[7][0] = { type: 'R', color: 'w', id: 'wR0', state: {} };
  b[7][1] = { type: 'N', color: 'w', id: 'wN0', state: {} };
  b[7][2] = { type: 'B', color: 'w', id: 'wB0', state: {} };
  b[7][3] = { type: 'Q', color: 'w', id: 'wQ',  state: {} };
  b[7][4] = { type: 'K', color: 'w', id: 'wK',  state: {} };
  b[7][5] = { type: 'B', color: 'w', id: 'wB1', state: {} };
  b[7][6] = { type: 'N', color: 'w', id: 'wN1', state: {} };
  b[7][7] = { type: 'R', color: 'w', id: 'wR1', state: {} };
  for (let c = 0; c < 8; c++) b[6][c] = { type: 'P', color: 'w', id: `wP${c}`, state: {} };
  return b;
}

function createStartingGameState(): GameState {
  return {
    frozen: [], paralyzed: { w: [], b: [] },
    promotionBlock: false, doomed: {},
    turn: 1, castling: { K: true, Q: true, k: true, q: true },
    offBoardPieces: [], pendingIcicle: [], lastMove: null, deadPieces: []
  };
}

function randomizeBoard(b: Board) {
  // Group valid pixies by their base type, excluding ROCKETMAN
  const validPixiesByBase: Record<string, string[]> = { 'P': [], 'N': [], 'B': [], 'R': [], 'Q': [] };
  
  for (const [pixieKey, metaObj] of Object.entries(PIECE_CATALOG)) {
    const meta = metaObj as any;
    if (pixieKey !== 'ROCKETMAN' && validPixiesByBase[meta.base]) {
      validPixiesByBase[meta.base].push(pixieKey);
    }
  }

  // Helper to randomize a side
  const randomizeSide = (color: 'w' | 'b') => {
    // Collect all valid target coordinates for this color
    const targets: {r: number, c: number, base: string}[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = b[r][c];
        if (piece && piece.color === color && piece.type !== 'K') {
          if (validPixiesByBase[piece.type] && validPixiesByBase[piece.type].length > 0) {
            targets.push({ r, c, base: piece.type });
          }
        }
      }
    }

    // Shuffle targets
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    // Pick a random number between 1 and 6 power pieces
    const numPowerPieces = Math.floor(Math.random() * 6) + 1; // 1 to 6
    
    // Apply up to numPowerPieces
    const selectedTargets = targets.slice(0, Math.min(numPowerPieces, targets.length));
    for (const t of selectedTargets) {
      const availablePixies = validPixiesByBase[t.base];
      const chosenPixie = availablePixies[Math.floor(Math.random() * availablePixies.length)];
      b[t.r][t.c]!.pixie = chosenPixie as any;
    }
  };

  randomizeSide('w');
  randomizeSide('b');
}

async function playSingleGame() {
  const tracker = new SimTracker();
  let board = createStartingBoard();
  randomizeBoard(board);
  let gs = createStartingGameState();
  
  const positions: any[] = [];
  let moveCount = 0;
  let winner: 'w' | 'b' | 'draw' | null = null;
  const searchDepth = 4; // Increased to 4 for Grandmaster quality self-play

  while (moveCount < 150 && !winner) {
    const color = gs.turn % 2 === 1 ? 'w' : 'b';
    const moves = getAllMovesForColor(board, color, gs);
    
    if (moves.length === 0) {
      if (isCheck(board, color, gs)) winner = color === 'w' ? 'b' : 'w';
      else winner = 'draw';
      break;
    }

    // Find the best move using the optimized iterative deepening search
    const searchResult = findBestMove(board, color, searchDepth, gs, tracker);
    
    if (!searchResult.move) {
      winner = 'draw';
      break;
    }
    
    let bestMove = searchResult.move;
    let bestScore = searchResult.score;

    // Save position before making the move
    positions.push({
      board: JSON.parse(JSON.stringify(board)), // deep copy
      color,
      score: bestScore
    });

    // Make the move
    tracker.push(gs);
    const result = applyMove(board, bestMove, gs, tracker);
    board = result.board;
    gs = result.gameState;
    
    // Log the move to prove it's actively playing
    if (moveCount % 10 === 0) {
       console.log(`[Worker] Game in progress... Move ${moveCount}/150 (${color} turn) -> Score: ${bestScore}`);
    }

    // Check custom win conditions (Rocketman explosion, etc)
    if (result.effects.includes('PIXIE_WIN')) {
      winner = color;
      break;
    }

    // Check missing kings
    let wK = false, bK = false;
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
      if (board[r][c]?.type === 'K') {
        if (board[r][c]?.color === 'w') wK = true;
        if (board[r][c]?.color === 'b') bK = true;
      }
    }
    if (!wK) winner = 'b';
    else if (!bK) winner = 'w';

    moveCount++;
  }

  if (!winner) winner = 'draw';
  
  // Format the data and send to parent
  let resultValue = 0.5;
  if (winner === 'w') resultValue = 1.0;
  if (winner === 'b') resultValue = 0.0;

  const exportData = positions.map(pos => ({
    b: pos.board,
    c: pos.color,
    s: pos.score,
    r: resultValue
  }));

  parentPort?.postMessage(exportData);
}

// Loop forever playing games
async function loop() {
  while (true) {
    try {
      await playSingleGame();
    } catch (e) {
      console.error("Worker game crash:", e);
    }
  }
}

loop();
