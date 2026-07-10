import type { Board, GameState, Piece } from './types';
import { PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_QUEEN, PST_KING_MG, PST_KING_EG } from '../data/pst';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import { hasAristocrat, inBounds, calcBasiliskParalysis } from './utils';

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
    const meta = PIECE_CATALOG[piece.pixie];
    if (meta && meta.danger !== undefined) {
      // Use the danger score from the catalog to inherently teach the bot 
      // the value/priority of this piece during training.
      let value = meta.danger * 1.0;
      
      // Keep any dynamic state-based adjustments for specific pieces:
      if (piece.pixie === 'MARAUDER') {
        value += ((piece.state?.kill_count || 0) * 1.0);
      }
      if (piece.pixie === 'ELECTROKNIGHT') {
        value += ((piece.state?.ek_moves || 0) * 0.5);
      }
      return value;
    }
  }

  if (piece.pixie === 'HERO_PAWN') return 1.5;
  if (piece.pixie === 'EPEE_PAWN') return 1.2;
  if (piece.pixie === 'PAWN_KNIFE') return 1.2;
  if (piece.pixie === 'GOLDEN_PAWN') return 1.0;

  if (piece.pixie === 'IRONPAWN') return 0.8;

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

  // Standard pieces and their Pixie variants
  if (piece.type === 'P' || (piece.pixie && ['GOLDEN_PAWN', 'IRONPAWN', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON'].includes(piece.pixie))) return PST_PAWN[pstR][c];
  if (piece.type === 'N' || (piece.pixie && ['ELECTROKNIGHT', 'BANKER', 'CAMEL', 'KNIGHTMARE', 'ANTI_VIOLENCE', 'FISH_KNIGHT'].includes(piece.pixie))) return PST_KNIGHT[pstR][c];
  if (piece.type === 'B' || (piece.pixie && ['ARISTOCRAT', 'BASILISK', 'BLADERUNNER', 'BOUNCER', 'PILGRIM', 'DANCER', 'DJINN', 'GUNSLINGER', 'CARDINAL', 'ICICLE', 'HORDE_MOTHER', 'MARAUDER'].includes(piece.pixie))) return PST_BISHOP[pstR][c];
  if (piece.type === 'Q' || piece.pixie === 'FISSION_REACTOR') return PST_QUEEN[pstR][c];
  if (piece.type === 'K') {
    const mg = PST_KING_MG[pstR][c];
    const eg = PST_KING_EG[pstR][c];
    return (mg * gamePhase) + (eg * (1.0 - gamePhase));
  }

  // Rooks get bonus on open files
  if (piece.type === 'R' || piece.pixie === 'PHASE_ROOK' || piece.pixie === 'SUMOROOK') {
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
    if (['WAR_AUTOMATON', 'GUNSLINGER', 'SHRIKE', 'HORDE_MOTHER', 'BANKER'].includes(piece.pixie)) {
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

  // 1. Pawn Shield & Dynamic Castling Center
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

  // Dynamic Castling / Central Safety
  let d_open = true;
  let e_open = true;
  for (let row = 0; row < 8; row++) {
    if (board[row][3]?.type === 'P') d_open = false;
    if (board[row][4]?.type === 'P') e_open = false;
  }

  // If King is castled (c === 6 or c === 2)
  if (c === 6 || c === 2) {
    if (shieldPawns === 0) score -= 4.0; // Terrible ruined shield
    else if (shieldPawns === 1) score -= 1.0;
    else if (shieldPawns >= 2) score += 3.0; // Excellent castled position
  } else if (c === 4) { // King is central (E file)
    if (d_open || e_open) {
      score -= 3.0; // Penalty for open center
    } else {
      score += 1.0; // Safe in closed center
    }
  } else {
    // Wandering king
    score -= 2.0;
  }

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

import { evaluateNNUE } from './nnue/network';
import { nnueWeights } from './nnue/nnueLoader';
import { StatefulAccumulator } from './nnue/accumulator';

export function evaluate(board: Board, gameState: GameState, acc?: StatefulAccumulator): number {
  if (nnueWeights.isLoaded && acc) {
    const isWhiteTurn = gameState.turn % 2 === 1;
    // NNUE predicts the advantage for the side to move
    let nnueScore = isWhiteTurn ? evaluateNNUE(acc.whiteValues) : evaluateNNUE(acc.blackValues);
    
    // Convert relative score to absolute score (positive = White winning)
    if (!isWhiteTurn) {
      nnueScore = -nnueScore;
    }

    // Add simple game rules logic (like doomed pieces or offboard pieces) that might be outside NNUE scope
    let extraScore = 0;
    
    // Offboard Pieces (KNIGHTMARE)
    if (gameState.offBoardPieces) {
      for (const ob of gameState.offBoardPieces) {
        if (ob.piece.pixie === 'KNIGHTMARE') {
          const sign = ob.piece.color === 'w' ? 1 : -1;
          const KM_DIRS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
          let reachCount = 0;
          for (const [dr, dc] of KM_DIRS) {
            const landR = ob.obSq[0] - dr;
            const landC = ob.obSq[1] + dc;
            if (landR >= 0 && landR <= 7 && landC >= 0 && landC <= 7) reachCount++;
          }
          extraScore += sign * (2.0 + (reachCount / 8) * 1.5);
        }
      }
    }
    
    // Basilisk King-paralysis bonus
    const whiteParalyzed = calcBasiliskParalysis(board, 'w');
    const blackParalyzed = calcBasiliskParalysis(board, 'b');
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && (p.type === 'K')) {
          if (p.color === 'w' && whiteParalyzed.some(sq => sq[0] === r && sq[1] === c)) extraScore -= 3.0;
          if (p.color === 'b' && blackParalyzed.some(sq => sq[0] === r && sq[1] === c)) extraScore += 3.0;
        }
      }
    }
    
    return nnueScore + extraScore;
  }

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

      // Positional Bonus (Center control)
      if (c >= 2 && c <= 5 && r >= 2 && r <= 5) {
        if (piece.type === 'P' || piece.type === 'N') ability += sign * 0.3;
        if (piece.type === 'K') ability -= sign * 0.5; // Kings shouldn't wander to the center early
      }

      // ── PARALYSIS PENALTY (Basilisk) ──
      const isParalyzed = gameState.paralyzed[piece.color as 'w' | 'b']?.some(sq => sq[0] === r && sq[1] === c);
      if (isParalyzed) {
        if (piece.type === 'K') {
          winCond -= sign * 20.0; // King paralyzed is a massive vulnerability
        } else if (piece.type === 'Q' || piece.pixie === 'FISSION_REACTOR') {
          threat -= sign * 5.0; // High value piece neutralized
        } else {
          ability -= sign * 1.0; // Generic penalty for being paralyzed
        }
      }

      // 5. Ability State Bonuses
      if (piece.pixie === 'ELECTROKNIGHT') {
        if (piece.state?.is_charged) ability += sign * 5.0; // Huge bonus for being charged!
        else ability += sign * ((piece.state?.ek_moves || 0) * 1.0);
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
        // Center positioning bonus
        if (c === 3 || c === 4 || r === 3 || r === 4) ability += sign * 1.5;
        // Count adjacent friendly pieces the AV aura protects from capture
        let protectedFriendly = 0;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const ar = r + dr, ac = c + dc;
          if (inBounds(ar, ac) && board[ar][ac]?.color === piece.color) protectedFriendly++;
        }
        ability += sign * (protectedFriendly * 0.4); // Each adjacent friendly gets extra protection
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

      else if (piece.pixie === 'SHRIKE') {
        // NOTE: advancement bonus is handled in the second SHRIKE block below.
        // This block intentionally left empty to preserve the else-if chain.
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
        if (piece.state?.gs_targets) {
          for (const target of piece.state.gs_targets) {
            const targetPiece = board[target.sq[0]][target.sq[1]];
            if (targetPiece) {
              // Base EV for the targeted piece
              ev += sign * (getBaseMaterial(targetPiece) * 0.8);
              // Escalating threat: each ply of duel buildup adds urgency
              // ply=0: just locked on. ply=1: one turn committed. ply>=2: duel fires next move.
              threat += sign * (target.ply * 1.5);
              if (target.ply >= 2) {
                // Duel is IMMINENT — massive bonus to force bot to execute it
                winCond += sign * (getBaseMaterial(targetPiece) * 1.5);
              }
            }
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
        // Bonus moves remaining: incentivize continuing the chain
        if ((piece.state?.bonus_moves ?? 0) > 0) ability += sign * 2.0;
      }
      else if (piece.pixie === 'FISH_KNIGHT') {
        if (piece.state?.moved_last_turn) ability += sign * 1.5;
      }
      else if (piece.pixie === 'DJINN') {
        // Dissipated Djinn is in limbo, but will respawn on next capture — highly strategically valuable
        if (piece.state?.dissipated) {
          ability += sign * 2.5; // Untargetable + will respawn
        }
      }
      else if (piece.pixie === 'CARDINAL') {
        // Cardinal has a unique backward-step that standard bishops lack — extra mobility
        // Check if the backward square is available
        const backR = piece.color === 'w' ? r + 1 : r - 1;
        if (inBounds(backR, c) && board[backR][c] === null) {
          ability += sign * 0.5; // Retreat/reposition option
        }
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
      // ── SHRIKE: bonus for first-move double-step capture potential ──
      else if (piece.pixie === 'SHRIKE') {
        const startRank = piece.color === 'w' ? 6 : 1;
        if (r === startRank && !piece.state?.has_moved) {
          // Unmoved Shrike on start rank: ready for its 2-tile capture-through move
          ability += sign * 1.5;
        } else if (!piece.state?.has_moved) {
          // Unmoved Shrike not yet on starting rank: still has the move available
          ability += sign * 0.8;
        }
        // Advancement bonus similar to regular pawns (only after moving)
        if (piece.state?.has_moved) {
          const shrRank = piece.color === 'w' ? 7 - r : r;
          if (shrRank >= 4) ability += sign * (shrRank * 0.5);
        }
      }
      // ── IRONPAWN: invulnerability advantage bonus ──
      else if (piece.pixie === 'IRONPAWN') {
        // Ironpawn can't be captured — safe blocker in central files
        if (c >= 2 && c <= 5) ability += sign * 1.5;
        const ironRank = piece.color === 'w' ? 7 - r : r;
        ability += sign * (ironRank * 0.3); // More valuable as it advances
      }
      // ── PAWN_KNIFE: High threat if an enemy is in its strike zone ──
      else if (piece.pixie === 'PAWN_KNIFE') {
        const dir = piece.color === 'w' ? -1 : 1;
        // dx = ±2, dy = 2 forward
        let targetsFound = 0;
        for (const dc of [-2, 2]) {
          const er = r + (dir * 2);
          const ec = c + dc;
          if (inBounds(er, ec)) {
            const target = board[er][ec];
            if (target && target.color === enemyColor && !target.invulnerable) {
              targetsFound++;
            }
          }
        }
        if (targetsFound > 0) threat += sign * (targetsFound * 0.75);
      }
      // ── HERO_PAWN: Incredible scaling bonus the closer it gets to enemy King ──
      else if (piece.pixie === 'HERO_PAWN') {
        let enemyKingSq = [-1, -1];
        for (let er = 0; er < 8; er++) {
          for (let ec = 0; ec < 8; ec++) {
            if (board[er][ec]?.type === 'K' && board[er][ec]?.color === enemyColor) {
              enemyKingSq = [er, ec];
            }
          }
        }
        if (enemyKingSq[0] !== -1) {
          const dist = Math.max(Math.abs(r - enemyKingSq[0]), Math.abs(c - enemyKingSq[1]));
          // The closer it gets, the higher the bonus (max 5)
          const proximityBonus = Math.max(0, 6 - dist);
          ability += sign * (proximityBonus * 0.4);
        }
      }
      // ── WARP_JUMPER: Heavy progression bonus on A/H files ──
      else if (piece.pixie === 'WARP_JUMPER') {
        const wpRank = piece.color === 'w' ? 7 - r : r;
        if (c === 0 || c === 7) {
          winCond += sign * (wpRank * 0.4); // Fast tracking to rank 8
        } else {
          ability += sign * (wpRank * 0.1); // Slower tracking if not safe
        }
      }
      // ── WAR_AUTOMATON: Bonus if safely waiting behind own pieces ──
      else if (piece.pixie === 'WAR_AUTOMATON') {
        const frontRow = piece.color === 'w' ? r - 1 : r + 1;
        let isShielded = false;
        if (inBounds(frontRow, c)) {
          const frontPiece = board[frontRow][c];
          if (frontPiece && frontPiece.color === piece.color) {
            isShielded = true;
          }
        }
        if (isShielded) ability += sign * 0.6;
      }
      // ── EPEE_PAWN: Global en passant is powerful in opening/midgame ──
      else if (piece.pixie === 'EPEE_PAWN') {
        ability += sign * (gamePhase * 2.5);
      }
    }
  }

  // ── Horde Chain-Death Penalty (Fix #10) ──
  // If any Hordeling or Horde Mother is under attack, the ENTIRE swarm is at risk
  for (const color of ['w', 'b'] as const) {
    const csign = color === 'w' ? 1 : -1;
    const eColor = color === 'w' ? 'b' : 'w';
    let hordeMotherSq: [number, number] | null = null;
    let hordelingCount = 0;
    let anyHordeUnderAttack = false;

    for (let hr = 0; hr < 8; hr++) {
      for (let hc = 0; hc < 8; hc++) {
        const hp = board[hr][hc];
        if (!hp || hp.color !== color) continue;
        if (hp.pixie === 'HORDE_MOTHER') hordeMotherSq = [hr, hc];
        if (hp.id?.startsWith('hordeling_')) hordelingCount++;
      }
    }

    if (hordeMotherSq && hordelingCount > 0) {
      // Check if any horde piece is attackable by enemy
      for (let hr = 0; hr < 8; hr++) {
        for (let hc = 0; hc < 8; hc++) {
          const hp = board[hr][hc];
          if (!hp || hp.color !== color) continue;
          if (hp.pixie === 'HORDE_MOTHER' || hp.id?.startsWith('hordeling_')) {
            // Simple attack check: is any enemy adjacent or on knight-jump?
            for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1],
                                     [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
              const ar = hr + dr, ac = hc + dc;
              if (ar >= 0 && ar <= 7 && ac >= 0 && ac <= 7) {
                const attacker = board[ar][ac];
                if (attacker && attacker.color === eColor && attacker.type !== 'K') {
                  anyHordeUnderAttack = true;
                  break;
                }
              }
            }
            if (anyHordeUnderAttack) break;
          }
        }
        if (anyHordeUnderAttack) break;
      }

      if (anyHordeUnderAttack) {
        // Losing ANY piece kills the Mother + ALL hordelings
        threat += csign * -(3.5 + hordelingCount * 1.0);
      }
    }
  }

  // Offboard Pieces (KNIGHTMARE)
  if (gameState.offBoardPieces) {
    for (const ob of gameState.offBoardPieces) {
      if (ob.piece.pixie === 'KNIGHTMARE') {
        const sign = ob.piece.color === 'w' ? 1 : -1;
        // Quality: count how many on-board squares this Knightmare can reach
        // (landR = obR - dr, landC = obC + dc — matching the drop-move convention)
        const KM_DIRS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        let reachCount = 0;
        for (const [dr, dc] of KM_DIRS) {
          const landR = ob.obSq[0] - dr;
          const landC = ob.obSq[1] + dc;
          if (landR >= 0 && landR <= 7 && landC >= 0 && landC <= 7) reachCount++;
        }
        // Base: +2.0 for any off-board Knightmare (untargetable threat)
        // Bonus: up to +1.5 for max reach (8 squares) — scales linearly
        ability += sign * (2.0 + (reachCount / 8) * 1.5);
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
