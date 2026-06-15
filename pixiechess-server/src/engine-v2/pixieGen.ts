import type { Move, GameState } from '../engine/types';
import {
  type BitboardState,
  ZERO, bit, toRC, iterBits, sq, fileOf, rankOf, lsb,
  NOT_FILE_A, NOT_FILE_H,
  RANK_8, RANK_1, RANK_2, RANK_7
} from './bitboard';

import { bishopAttacks, rookAttacks, queenAttacks, KNIGHT_ATTACKS, KING_ATTACKS, CAMEL_ATTACKS } from './attacks';
import { WHITE_PAWN_ATTACKS, BLACK_PAWN_ATTACKS } from './attacks';
import { generateWhitePawnMoves, generateBlackPawnMoves } from './moveGen';

// ── Helpers ──────────────────────────────────────────────────────────────

function createMove(from: number, to: number, capture: boolean, overrides?: Partial<Move>): Move {
  return {
    from: toRC(from),
    to: toRC(to),
    capture,
    ...overrides
  };
}

// ── Individual Pixie Generators ──────────────────────────────────────────

function generateGoldenPawn(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  // Golden Pawn moves EXACTLY like a normal pawn, except promotion is an instant WIN.
  // Instead of rewriting pawn logic, we do standard bitboard pawn generation just for this square mask.
  const b = bit(pixie.sq);
  const empty = state.empty;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  if (pixie.color === 'w') {
    const wpSingle = (b >> 8n) & empty;
    const rank6Mask = 0x00FF000000000000n;
    const wpDouble = (((b & rank6Mask) >> 8n) & empty) >> 8n & empty;
    const wpCaptureLeft  = (b >> 9n) & enemies & NOT_FILE_H;
    const wpCaptureRight = (b >> 7n) & enemies & NOT_FILE_A;

    // For Golden Pawn, promotion is handled by the UI/ApplyMove instantly recognizing it reached rank 8.
    // So we do NOT output promotion: 'Q' strings. We just output a normal move.
    
    for (const to of iterBits(wpSingle)) moves.push(createMove(pixie.sq, to, false));
    for (const to of iterBits(wpDouble)) moves.push(createMove(pixie.sq, to, false));
    for (const to of iterBits(wpCaptureLeft)) moves.push(createMove(pixie.sq, to, true));
    for (const to of iterBits(wpCaptureRight)) moves.push(createMove(pixie.sq, to, true));
    
    // En Passant
    if (gameState.enPassant) {
      const fromRC = toRC(pixie.sq);
      if (Math.abs(fromRC[1] - gameState.enPassant[1]) === 1 && fromRC[0] - 1 === gameState.enPassant[0]) {
        moves.push(createMove(pixie.sq, sq(gameState.enPassant[0], gameState.enPassant[1]), true, { epCapSq: [fromRC[0], gameState.enPassant[1]] }));
      }
    }
  } else {
    const bpSingle = (b << 8n) & empty;
    const rank1Mask = 0x000000000000FF00n;
    const bpDouble = (((b & rank1Mask) << 8n) & empty) << 8n & empty;
    const bpCaptureLeft  = (b << 7n) & enemies & NOT_FILE_H;
    const bpCaptureRight = (b << 9n) & enemies & NOT_FILE_A;

    for (const to of iterBits(bpSingle)) moves.push(createMove(pixie.sq, to, false));
    for (const to of iterBits(bpDouble)) moves.push(createMove(pixie.sq, to, false));
    for (const to of iterBits(bpCaptureLeft)) moves.push(createMove(pixie.sq, to, true));
    for (const to of iterBits(bpCaptureRight)) moves.push(createMove(pixie.sq, to, true));

    // En Passant
    if (gameState.enPassant) {
      const fromRC = toRC(pixie.sq);
      if (Math.abs(fromRC[1] - gameState.enPassant[1]) === 1 && fromRC[0] + 1 === gameState.enPassant[0]) {
        moves.push(createMove(pixie.sq, sq(gameState.enPassant[0], gameState.enPassant[1]), true, { epCapSq: [fromRC[0], gameState.enPassant[1]] }));
      }
    }
  }
}

function generatePhaseRook(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const allTargets = rookAttacks(pixie.sq, ZERO);
  const normalTargets = rookAttacks(pixie.sq, state.occupied);
  
  const emptyTargets = allTargets & state.empty;
  for (const to of iterBits(emptyTargets)) {
    moves.push(createMove(pixie.sq, to, false));
  }
  
  const validCaptures = normalTargets & enemies;
  for (const to of iterBits(validCaptures)) {
    moves.push(createMove(pixie.sq, to, true));
  }
}

function generateBouncer(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Bouncer moves like a bishop, but "bounces" off the board edges once.
  // Actually, computing bounces via bitboards is complex because the ray changes direction.
  // Let's implement it using a simple 8x8 raycast loop since it's just one piece.
  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;

  for (const [dr, dc] of directions) {
    let currR = r + dr;
    let currC = c + dc;
    let hasBounced = false;
    let currentDr = dr;
    let currentDc = dc;

    while (true) {
      if (currR < 0 || currR > 7 || currC < 0 || currC > 7) {
        if (hasBounced) break;
        // Bounce!
        hasBounced = true;
        currR -= currentDr;
        currC -= currentDc;
        if (currR <= 0 || currR >= 7) currentDr = -currentDr;
        if (currC <= 0 || currC >= 7) currentDc = -currentDc;
        currR += currentDr;
        currC += currentDc;
        // Edge case: if we hit a corner perfectly, it bounces right back where it came from.
        if (currR < 0 || currR > 7 || currC < 0 || currC > 7) break; 
      }

      const s = sq(currR, currC);
      const b = bit(s);
      
      if ((b & friendly) !== ZERO || (b & state.invulnerable) !== ZERO) {
        break; // Blocked by friendly
      }
      
      if ((b & enemies) !== ZERO) {
        moves.push(createMove(pixie.sq, s, true));
        break; // Blocked by enemy (can capture)
      }
      
      moves.push(createMove(pixie.sq, s, false));
      
      currR += currentDr;
      currC += currentDc;
    }
  }
}

function generateIronpawn(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Ironpawn: Can move 1 square forward, and 2 squares on its first move. Cannot capture or promote.
  const b = bit(pixie.sq);
  
  if (pixie.color === 'w') {
    // White moves up (>> 8n)
    const targets = (b >> 8n) & state.empty & ~RANK_8; // Cannot enter promotion rank
    for (const to of iterBits(targets)) moves.push(createMove(pixie.sq, to, false));
    
    // Double push from Rank 2
    if ((b & RANK_2) !== ZERO && targets !== ZERO) {
      const doubleTargets = (targets >> 8n) & state.empty;
      for (const to of iterBits(doubleTargets)) moves.push(createMove(pixie.sq, to, false));
    }
  } else {
    // Black moves down (<< 8n)
    const targets = (b << 8n) & state.empty & ~RANK_1; // Cannot enter promotion rank
    for (const to of iterBits(targets)) moves.push(createMove(pixie.sq, to, false));
    
    // Double push from Rank 7
    if ((b & RANK_7) !== ZERO && targets !== ZERO) {
      const doubleTargets = (targets << 8n) & state.empty;
      for (const to of iterBits(doubleTargets)) moves.push(createMove(pixie.sq, to, false));
    }
  }
}

function generateWarAutomaton(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  // War Automaton generates standard pawn moves. The auto-advance is handled globally in applyMove.
  // To use the existing fast bitboard generators, we create a dummy state with just this pawn.
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, moves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, moves, gameState);
  }
}

function generateHordeling(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  const hordelingMoves: Move[] = [];
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, hordelingMoves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, hordelingMoves, gameState);
  }
  for (const m of hordelingMoves) {
    if (m.promotion) {
      // Only keep one move, without promotion
      if (m.promotion === 'Q') {
        m.promotion = undefined;
        moves.push(m);
      }
    } else {
      moves.push(m);
    }
  }
}
function generateFissionReactor(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Fission Reactor moves exactly like a standard Queen.
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const targets = queenAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
}

function generateHordeMother(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Horde Mother moves exactly like a standard Bishop.
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const targets = bishopAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    if (isCapture) {
      let spawnGenerated = false;
      // Scan every empty square on the entire board for possible spawn locations
      for (let sr = 0; sr < 8; sr++) {
        for (let sc = 0; sc < 8; sc++) {
          const spawnSq = (sr << 3) | sc;
          if ((bit(spawnSq) & state.occupied) === ZERO) {
            moves.push(createMove(pixie.sq, to, true, { hordeSpawn: [sr, sc] }));
            spawnGenerated = true;
          }
        }
      }
      if (!spawnGenerated) {
        moves.push(createMove(pixie.sq, to, true));
      }
    } else {
      moves.push(createMove(pixie.sq, to, false));
    }
  }
}

function generateNonCapturingBishop(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Used for Icicle and Basilisk: Bishop moves but NO captures allowed.
  const targets = bishopAttacks(pixie.sq, state.occupied) & state.empty;
  for (const to of iterBits(targets)) moves.push(createMove(pixie.sq, to, false));
}

function generateAntiViolence(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  // Anti-Violence: Standard Knight moves ONLY — no captures.
  const targets = KNIGHT_ATTACKS[pixie.sq] & state.empty;
  for (const to of iterBits(targets)) moves.push(createMove(pixie.sq, to, false));
}

function generateShrike(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[], gameState: GameState): void {
  // Delegate to standard pawn for normal forward moves, double push to empty, diagonal captures, en passant, promotion
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, moves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, moves, gameState);
  }

  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  const dir = pixie.color === 'w' ? -1 : 1;
  const startRow = pixie.color === 'w' ? 6 : 1;
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // First move 2 steps forward (capturing)
  if (!pixie.pieceState?.has_moved && r === startRow) {
    const midR = r + dir;
    const toR = r + 2 * dir;
    const midSq = (midR << 3) | c;
    const toSq = (toR << 3) | c;
    
    const midHasEnemy = (bit(midSq) & enemies) !== ZERO;
    const toHasEnemy = (bit(toSq) & enemies) !== ZERO;
    const midHasPiece = (bit(midSq) & state.occupied) !== ZERO;
    const toHasPiece = (bit(toSq) & state.occupied) !== ZERO;
    
    if ((bit(toSq) & friendly) === ZERO) {
      if (midHasEnemy && !toHasPiece) {
        // Capture jumped piece
        moves.push(createMove(pixie.sq, toSq, true, { shrikePath: toRC(midSq) }));
      } else if (toHasEnemy && !midHasPiece) {
        // Normal capture on the destination square
        moves.push(createMove(pixie.sq, toSq, true));
      }
    }
  }
}

function generateKnightmare(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const tr = r + dr, tc = c + dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) {
      if (tr >= -2 && tr <= 9 && tc >= -2 && tc <= 9) {
        let enemyObFound = false;
        let allyObFound = false;
        for (const otherOb of (gameState.offBoardPieces || [])) {
          if (otherOb.obSq[0] === tr && otherOb.obSq[1] === tc) {
            if (otherOb.piece.color !== pixie.color) enemyObFound = true;
            else allyObFound = true;
          }
        }
        if (!allyObFound) {
          if (enemyObFound) {
            moves.push(createMove(pixie.sq, 0, true, { obJump: true, to: [tr, tc], obCapSq: [tr, tc] }));
          } else {
            moves.push(createMove(pixie.sq, 0, false, { obJump: true, to: [tr, tc] }));
          }
        }
      }
    } else {
      const toSq = (tr << 3) | tc;
      const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
      if ((bit(toSq) & friendly) === ZERO) {
        const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
        const isCapture = (bit(toSq) & enemies) !== ZERO;
        moves.push(createMove(pixie.sq, toSq, isCapture));
      }
    }
  }
}

function generateBladerunner(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let cr = r + dr, cc = c + dc;
    const passed: [number, number][] = [];
    while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
      const targetSq = (cr << 3) | cc;
      const targetBit = bit(targetSq);
      
      if ((targetBit & friendly) !== ZERO || (targetBit & state.invulnerable) !== ZERO) break;
      
      if ((targetBit & enemies) !== ZERO) {
        passed.push([cr, cc]);
      } else {
        moves.push(createMove(pixie.sq, targetSq, false, { bladeThru: [...passed] }));
      }
      
      cr += dr; cc += dc;
    }
  }
}

function generateMarauder(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  const range = 1 + ((pixie.pieceState?.kill_count || 0) * 2);
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= range; step++) {
      const cr = r + dr * step;
      const cc = c + dc * step;
      if (cr < 0 || cr > 7 || cc < 0 || cc > 7) break;
      
      const targetSq = (cr << 3) | cc;
      const targetBit = bit(targetSq);
      
      if ((targetBit & friendly) !== ZERO || (targetBit & state.invulnerable) !== ZERO) {
        break;
      } else if ((targetBit & enemies) !== ZERO) {
        moves.push(createMove(pixie.sq, targetSq, true));
        break;
      } else {
        moves.push(createMove(pixie.sq, targetSq, false));
      }
    }
  }
}

function generateSumoRook(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const r = rankOf(pixie.sq);
  const c = fileOf(pixie.sq);
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let cr = r + dr, cc = c + dc;
    const rayEmptySqs: number[] = [];
    let foundPieceRC: [number, number] | null = null;
    
    while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
      const targetSq = (cr << 3) | cc;
      const targetBit = bit(targetSq);
      
      if ((targetBit & state.invulnerable) !== ZERO) {
         break;
      }
      
      if ((targetBit & state.occupied) !== ZERO) {
         const pType = state.activePixies.find(p => p.sq === targetSq)?.type;
         if (pType === 'IRONPAWN') {
            break; // Cannot push Ironpawns
         }
         foundPieceRC = [cr, cc];
         break;
      }
      
      rayEmptySqs.push(targetSq);
      cr += dr; cc += dc;
    }
    
    if (foundPieceRC) {
      const [er, ec] = foundPieceRC;
      let pushOverrides: any = null;
      
      let piecesToPush: [number, number][] = [[er, ec]];
      let checkR = er + dr;
      let checkC = ec + dc;
      
      while (checkR >= 0 && checkR <= 7 && checkC >= 0 && checkC <= 7) {
        const sq = (checkR << 3) | checkC;
        if ((bit(sq) & state.occupied) !== ZERO) {
          piecesToPush.push([checkR, checkC]);
          if (piecesToPush.length === 3) break; 
        } else {
          break; 
        }
        checkR += dr;
        checkC += dc;
      }
      
      if (piecesToPush.length <= 2) {
        let p1 = piecesToPush[0];
        let p2 = piecesToPush.length > 1 ? piecesToPush[1] : null;
        
        let afterR = (p2 ? p2[0] : p1[0]) + dr;
        let afterC = (p2 ? p2[1] : p1[1]) + dc;
        
        let slideDist = 0;
        let blocked = false;
        
        while (afterR >= 0 && afterR <= 7 && afterC >= 0 && afterC <= 7) {
            const sq = (afterR << 3) | afterC;
            if ((bit(sq) & state.occupied) !== ZERO) {
                blocked = true;
                break;
            }
            slideDist++;
            afterR += dr;
            afterC += dc;
        }
        
        let isPawnVariant = (sq: number) => {
            if ((bit(sq) & (state.whitePawns | state.blackPawns)) !== ZERO) return true;
            const pType = state.activePixies.find(p => p.sq === sq)?.type;
            return pType ? ['GOLDEN_PAWN', 'IRONPAWN', 'BLUEPRINT', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WAR_AUTOMATON', 'HORDELING'].includes(pType) : false;
        };
        let isColor = (sq: number, c: 'w'|'b') => ((bit(sq) & (c === 'w' ? state.whiteAll : state.blackAll)) !== ZERO);

        let sq1 = (p1[0] << 3) | p1[1];
        let isOwnForward1 = isPawnVariant(sq1) && isColor(sq1, pixie.color) && ((pixie.color === 'w' && dr === -1) || (pixie.color === 'b' && dr === 1));
        if (isOwnForward1) {
            let distToEdge = pixie.color === 'w' ? p1[0] - 1 : 6 - p1[0];
            if (distToEdge < slideDist) slideDist = distToEdge;
        }

        if (p2) {
            let sq2 = (p2[0] << 3) | p2[1];
            let isOwnForward2 = isPawnVariant(sq2) && isColor(sq2, pixie.color) && ((pixie.color === 'w' && dr === -1) || (pixie.color === 'b' && dr === 1));
            if (isOwnForward2) {
                let distToEdge = pixie.color === 'w' ? p2[0] - 1 : 6 - p2[0];
                if (distToEdge < slideDist) slideDist = distToEdge;
            }
        }
        
        if (slideDist > 0) {
            let f1R = p1[0] + dr * slideDist;
            let f1C = p1[1] + dc * slideDist;
            if (p2) {
                let f2R = p2[0] + dr * slideDist;
                let f2C = p2[1] + dc * slideDist;
                pushOverrides = { push: [f1R, f1C], pushFrom: p1, push2: [f2R, f2C], push2From: p2 };
            } else {
                pushOverrides = { push: [f1R, f1C], pushFrom: p1 };
            }
        } else {
            if (!blocked) {
                if (p2) {
                    pushOverrides = { push: [p2[0], p2[1]], pushFrom: p1, pushFalloff: p2 };
                } else {
                    pushOverrides = { pushFalloff: p1, pushFrom: p1 };
                }
            } else {
                pushOverrides = null;
            }
        }
      }
      
      if (pushOverrides && rayEmptySqs.length > 0) {
         // Add all empty squares as normal moves EXCEPT the last one
         for (let i = 0; i < rayEmptySqs.length - 1; i++) {
            moves.push(createMove(pixie.sq, rayEmptySqs[i], false));
         }
         // The last empty square is the one that triggers the push
         const contactSq = rayEmptySqs[rayEmptySqs.length - 1];
         moves.push(createMove(pixie.sq, contactSq, false, pushOverrides));
      } else {
         for (const sq of rayEmptySqs) moves.push(createMove(pixie.sq, sq, false));
      }
      
    } else {
      for (const sq of rayEmptySqs) moves.push(createMove(pixie.sq, sq, false));
    }
  }
}

function generateRocketman(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // Standard king attacks
  const stdTargets = KING_ATTACKS[pixie.sq] & ~friendly & ~state.invulnerable;
  for (const to of iterBits(stdTargets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
  
  // Teleport to empty squares if unused
  if (!pixie.pieceState?.used_rocket) {
    for (const to of iterBits(state.empty)) {
      moves.push(createMove(pixie.sq, to, false, { rocket: true }));
    }
  }
}

function generateCardinal(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // Standard bishop
  const targets = bishopAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
  
  // Single backwards step
  const b = bit(pixie.sq);
  const backStep = pixie.color === 'w' ? (b << 8n) : (b >> 8n);
  const validBackStep = backStep & state.empty;
  for (const to of iterBits(validBackStep)) {
    moves.push(createMove(pixie.sq, to, false));
  }
}

function generateElectroknight(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  const isCharged = pixie.pieceState?.is_charged === true;
  
  const targets = KNIGHT_ATTACKS[pixie.sq] & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    if (isCapture) {
      moves.push(createMove(pixie.sq, to, true, { lightning: isCharged ? true : undefined }));
    } else {
      moves.push(createMove(pixie.sq, to, false));
    }
  }
}

function generateDjinn(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  if (pixie.pieceState?.dissipated) return;
  
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // Standard bishop
  const targets = bishopAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
  
  // Self dissipation
  moves.push(createMove(pixie.sq, pixie.sq, false, { dissipate: true }));
}

function generateHeroPawn(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, moves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, moves, gameState);
  }
}

function generateStandardKnight(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const targets = KNIGHT_ATTACKS[pixie.sq] & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
}

function generateStandardBishop(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  const targets = bishopAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
}

function generateFishKnight(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // Standard Knight attacks
  const targets = KNIGHT_ATTACKS[pixie.sq] & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
  
  // Bonus king-step if moved last turn
  if (pixie.pieceState?.moved_last_turn) {
    const bonusTargets = KING_ATTACKS[pixie.sq] & state.empty;
    for (const to of iterBits(bonusTargets)) {
      moves.push(createMove(pixie.sq, to, false, { fishBonus: true }));
    }
  }
}

function generateCamel(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  const targets = CAMEL_ATTACKS[pixie.sq] & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
}

function generateGunslinger(pixie: { sq: number, color: 'w' | 'b', pieceState?: any }, state: BitboardState, moves: Move[]): void {
  const friendly = pixie.color === 'w' ? state.whiteAll : state.blackAll;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  // Standard bishop attacks
  const targets = bishopAttacks(pixie.sq, state.occupied) & ~friendly & ~state.invulnerable;
  for (const to of iterBits(targets)) {
    const isCapture = (bit(to) & enemies) !== ZERO;
    moves.push(createMove(pixie.sq, to, isCapture));
  }
  
  // Mutual target duel capture
  if (pixie.pieceState?.mutual_target && (pixie.pieceState.mutual_ply || 0) >= 2) {
    moves.push(createMove(pixie.sq, pixie.sq, true, { duel: true }));
  }
}

function generateEpeePawn(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  // Delegate to standard pawn
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, moves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, moves, gameState);
  }
  
  // Cross-board en-passant sniper logic!
  // Epee Pawn can globally capture ANY enemy pawn that just double-pushed (2 squares forward).
  if (gameState.lastMove) {
    const lm = gameState.lastMove;
    const rowDiff = Math.abs(lm.from[0] - lm.to[0]);
    const isDoublePush = rowDiff === 2;
    const isSameColumn = lm.from[1] === lm.to[1];
    
    if (isDoublePush && isSameColumn) {
      const enemyColor = pixie.color === 'w' ? 'b' : 'w';
      const targetSq = sq(lm.to[0], lm.to[1]);
      
      // Verify the piece that moved is actually an enemy pawn!
      // Check both standard pawns AND pixie pawns with pawn base type.
      const enemyStdPawns = pixie.color === 'w' ? state.blackPawns : state.whitePawns;
      const isStdPawn = (bit(targetSq) & enemyStdPawns) !== ZERO;
      const isPixiePawn = state.activePixies.some(
        ap => ap.sq === targetSq && ap.color === enemyColor && 
              ['EPEE_PAWN','GOLDEN_PAWN','IRONPAWN','HERO_PAWN','SHRIKE','WARP_JUMPER','WAR_AUTOMATON','PAWN_KNIFE','BLUEPRINT'].includes(ap.type)
      );
      
      if (isStdPawn || isPixiePawn) {
        // The en passant landing square is the square the pawn skipped over (midpoint)
        const epSquareR = (lm.from[0] + lm.to[0]) / 2;
        const epSquareC = lm.to[1];
        
        // Check if already added by standard pawn EP logic
        const alreadyAdded = moves.some(m => m.epCapSq && m.epCapSq[0] === lm.to[0] && m.epCapSq[1] === lm.to[1]);
        if (!alreadyAdded) {
          const toSq = sq(epSquareR, epSquareC);
          moves.push(createMove(pixie.sq, toSq, true, { epCapSq: [lm.to[0], lm.to[1]] }));
        }
      }
    }
  }
}

function generatePawnKnife(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  // Delegate to standard pawn
  const dummyState = { ...state, whitePawns: ZERO, blackPawns: ZERO };
  if (pixie.color === 'w') {
    dummyState.whitePawns = bit(pixie.sq);
    generateWhitePawnMoves(dummyState, moves, gameState);
  } else {
    dummyState.blackPawns = bit(pixie.sq);
    generateBlackPawnMoves(dummyState, moves, gameState);
  }
  
  // Knife captures
  const dir = pixie.color === 'w' ? -1 : 1;
  const promoRow = pixie.color === 'w' ? 0 : 7;
  const pr = Math.floor(pixie.sq / 8);
  const pc = pixie.sq % 8;
  const extendedR = pr + (2 * dir);
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  
  for (const dc of [-2, 2]) {
    const cc = pc + dc;
    if (extendedR >= 0 && extendedR <= 7 && cc >= 0 && cc <= 7) {
      const intermediateSq = sq(pr + dir, pc + (dc / 2));
      if ((bit(intermediateSq) & state.empty) !== ZERO) {
        const targetSq = sq(extendedR, cc);
        if ((bit(targetSq) & enemies) !== ZERO) {
          // Center files are 3 and 4.
          // dc < 0 means jumping left. For a left jump to move TOWARD the center, starting file (pc) must be > 3.
          // dc > 0 means jumping right. For a right jump to move TOWARD the center, starting file (pc) must be < 4.
          const towardCenter = dc < 0 ? pc > 3 : pc < 4;
          if (towardCenter) {
            if (extendedR === promoRow) {
              moves.push(createMove(pixie.sq, targetSq, true, { promotion: 'Q' }));
              moves.push(createMove(pixie.sq, targetSq, true, { promotion: 'R' }));
              moves.push(createMove(pixie.sq, targetSq, true, { promotion: 'B' }));
              moves.push(createMove(pixie.sq, targetSq, true, { promotion: 'N' }));
            } else {
              moves.push(createMove(pixie.sq, targetSq, true));
            }
          }
        }
      }
    }
  }
}

function generateWarpJumper(pixie: { sq: number, color: 'w' | 'b' }, state: BitboardState, moves: Move[], gameState: GameState): void {
  const b = bit(pixie.sq);
  const startRowMask = pixie.color === 'w' ? RANK_2 : RANK_7;
  const promoRowMask = pixie.color === 'w' ? RANK_8 : RANK_1;
  const enemies = (pixie.color === 'w' ? state.blackAll : state.whiteAll) & ~state.invulnerable;
  const allPawns = state.whitePawns | state.blackPawns;
  const pixiePawnsMask = state.activePixies
    .filter(p => ['GOLDEN_PAWN', 'IRONPAWN', 'BLUEPRINT', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON'].includes(p.type))
    .reduce((mask, p) => mask | bit(p.sq), ZERO);
  const allPawnsAndPixies = allPawns | pixiePawnsMask;
  
  const pushMove = (toSq: number, extra: any = {}) => {
    if ((bit(toSq) & promoRowMask) !== ZERO) {
      for (const p of ['Q','R','B','N'] as const) moves.push(createMove(pixie.sq, toSq, false, { promotion: p, ...extra }));
    } else {
      moves.push(createMove(pixie.sq, toSq, false, extra));
    }
  };

  // 1. Single push & Warp
  const push1 = pixie.color === 'w' ? b >> 8n : b << 8n;
  if ((push1 & state.empty) !== ZERO) {
    for (const to of iterBits(push1)) pushMove(to);
    
    // 2. Double push from start
    if ((b & startRowMask) !== ZERO) {
      const push2 = pixie.color === 'w' ? push1 >> 8n : push1 << 8n;
      if ((push2 & state.empty) !== ZERO) {
        for (const to of iterBits(push2)) pushMove(to);
      }
    }
  } else if ((push1 & allPawnsAndPixies) !== ZERO) {
    // Blocked by a pawn! We can jump over it, and potentially multiple pawns!
    let jumpCursor = push1;
    let jumpedThru = [toRC(lsb(push1))];
    while (true) {
      jumpCursor = pixie.color === 'w' ? jumpCursor >> 8n : jumpCursor << 8n;
      if (jumpCursor === ZERO) break; // Off board
      if ((jumpCursor & state.empty) !== ZERO) {
        // Landed on empty square!
        pushMove(lsb(jumpCursor), { warpThru: jumpedThru });
        break;
      } else if ((jumpCursor & allPawnsAndPixies) !== ZERO) {
        // Another pawn, keep jumping
        jumpedThru.push(toRC(lsb(jumpCursor)));
      } else {
        // Blocked by non-pawn
        break;
      }
    }
  }
  
  // 3. Captures
  const attacks = pixie.color === 'w' ? WHITE_PAWN_ATTACKS[pixie.sq] : BLACK_PAWN_ATTACKS[pixie.sq];
  const validCaps = attacks & enemies;
  for (const to of iterBits(validCaps)) {
    if ((bit(to) & promoRowMask) !== ZERO) {
      for (const p of ['Q','R','B','N'] as const) moves.push(createMove(pixie.sq, to, true, { promotion: p }));
    } else {
      moves.push(createMove(pixie.sq, to, true));
    }
  }
  
  // 4. En Passant
  if (gameState.enPassant) {
    const epSq = sq(gameState.enPassant[0], gameState.enPassant[1]);
    if ((bit(epSq) & attacks) !== ZERO) {
      const epCapR = gameState.enPassant[0] + (pixie.color === 'w' ? 1 : -1);
      moves.push(createMove(pixie.sq, epSq, true, { epCapSq: [epCapR, gameState.enPassant[1]] }));
    }
  }
}

// ── Main Export ──────────────────────────────────────────────────────────

export function generatePixieMoves(state: BitboardState, color: 'w' | 'b', gameState: GameState): Move[] {
  const moves: Move[] = [];
  
  for (const pixie of state.activePixies) {
    if (pixie.color !== color) continue;
    
    switch (pixie.type) {
      case 'GOLDEN_PAWN':
        generateGoldenPawn(pixie, state, moves, gameState);
        break;
      case 'PHASE_ROOK':
        generatePhaseRook(pixie, state, moves);
        break;
      case 'BOUNCER':
        generateBouncer(pixie, state, moves);
        break;
      case 'IRONPAWN':
        generateIronpawn(pixie, state, moves);
        break;
      case 'WAR_AUTOMATON':
        generateWarAutomaton(pixie, state, moves, gameState);
        break;
      case 'HORDELING':
        generateHordeling(pixie, state, moves, gameState);
        break;
      case 'FISSION_REACTOR':
        generateFissionReactor(pixie, state, moves);
        break;
      case 'HORDE_MOTHER':
        generateHordeMother(pixie, state, moves);
        break;
      case 'ICICLE':
      case 'BASILISK':
        generateNonCapturingBishop(pixie, state, moves);
        break;
      case 'ANTI_VIOLENCE':
        generateAntiViolence(pixie, state, moves);
        break;
      case 'ROCKETMAN':
        generateRocketman(pixie, state, moves);
        break;
      case 'CARDINAL':
        generateCardinal(pixie, state, moves);
        break;
      case 'ELECTROKNIGHT':
        generateElectroknight(pixie, state, moves);
        break;
      case 'DJINN':
        generateDjinn(pixie, state, moves);
        break;
      case 'HERO_PAWN':
      case 'BLUEPRINT':
        generateHeroPawn(pixie, state, moves, gameState); // Re-use the pawn wrapper logic
        break;
      case 'BANKER':
      case 'PINATA':
        generateStandardKnight(pixie, state, moves);
        break;
      case 'PILGRIM':
      case 'ARISTOCRAT':
        generateStandardBishop(pixie, state, moves);
        break;
      case 'DANCER':
        if (pixie.pieceState?.bonus_moves > 0) {
          generateNonCapturingBishop(pixie, state, moves);
        } else {
          generateStandardBishop(pixie, state, moves);
        }
        break;
      case 'FISH_KNIGHT':
        generateFishKnight(pixie, state, moves);
        break;
      case 'CAMEL':
        generateCamel(pixie, state, moves);
        break;
      case 'GUNSLINGER':
        generateGunslinger(pixie, state, moves);
        break;
      case 'EPEE_PAWN':
        generateEpeePawn(pixie, state, moves, gameState);
        break;
      case 'PAWN_KNIFE':
        generatePawnKnife(pixie, state, moves, gameState);
        break;
      case 'WARP_JUMPER':
        generateWarpJumper(pixie, state, moves, gameState);
        break;
      case 'SHRIKE':
        generateShrike(pixie, state, moves, gameState);
        break;
      case 'KNIGHTMARE':
        generateKnightmare(pixie, state, moves, gameState);
        break;
      case 'BLADERUNNER':
        generateBladerunner(pixie, state, moves);
        break;
      case 'MARAUDER':
        generateMarauder(pixie, state, moves);
        break;
      case 'SUMOROOK':
        generateSumoRook(pixie, state, moves);
        break;
    }
  }

  return moves;
}
