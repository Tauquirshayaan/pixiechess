import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { Board, Move, GameState } from './types';
import { boardToPFEN } from './pfen';
import { getAllMovesForColor } from './moveGenerator';
import { getOpeningBookMoves } from './openingBook';

// Maps file characters 'a'-'h' and rank characters '1'-'8' to 0-7 integers
function parseUciCoord(coord: string): [number, number] {
  const fileStr = coord.charAt(0);
  const rankStr = coord.charAt(1);
  const c = fileStr.charCodeAt(0) - 'a'.charCodeAt(0);
  const cppRank = rankStr.charCodeAt(0) - '1'.charCodeAt(0);
  const r = 7 - cppRank;
  return [r, c];
}

interface EngineRequest {
  pfen: string;
  depth: number;
  timeLimitMs: number;
  engineThreads: number;
  multiPvCount: number;
  searchMoves?: string[];
  retryCount?: number;
  resolve: (res: { bestMoveStr: string | null; multiPvResults: { moveStr: string, score: number }[]; depth: number; nodes: number }) => void;
  reject: (error: Error) => void;
  onInfo?: (info: { depth: number; nodes: number; score?: number; pv?: string }) => void;
}

class EngineProcess {
  private process: ChildProcess;
  private currentRequest: EngineRequest | null = null;
  public isBusy: boolean = false;
  public isDead: boolean = false;
  
  private bestMoveStr: string = '';
  private multiPvResults: { moveStr: string, score: number }[] = [];
  private lastDepth: number = 0;
  private lastNodes: number = 0;
  private readyResolver: (() => void) | null = null;
  private outputBuffer: string = '';
  
  constructor() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path.join(__dirname, 'bin');
    const exePath = path.join(binPath, `pixie-engine-cpp${ext}`);
    this.process = spawn(exePath, [], { cwd: binPath });
    
    this.process.stdout?.on('data', (data) => {
      this.outputBuffer += data.toString();
      let newlineIdx;
      while ((newlineIdx = this.outputBuffer.indexOf('\n')) !== -1) {
        const line = this.outputBuffer.slice(0, newlineIdx).trim();
        this.outputBuffer = this.outputBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        if (line.startsWith('info string ')) {
          console.log(`[C++ Engine] ${line.replace('info string ', '')}`);
        } else if (line.trim() === 'readyok' && this.readyResolver) {
          this.readyResolver();
          this.readyResolver = null;
        } else if (line.startsWith('info ')) {
          if (line.includes('depth ')) {
            const parts = line.split(' ');
            const depthIdx = parts.indexOf('depth');
            if (depthIdx !== -1) {
              const parsedDepth = parseInt(parts[depthIdx + 1], 10);
              // The C++ engine incorrectly outputs the target depth (e.g. 99) when aborted by time.
              if (this.currentRequest && parsedDepth === this.currentRequest.depth && parsedDepth > this.lastDepth + 1) {
                // Ignore the fake depth jump, keep the last valid searched depth
              } else {
                this.lastDepth = parsedDepth;
              }
            }            
            const nodesIdx = parts.indexOf('nodes');
            if (nodesIdx !== -1) this.lastNodes = parseInt(parts[nodesIdx + 1], 10);
          }
          
          if (line.includes('multipv ')) {
            const parts = line.split(' ');
            const pvIndex = parts.indexOf('pv');
            const cpIndex = parts.indexOf('cp');
            
            const mPvIdxStr = parts[parts.indexOf('multipv') + 1];
            const mPvIdx = parseInt(mPvIdxStr, 10);
            
            if (pvIndex !== -1 && cpIndex !== -1 && !isNaN(mPvIdx)) {
              const score = parseInt(parts[cpIndex + 1], 10);
              const moveStr = parts[pvIndex + 1].trim();
              this.multiPvResults[mPvIdx - 1] = { moveStr, score };
              
              if (this.currentRequest?.onInfo) {
                this.currentRequest.onInfo({
                  depth: this.lastDepth,
                  nodes: this.lastNodes,
                  score,
                  pv: moveStr
                });
              }
            }
          } else {
            // Also fire onInfo even if multipv isn't found but depth/nodes are updated
            if (this.currentRequest?.onInfo) {
              this.currentRequest.onInfo({
                depth: this.lastDepth,
                nodes: this.lastNodes
              });
            }
          }
        } else if (line.startsWith('bestmove ')) {
          this.bestMoveStr = line.split(' ')[1].trim();
          this.completeCurrentRequest();
        }
      }
    });
    
    this.process.stderr?.on('data', (data) => {
      console.error(`Engine Error: ${data}`);
    });
    
    this.process.on('close', (code) => {
      console.log(`Engine process died with code ${code}`);
      if (this.currentRequest) {
        this.currentRequest.reject(new Error(`Engine crashed with code ${code}`));
      }
      this.isBusy = false;
      this.isDead = true;
      this.currentRequest = null;
    });
  }

  public async execute(req: EngineRequest) {
    this.isBusy = true;
    this.currentRequest = req;
    this.bestMoveStr = '';
    this.multiPvResults = [];
    this.lastDepth = 0;
    this.lastNodes = 0;
    
    try {
      this.process.stdin?.write(`setoption name Threads value ${req.engineThreads}\n`);
      this.process.stdin?.write(`setoption name MultiPV value ${req.multiPvCount}\n`);
      
      // Wait for isready -> readyok handshake
      await new Promise<void>((resolve) => {
        this.readyResolver = resolve;
        this.process.stdin?.write('isready\n');
      });
      
      this.process.stdin?.write('ucinewgame\n');
      this.process.stdin?.write(`position pfen ${req.pfen}\n`);
      
      let goCmd = `go depth ${req.depth} movetime ${req.timeLimitMs}`;
      if (req.searchMoves && req.searchMoves.length > 0) {
        goCmd += ` searchmoves ${req.searchMoves.join(' ')}`;
      }
      this.process.stdin?.write(`${goCmd}\n`);
    } catch (e) {
      this.currentRequest.reject(e as Error);
      this.isBusy = false;
      this.currentRequest = null;
    }
  }
  
  private completeCurrentRequest() {
    if (!this.currentRequest) return;
    
    const req = this.currentRequest;
    this.isBusy = false;
    this.currentRequest = null;
    
    if (this.bestMoveStr && this.bestMoveStr !== '(none)') {
      req.resolve({
        bestMoveStr: this.bestMoveStr,
        multiPvResults: this.multiPvResults,
        depth: this.lastDepth || req.depth,
        nodes: this.lastNodes
      });
    } else {
      req.resolve({
        bestMoveStr: null,
        multiPvResults: [],
        depth: req.depth,
        nodes: 0
      });
    }
  }
}

class EnginePool {
  private pool: EngineProcess[] = [];
  private queue: EngineRequest[] = [];
  private readonly MAX_POOL_SIZE = 4;
  
  constructor() {
    // Pre-warm one engine
    this.pool.push(new EngineProcess());
  }
  
  public async run(
    pfen: string, depth: number, timeLimitMs: number, engineThreads: number, multiPvCount: number, searchMoves?: string[],
    onInfo?: (info: { depth: number; nodes: number; score?: number; pv?: string }) => void,
    retryCount: number = 0
  ): Promise<{ bestMoveStr: string | null; multiPvResults: { moveStr: string, score: number }[]; depth: number; nodes: number }> {
    return new Promise((resolve, reject) => {
      // Clean up any engines that have died
      this.pool = this.pool.filter(e => !e.isDead);
      
      const req: EngineRequest = {
        pfen, depth, timeLimitMs, engineThreads, multiPvCount, searchMoves, onInfo, retryCount,
        resolve: (res) => {
          resolve(res);
          this.processQueue();
        },
        reject: (err) => {
          if (retryCount < 1) {
            console.warn(`Engine crashed, retrying (attempt ${retryCount + 1})`);
            this.run(pfen, depth, timeLimitMs, engineThreads, multiPvCount, searchMoves, onInfo, retryCount + 1)
              .then(resolve)
              .catch(reject)
              .finally(() => this.processQueue());
          } else {
            reject(err);
            this.processQueue();
          }
        }
      };
      
      const availableEngine = this.pool.find(e => !e.isBusy);
      if (availableEngine) {
        availableEngine.execute(req);
      } else if (this.pool.length < this.MAX_POOL_SIZE) {
        const newEngine = new EngineProcess();
        this.pool.push(newEngine);
        newEngine.execute(req);
      } else {
        this.queue.push(req);
      }
    });
  }
  
  private processQueue() {
    if (this.queue.length === 0) return;
    
    // Clean up any engines that have died
    this.pool = this.pool.filter(e => !e.isDead);
    
    const availableEngine = this.pool.find(e => !e.isBusy);
    if (availableEngine) {
      const req = this.queue.shift()!;
      availableEngine.execute(req);
    }
  }
}

const enginePool = new EnginePool();

export async function findBestMoveUCI(
  board: Board,
  color: 'w' | 'b',
  depth: number,
  gameState: GameState,
  timeLimitMs: number = 3000,
  engineThreads: number = 1,
  multiPvCount: number = 1,
  onInfo?: (info: { depth: number; nodes: number; score?: number; pv?: string }) => void,
  pfenHistory: string[] = []
): Promise<{ move: Move; score: number; nodes: number; depth: number; multiPv?: { move: Move, score: number }[] }> {
  const isWhite = color === 'w';
  const bookMoves = getOpeningBookMoves(board, gameState, isWhite);
  
  const pfen = boardToPFEN(board, color, gameState);
  
  const legalMoves = getAllMovesForColor(board, color, gameState);
  let searchMoves: string[] | undefined = undefined;
  if (bookMoves && bookMoves.length > 0) {
    const validBookMoves = bookMoves.filter(bm => 
      legalMoves.some(lm => lm.from[0] === bm.from[0] && lm.from[1] === bm.from[1] && lm.to[0] === bm.to[0] && lm.to[1] === bm.to[1])
    );
    if (validBookMoves.length > 0) {
      searchMoves = validBookMoves.map(m => {
        const fromFile = String.fromCharCode('a'.charCodeAt(0) + m.from[1]);
        const fromRank = String.fromCharCode('1'.charCodeAt(0) + (7 - m.from[0]));
        const toFile = String.fromCharCode('a'.charCodeAt(0) + m.to[1]);
        const toRank = String.fromCharCode('1'.charCodeAt(0) + (7 - m.to[0]));
        return `${fromFile}${fromRank}${toFile}${toRank}`;
      });
    }
  }
  
  const rawResult = await enginePool.run(
    pfen, 
    depth, 
    timeLimitMs, 
    engineThreads, 
    multiPvCount, 
    searchMoves,
    onInfo
  );
  
  if (!rawResult.bestMoveStr) {
    const legalMoves = getAllMovesForColor(board, color, gameState);
    if (legalMoves.length > 0) {
      const bestTsFallback = legalMoves.find(m => m.capture) ?? legalMoves[0];
      console.warn(`[Fallback] C++ returned (none). Using TS fallback move: from=${JSON.stringify(bestTsFallback.from)} to=${JSON.stringify(bestTsFallback.to)}`);
      return { move: bestTsFallback, score: 0, nodes: 0, depth, multiPv: [] };
    }
    return { move: null as any, score: 0, nodes: 0, depth };
  }
  
  const fromCoord = parseUciCoord(rawResult.bestMoveStr.substring(0, 2));
  const toCoord = parseUciCoord(rawResult.bestMoveStr.substring(2, 4));
  
  // Parse special Knightmare tags from our modified C++ engine
  const isJump = rawResult.bestMoveStr.includes('-jump');
  const isDrop = rawResult.bestMoveStr.includes('-drop');
  const isLimbo = rawResult.bestMoveStr.includes('-limbo');
  let promoChar: string | null = null;
  let kmIndex = -1;
  let kmDir = -1;
  
  if (isJump) {
    kmIndex = parseInt(rawResult.bestMoveStr.split('-jump')[1], 10);
  } else if (isDrop) {
    kmIndex = parseInt(rawResult.bestMoveStr.split('-drop')[1], 10);
  } else if (isLimbo) {
    const parts = rawResult.bestMoveStr.split('-limbo')[1].split('dir');
    kmIndex = parseInt(parts[0], 10);
    kmDir = parseInt(parts[1], 10);
  } else {
    promoChar = rawResult.bestMoveStr.length > 4 ? rawResult.bestMoveStr.charAt(4).toUpperCase() : null;
  }
  
  const km_dirs = [[-2,-1], [-2,1], [-1,-2], [-1,2], [1,-2], [1,2], [2,-1], [2,1]];
  
  const fullMove = legalMoves.find(m => {
    if (isJump) {
      if (m.from[0] !== fromCoord[0] || m.from[1] !== fromCoord[1] || !m.obJump) return false;
      const targetR = fromCoord[0] + km_dirs[kmIndex][0];
      const targetC = fromCoord[1] + km_dirs[kmIndex][1];
      return m.to[0] === targetR && m.to[1] === targetC;
    } else if (isLimbo) {
      if (!m.obJump || m.drop !== 'KNIGHTMARE') return false; // Limbo-to-limbo leaps have both obJump and drop='KNIGHTMARE' in TS
      
      let foundCount = 0;
      let targetObSq: [number, number] | null = null;
      for (const ob of gameState.offBoardPieces || []) {
        if (ob.piece.color === color && ob.piece.pixie === 'KNIGHTMARE') {
          if (foundCount === kmIndex) {
            targetObSq = ob.obSq;
            break;
          }
          foundCount++;
        }
      }
      if (!targetObSq) return false;
      const targetR = targetObSq[0] + km_dirs[kmDir][0];
      const targetC = targetObSq[1] + km_dirs[kmDir][1];
      return m.from[0] === targetObSq[0] && m.from[1] === targetObSq[1] && m.to[0] === targetR && m.to[1] === targetC;
    } else if (isDrop) {
      if (m.to[0] !== toCoord[0] || m.to[1] !== toCoord[1] || m.drop !== 'KNIGHTMARE') return false;
      
      // We need to match the specific offBoardPiece using kmIndex
      const offBoardPieces = gameState.offBoardPieces || [];
      const enemyColor = color;
      
      // Count matching offboard pieces exactly like C++ does
      let foundCount = 0;
      let targetObSq: [number, number] | null = null;
      for (const ob of offBoardPieces) {
        if (ob.piece.color === enemyColor && ob.piece.pixie === 'KNIGHTMARE') {
          if (foundCount === kmIndex) {
            targetObSq = ob.obSq;
            break;
          }
          foundCount++;
        }
      }
      
      if (targetObSq) {
        return m.from[0] === targetObSq[0] && m.from[1] === targetObSq[1];
      }
      return false;
    } else {
      const matchesCoords = m.from[0] === fromCoord[0] && m.from[1] === fromCoord[1] &&
                            m.to[0] === toCoord[0] && m.to[1] === toCoord[1];
      if (!matchesCoords) return false;
      if (promoChar) return m.promotion === promoChar;
      return true;
    }
  });
  
  const multiPvFull = rawResult.multiPvResults.map((res: any) => {
    const fCoord = parseUciCoord(res.moveStr.substring(0, 2));
    const tCoord = parseUciCoord(res.moveStr.substring(2, 4));
    
    const isPvJump = res.moveStr.includes('-jump');
    const isPvDrop = res.moveStr.includes('-drop');
    const isPvLimbo = res.moveStr.includes('-limbo');
    let pChar: string | null = null;
    let pvKmIndex = -1;
    let pvKmDir = -1;
    
    if (isPvJump) {
      pvKmIndex = parseInt(res.moveStr.split('-jump')[1], 10);
    } else if (isPvDrop) {
      pvKmIndex = parseInt(res.moveStr.split('-drop')[1], 10);
    } else if (isPvLimbo) {
      const parts = res.moveStr.split('-limbo')[1].split('dir');
      pvKmIndex = parseInt(parts[0], 10);
      pvKmDir = parseInt(parts[1], 10);
    } else {
      pChar = res.moveStr.length > 4 ? res.moveStr.charAt(4).toUpperCase() : null;
    }
    
    const fMove = legalMoves.find(m => {
      if (isPvJump) {
        if (m.from[0] !== fCoord[0] || m.from[1] !== fCoord[1] || !m.obJump) return false;
        const targetR = fCoord[0] - km_dirs[pvKmIndex][0];
        const targetC = fCoord[1] + km_dirs[pvKmIndex][1];
        return m.to[0] === targetR && m.to[1] === targetC;
      } else if (isPvLimbo) {
        if (!m.obJump || m.drop !== 'KNIGHTMARE') return false;
        let foundCount = 0;
        let targetObSq: [number, number] | null = null;
        for (const ob of gameState.offBoardPieces || []) {
          if (ob.piece.color === color && ob.piece.pixie === 'KNIGHTMARE') {
            if (foundCount === pvKmIndex) {
              targetObSq = ob.obSq;
              break;
            }
            foundCount++;
          }
        }
        if (!targetObSq) return false;
        const targetR = targetObSq[0] - km_dirs[pvKmDir][0];
        const targetC = targetObSq[1] + km_dirs[pvKmDir][1];
        return m.from[0] === targetObSq[0] && m.from[1] === targetObSq[1] && m.to[0] === targetR && m.to[1] === targetC;
      } else if (isPvDrop) {
        if (m.to[0] !== tCoord[0] || m.to[1] !== tCoord[1] || m.drop !== 'KNIGHTMARE') return false;
        let foundCount = 0;
        let targetObSq: [number, number] | null = null;
        for (const ob of gameState.offBoardPieces || []) {
          if (ob.piece.color === color && ob.piece.pixie === 'KNIGHTMARE') {
            if (foundCount === pvKmIndex) {
              targetObSq = ob.obSq;
              break;
            }
            foundCount++;
          }
        }
        if (targetObSq) return m.from[0] === targetObSq[0] && m.from[1] === targetObSq[1];
        return false;
      } else {
        return m.from[0] === fCoord[0] && m.from[1] === fCoord[1] &&
               m.to[0] === tCoord[0] && m.to[1] === tCoord[1] &&
               (!pChar || m.promotion === pChar);
      }
    });
    return { move: fMove!, score: res.score };
  }).filter((res: any) => res.move !== undefined);
  
  if (fullMove) {
    // ── Avoid Threefold Repetition ──
    // Simulate resulting PFEN and check if it would be seen 3+ times in history.
    // If so, try to pick a non-repeating alternative from multi-PV or legal moves.
    if (pfenHistory.length >= 4) {
      const nextColor = color === 'w' ? 'b' : 'w';
      const resultPfen = boardToPFEN(board, nextColor, {
        ...gameState,
        turn: gameState.turn + 1
      });
      const repetitionCount = pfenHistory.filter(p => p === resultPfen).length;
      if (repetitionCount >= 2) {
        // This move causes a draw. Try to find a non-repeating alternative.
        const nonRepeatMove =
          multiPvFull.find(pvRes => {
            if (!pvRes.move) return false;
            const altPfen = boardToPFEN(board, nextColor, { ...gameState, turn: gameState.turn + 1 });
            return pfenHistory.filter(p => p === altPfen).length < 2;
          })?.move ??
          legalMoves.find(m => {
            const altPfen = boardToPFEN(board, nextColor, { ...gameState, turn: gameState.turn + 1 });
            return pfenHistory.filter(p => p === altPfen).length < 2 &&
                   !(m.from[0] === fullMove.from[0] && m.from[1] === fullMove.from[1] &&
                     m.to[0] === fullMove.to[0] && m.to[1] === fullMove.to[1]);
          });
        if (nonRepeatMove) {
          console.log('[RepetitionGuard] Overriding draw-causing move with non-repeating alternative.');
          return {
            move: nonRepeatMove,
            score: rawResult.multiPvResults.length > 0 ? rawResult.multiPvResults[0].score : 0,
            nodes: rawResult.nodes,
            depth: rawResult.depth,
            multiPv: multiPvFull
          };
        }
      }
    }

    return {
      move: fullMove,
      score: rawResult.multiPvResults.length > 0 ? rawResult.multiPvResults[0].score : 0,
      nodes: rawResult.nodes,
      depth: rawResult.depth,
      multiPv: multiPvFull
    };
  } else {
    // C++ engine returned a move that TS doesn't recognise — log for diagnostics, then fall back gracefully.
    console.warn(`[Desync] PFEN: ${pfen}`); console.warn(`[Desync] C++ returned "${rawResult.bestMoveStr}" (from=${JSON.stringify(fromCoord)}, to=${JSON.stringify(toCoord)}) but it is NOT in ${legalMoves.length} TS legal moves.`);;
    console.warn(`[Desync] TS legal moves (from squares):`, [...new Set(legalMoves.map(m => `${m.from[0]},${m.from[1]}`))].join(' | '));

    // 1. Try any multi-PV alternative that IS in TS legal moves
    for (const pvRes of rawResult.multiPvResults) {
      const fCoord = parseUciCoord(pvRes.moveStr.substring(0, 2));
      const tCoord = parseUciCoord(pvRes.moveStr.substring(2, 4));
      const pChar = pvRes.moveStr.length > 4 ? pvRes.moveStr.charAt(4).toUpperCase() : null;
      const alt = legalMoves.find(m =>
        m.from[0] === fCoord[0] && m.from[1] === fCoord[1] &&
        m.to[0] === tCoord[0] && m.to[1] === tCoord[1] &&
        (!pChar || m.promotion === pChar)
      );
      if (alt) {
        console.warn(`[Desync] Falling back to multi-PV alternative: ${pvRes.moveStr}`);
        return { move: alt, score: pvRes.score, nodes: rawResult.nodes, depth: rawResult.depth, multiPv: multiPvFull };
      }
    }

    // 2. Last resort: return the first TS legal move (captures preferred)
    if (legalMoves.length > 0) {
      const bestTsFallback = legalMoves.find(m => m.capture) ?? legalMoves[0];
      console.warn(`[Desync] No multi-PV alternative found. Using TS fallback move: from=${JSON.stringify(bestTsFallback.from)} to=${JSON.stringify(bestTsFallback.to)}`);
      return { move: bestTsFallback, score: 0, nodes: rawResult.nodes, depth: rawResult.depth, multiPv: multiPvFull };
    }

    // 3. No moves at all
    return { move: null as any, score: 0, nodes: 0, depth };
  }
}
