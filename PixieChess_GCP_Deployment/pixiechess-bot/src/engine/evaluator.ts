import type { Board, GameState, Piece } from './types';
import { PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_QUEEN, PST_KING_MG, PST_KING_EG } from '../data/pst';
import { hasAristocrat, inBounds } from './utils';

const WEIGHTS = {
  MATERIAL: 1.0,
  PST: 0.3,
  STRUCTURE: 0.4,
  SAFETY: 0.5,
  ABILITY: 0.5,
  THREAT: 0.4,
  WIN_COND: 2.0,
  EV: 0.6
};

function getBaseMaterial(piece: Piece): number {
  if (piece.pixie === 'DJINN' && piece.state?.dissipated) return 0.0;

  if (piece.pixie) {
    switch (piece.pixie) {
      case 'WAR_AUTOMATON': return 12.0;
      case 'HORDE_MOTHER': return 7.0;
      case 'SUMOROOK': return 5.5;
      case 'PHASE_ROOK': return 5.0;
      case 'PINATA': return 4.0;
      case 'CARDINAL': return 3.5;
      case 'KNIGHTMARE': return 3.5;
      case 'DANCER': return 3.5;
      case 'GUNSLINGER': return 3.5;
      case 'BLADERUNNER': return 3.5;
      case 'FISH_KNIGHT': return 3.2;
      case 'ANTI_VIOLENCE': return 3.0;
      case 'BOUNCER': return 3.0;
      case 'WARP_JUMPER': return 3.0;
      case 'CAMEL': return 3.0;
      case 'MARAUDER': return 3.0 + ((piece.state?.kill_count || 0) * 1.0);
      case 'HERO_PAWN': return 1.5;
      case 'EPEE_PAWN': return 1.2;
      case 'PAWN_KNIFE': return 1.2;
      case 'GOLDEN_PAWN': return 1.0;
      case 'BLUEPRINT': return 1.0;
      case 'IRONPAWN': return 0.8;
      // Other pixies use their base piece type logic below if not explicitly matched here
    }
  }

  switch (piece.type) {
    case 'P': return 1.0;
    case 'N': return 3.0;
    case 'B': return 3.2;
    case 'R': return 5.0;
    case 'Q': return 9.0;
    case 'K': return 100.0;
    default: return 0.0;
  }
}

function getPST(piece: Piece, r: number, c: number, board: Board, gamePhase: number): number {
  // Flip row for black
  const pstR = piece.color === 'w' ? r : 7 - r;

  // Standard pieces
  if (piece.type === 'P' && !piece.pixie) return PST_PAWN[pstR][c];
  if (piece.type === 'N' && !piece.pixie) return PST_KNIGHT[pstR][c];
  if (piece.type === 'B' && !piece.pixie) return PST_BISHOP[pstR][c];
  if (piece.type === 'Q' && !piece.pixie) return PST_QUEEN[pstR][c];
  if (piece.type === 'K' && !piece.pixie) {
    const mg = PST_KING_MG[pstR][c];
    const eg = PST_KING_EG[pstR][c];
    return (mg * gamePhase) + (eg * (1.0 - gamePhase));
  }

  // Rooks get bonus on open files
  if (piece.type === 'R' && !piece.pixie) {
    let openFileBonus = 1.0;
    for (let row = 0; row < 8; row++) {
      if (row !== r && board[row][c]?.type === 'P') {
        openFileBonus = 0;
        break;
      }
    }
    return openFileBonus;
  }

  if (piece.pixie === 'ANTI_VIOLENCE') {
    return (c === 3 || c === 4) ? 1.5 : 0;
  }

  if (piece.pixie === 'ICICLE') {
    let enemyCount = 0;
    for (let i = 0; i < 8; i++) {
      if (board[r][i]?.color !== piece.color && board[r][i] !== null) enemyCount++;
      if (board[i][c]?.color !== piece.color && board[i][c] !== null) enemyCount++;
    }
    return enemyCount * 0.2;
  }

  // Center control bonus for mobile power pieces
  if (piece.type !== 'P' && piece.pixie) {
    let centerBonus = 0;
    
    // The "sweet spot" center is r:3,4 and c:3,4
    if ((r === 3 || r === 4) && (c === 3 || c === 4)) centerBonus += 1.5;
    // The outer center ring is r:2,5 and c:2,5
    else if (r >= 2 && r <= 5 && c >= 2 && c <= 5) centerBonus += 0.5;

    // High impact pieces get double center bonus
    if (['WAR_AUTOMATON', 'GUNSLINGER', 'SHRIKE', 'HORDE_MOTHER', 'BANKER', 'PINATA'].includes(piece.pixie)) {
      centerBonus *= 2.0;
    }

    return centerBonus;
  }

  return 0;
}

function evaluatePawnStructure(r: number, c: number, piece: Piece, board: Board): number {
  let score = 0;
  const color = piece.color;
  
  let isDoubled = false;
  let isIsolated = true;
  let isPassed = true;

  for (let row = 0; row < 8; row++) {
    // Check own file
    if (row !== r && board[row][c]?.type === 'P' && board[row][c]?.color === color) {
      isDoubled = true;
    }
    
    // Check for enemy pawns blocking or attacking
    if (color === 'w' && row < r) {
      if (board[row][c]?.type === 'P' && board[row][c]?.color === 'b') isPassed = false;
      if (c > 0 && board[row][c-1]?.type === 'P' && board[row][c-1]?.color === 'b') isPassed = false;
      if (c < 7 && board[row][c+1]?.type === 'P' && board[row][c+1]?.color === 'b') isPassed = false;
    } else if (color === 'b' && row > r) {
      if (board[row][c]?.type === 'P' && board[row][c]?.color === 'w') isPassed = false;
      if (c > 0 && board[row][c-1]?.type === 'P' && board[row][c-1]?.color === 'w') isPassed = false;
      if (c < 7 && board[row][c+1]?.type === 'P' && board[row][c+1]?.color === 'w') isPassed = false;
    }

    // Check adjacent files for friendly pawns
    if (c > 0 && board[row][c-1]?.type === 'P' && board[row][c-1]?.color === color) isIsolated = false;
    if (c < 7 && board[row][c+1]?.type === 'P' && board[row][c+1]?.color === color) isIsolated = false;
  }

  if (isDoubled) score -= 1.0;
  if (isIsolated) score -= 1.5;
  
  if (isPassed) {
    const rankProg = color === 'w' ? 7 - r : r;
    score += (rankProg * rankProg) * 0.5; // Massive scaling bonus as it pushes
  }

  return score;
}

function evaluateKingSafety(r: number, c: number, piece: Piece, board: Board, gamePhase: number): number {
  let score = 0;
  const color = piece.color;
  const enemyColor = color === 'w' ? 'b' : 'w';
  const dir = color === 'w' ? -1 : 1;

  if (gamePhase < 0.3) return 0; // Don't evaluate safety heavily in endgame

  // 1. Pawn Shield
  let shieldPawns = 0;
  const shieldRow = r + dir;
  if (inBounds(shieldRow, 0)) {
    for (let dc = -1; dc <= 1; dc++) {
      if (inBounds(shieldRow, c + dc)) {
        const p = board[shieldRow][c + dc];
        if (p?.color === color && p.type === 'P') shieldPawns++;
      }
    }
  }
  if (shieldPawns === 0) score -= 3.0;
  else if (shieldPawns === 1) score -= 1.0;
  else if (shieldPawns >= 2) score += 1.5;

  // 2. Open Files near king
  for (let file = Math.max(0, c - 1); file <= Math.min(7, c + 1); file++) {
    let hasOwnPawn = false;
    let hasEnemyPawn = false;
    for (let row = 0; row < 8; row++) {
      const p = board[row][file];
      if (p?.type === 'P') {
        if (p.color === color) hasOwnPawn = true;
        else hasEnemyPawn = true;
      }
    }
    if (!hasOwnPawn && !hasEnemyPawn) score -= 2.0;
    else if (!hasOwnPawn && hasEnemyPawn) score -= 1.0;
  }

  // 3. Enemy Proximity
  let enemyPower = 0;
  for (let er = Math.max(0, r - 2); er <= Math.min(7, r + 2); er++) {
    for (let ec = Math.max(0, c - 2); ec <= Math.min(7, c + 2); ec++) {
      const p = board[er][ec];
      if (p?.color === enemyColor && p.type !== 'P') {
        enemyPower += getBaseMaterial(p);
      }
    }
  }
  if (enemyPower > 10) score -= (enemyPower * 0.2);

  return score * gamePhase;
}

export function evaluate(board: Board, gameState: GameState): number {
  let material = 0;
  let pst = 0;
  let structure = 0;
  let safety = 0;
  let ability = 0;
  let threat = 0;
  let winCond = 0;
  let ev = 0;

  // Calculate total non-pawn material to determine Game Phase (1.0 = Midgame, 0.0 = Endgame)
  let nonPawnMaterial = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type !== 'P' && p.type !== 'K') nonPawnMaterial += getBaseMaterial(p);
    }
  }
  // Standard opening non-pawn material is roughly 24 per side (total 48)
  const gamePhase = Math.min(1.0, Math.max(0.0, nonPawnMaterial / 30.0));

  const wAristocratAlive = hasAristocrat(board, 'w');
  const bAristocratAlive = hasAristocrat(board, 'b');

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const sign = piece.color === 'w' ? 1 : -1;
      const enemyColor = piece.color === 'w' ? 'b' : 'w';

      // 1. Material
      material += sign * getBaseMaterial(piece);

      // 2. PST
      pst += sign * getPST(piece, r, c, board, gamePhase);

      // 3. Pawn Structure
      if (piece.type === 'P') {
        structure += sign * evaluatePawnStructure(r, c, piece, board);
      }

      // 4. King Safety
      if (piece.type === 'K') {
        safety += sign * evaluateKingSafety(r, c, piece, board, gamePhase);
      }

      // 5. Ability State Bonuses
      if (piece.pixie === 'ELECTROKNIGHT') {
        if (piece.state?.is_charged) ability += sign * 3.0;
        else ability += sign * ((piece.state?.consec_moves || 0) * 0.7);
      }
      else if (piece.pixie === 'BASILISK') {
        // Double-counted here and in threats
        const paralyzedCount = gameState.paralyzed[enemyColor].length;
        ability += sign * (paralyzedCount * 1.5);
        threat += sign * (paralyzedCount * 1.5);
      }
      else if (piece.pixie === 'ICICLE') {
        const frozenCount = gameState.frozen.filter(f => board[f.square[0]][f.square[1]]?.color === enemyColor).length;
        ability += sign * (frozenCount * 1.5);
      }
      else if (piece.pixie === 'ANTI_VIOLENCE') {
        if (c === 3 || c === 4 || r === 3 || r === 4) ability += sign * 1.5;
      }
      else if (piece.pixie === 'ARISTOCRAT') {
        ability += sign * 2.5;
      }
      else if (piece.pixie === 'PILGRIM') {
        const dist = piece.state?.total_dist || 0;
        if (dist >= 15 && !piece.state?.resurrected) ability += sign * 3.0;
        if (dist >= 18 && !piece.state?.resurrected) winCond += sign * 4.0;
      }
      else if (piece.pixie === 'FISSION_REACTOR') {
        const capturesDone = piece.state?.capture_count || 0;
        const movesLeft = 5 - capturesDone;
        ability += sign * (-movesLeft * 0.5);

        if (capturesDone === 4) {
          let adjEnemy = 0;
          let expectedEnemyDestruction = 0;

          // Only count enemy pieces at diagonal distance 1 — friendly pieces are safe from the blast
          for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const er = r + dr, ec = c + dc;
            if (inBounds(er, ec)) {
              const target = board[er][ec];
              if (target && target.color === enemyColor && !target.invulnerable) {
                adjEnemy++;
                expectedEnemyDestruction += getBaseMaterial(target);
              }
            }
          }

          ability += sign * (adjEnemy * 2.0);
          ev += sign * expectedEnemyDestruction;
        }
      }
      else if (piece.pixie === 'GOLDEN_PAWN') {
        const rankProg = piece.color === 'w' ? 7 - r : r;
        winCond += sign * (rankProg * 5.0);
        if (rankProg === 6) winCond += sign * 15.0;

        // Aristocrat block
        if ((piece.color === 'w' && bAristocratAlive) || (piece.color === 'b' && wAristocratAlive)) {
          winCond += sign * -8.0;
        }
      }
      else if (piece.pixie === 'BANKER') {
        let enemyPawnsInRange = 0;
        const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of jumps) {
          const er = r + dr, ec = c + dc;
          if (inBounds(er, ec) && board[er][ec]?.color === enemyColor && board[er][ec]?.type === 'P') {
            enemyPawnsInRange++;
          }
        }
        threat += sign * (enemyPawnsInRange * 5.0);
        winCond += sign * (enemyPawnsInRange * 10.0); // double count
      }
      else if (piece.pixie === 'ROCKETMAN') {
        if (!piece.state?.used_rocket) {
          ev += sign * 1.5;
        }
      }
      else if (piece.pixie === 'SHRIKE') {
        const startRank = piece.color === 'w' ? 6 : 1;
        if (r === startRank && !piece.state?.has_moved) {
          ability += sign * 0.4;
        }
      }

      // Threat tracking for generic pawns vs enemy Banker
      if (piece.type === 'P' && piece.pixie !== 'GOLDEN_PAWN') {
        let enemyBankerInRange = false;
        const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of jumps) {
          const er = r + dr, ec = c + dc;
          if (inBounds(er, ec) && board[er][ec]?.color === enemyColor && board[er][ec]?.pixie === 'BANKER') {
            enemyBankerInRange = true;
            break;
          }
        }
        if (enemyBankerInRange) {
          threat += sign * -5.0;
        }
      }

      // Icicle freeze opportunity
      if (piece.pixie === 'ICICLE') {
        // Check adjacent squares for high-value targets to freeze
        let canFreezePowerPiece = false;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (const [dr, dc] of dirs) {
          const er = r + dr, ec = c + dc;
          if (inBounds(er, ec) && board[er][ec]?.color === enemyColor && board[er][ec]?.pixie) {
            canFreezePowerPiece = true;
            break;
          }
        }
        if (canFreezePowerPiece) {
          threat += sign * 2.0;
          ev += sign * 2.5;
        }
      }

      // New Custom Pieces Logic
      if (piece.pixie === 'GUNSLINGER') {
        if (piece.state?.mutual_target) {
          const [tr, tc] = piece.state.mutual_target;
          const targetPiece = board[tr][tc];
          if (targetPiece) {
            ev += sign * (getBaseMaterial(targetPiece) * 0.8);
          }
        }
      }
      else if (piece.pixie === 'SUMOROOK') {
        // Threaten pieces on the edge of the board (easy to push off)
        let edgeThreat = 0;
        for (let er = 0; er < 8; er++) {
          if (board[er][c]?.color === enemyColor) {
            if (er === 0 || er === 7) edgeThreat += 3.0;
            else edgeThreat += 0.5;
          }
        }
        for (let ec = 0; ec < 8; ec++) {
          if (board[r][ec]?.color === enemyColor) {
            if (ec === 0 || ec === 7) edgeThreat += 3.0;
            else edgeThreat += 0.5;
          }
        }
        threat += sign * edgeThreat;
      }
      else if (piece.pixie === 'HORDE_MOTHER') {
        const liveHordelings = (piece.state?.hordeling_ids || []).length;
        ability += sign * (liveHordelings * 1.0);
      }
      else if (piece.pixie === 'DANCER') {
        if (piece.state?.active_flag) ability += sign * 4.0;
      }
      else if (piece.pixie === 'FISH_KNIGHT') {
        if (piece.state?.moved_last_turn) ability += sign * 1.5;
      }
      else if (piece.pixie === 'PHASE_ROOK') {
        // Find enemy king
        let enemyKingSq = [-1, -1];
        for (let er = 0; er < 8; er++) {
          for (let ec = 0; ec < 8; ec++) {
            if (board[er][ec]?.type === 'K' && board[er][ec]?.color === enemyColor) {
              enemyKingSq = [er, ec];
            }
          }
        }
        if (r === enemyKingSq[0] || c === enemyKingSq[1]) {
          threat += sign * 2.0;
        }
      }
    }
  }

  // Offboard Pieces (KNIGHTMARE)
  if (gameState.offBoardPieces) {
    for (const ob of gameState.offBoardPieces) {
      if (ob.piece.pixie === 'KNIGHTMARE') {
        const sign = ob.piece.color === 'w' ? 1 : -1;
        ability += sign * 2.0; // Untargetable threat
      }
    }
  }

  // Doomed Pieces (BLADERUNNER)
  if (gameState.doomed) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const targetPiece = board[r][c];
        if (targetPiece && targetPiece.id && gameState.doomed[targetPiece.id] !== undefined) {
          const sign = targetPiece.color === 'w' ? -1 : 1; // It's bad for the owner
          ev += sign * getBaseMaterial(targetPiece);
        }
      }
    }
  }

  const score = 
    (material * WEIGHTS.MATERIAL) + 
    (pst * WEIGHTS.PST) + 
    (structure * WEIGHTS.STRUCTURE) + 
    (safety * WEIGHTS.SAFETY) + 
    (ability * WEIGHTS.ABILITY) + 
    (threat * WEIGHTS.THREAT) + 
    (winCond * WEIGHTS.WIN_COND) + 
    (ev * WEIGHTS.EV);

  return score;
}
