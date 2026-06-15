import type { Board, Move, Piece, GameState, AbilityTracker } from './types';
import { cloneBoard, hasAristocrat, calcBasiliskParalysis, chebyshevDist, inBounds, getBestLightningTarget, findMostAdvancedOwnPawn, givesCheck } from './utils';
import { isCheck } from './moveGenerator';

export function applyMove(
  board: Board, 
  move: Move, 
  gameState: GameState, 
  tracker: AbilityTracker
): { board: Board; effects: string[]; gameState: GameState } {

  const nb = cloneBoard(board);
  const ngs: GameState = { 
    ...gameState, 
    frozen: [...gameState.frozen.map(f => ({...f}))], 
    paralyzed: { 
      w: [...gameState.paralyzed.w.map(p => [...p] as [number, number])], 
      b: [...gameState.paralyzed.b.map(p => [...p] as [number, number])] 
    },
    doomed: { ...gameState.doomed },
    // Knightmare limbo: deep-copy off-board pieces
    offBoardPieces: (gameState.offBoardPieces || []).map(ob => ({
      piece: { ...ob.piece, state: ob.piece.state ? { ...ob.piece.state } : undefined },
      obSq: ob.obSq
    })),
    // Icicle consecutive adjacency tracking
    pendingIcicle: (gameState.pendingIcicle || []).map(p => ({ ...p })),
    deadPieces: (gameState.deadPieces || []).map(p => ({ ...p, state: p.state ? { ...p.state } : undefined }))
  };
  const effects: string[] = [];

  // ── Centralized death handler: ensures linked-death effects fire on ANY destruction ──
  function onPieceDestroyed(destroyed: Piece): void {
    if (destroyed.pixie === 'HORDE_MOTHER' || destroyed.pixie === 'HORDELING') {
      // Clear from board
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = nb[r][c];
          if (p && p.color === destroyed.color && (p.pixie === 'HORDE_MOTHER' || p.pixie === 'HORDELING')) {
            nb[r][c] = null;
          }
        }
      }
      // Clear from offBoardPieces (limbo)
      ngs.offBoardPieces = ngs.offBoardPieces.filter(ob => !(ob.piece.color === destroyed.color && (ob.piece.pixie === 'HORDE_MOTHER' || ob.piece.pixie === 'HORDELING')));
      effects.push('HORDE_DEATH');
    }
    
    // Do not add ephemeral hordelings to deadPieces pool for resurrection
    if (destroyed.pixie !== 'HORDELING') {
      ngs.deadPieces.push({ ...destroyed, state: destroyed.state ? { ...destroyed.state } : undefined });
    }

    // Check if a King was pushed off the board or destroyed!
    if (destroyed.type === 'K' || destroyed.pixie === 'ROCKETMAN') {
      effects.push('KING_DESTROYED');
      ngs.gameOver = true;
      ngs.winner = destroyed.color === 'w' ? 'b' : 'w';
    }
  }

  // If it's a drop move (Knightmare), restore the original piece from off-board limbo
  let piece = nb[move.from[0]]?.[move.from[1]] ?? null;

  if (move.drop === 'KNIGHTMARE') {
    // Restore the original Knightmare from off-board limbo (preserves ID & state)
    const obIndex = ngs.offBoardPieces.findIndex(
      ob => ob.obSq[0] === move.from[0] && ob.obSq[1] === move.from[1]
    );
    if (obIndex >= 0) {
      const obEntry = ngs.offBoardPieces[obIndex];
      ngs.offBoardPieces = ngs.offBoardPieces.filter((_, i) => i !== obIndex);
      
      const toR = move.to[0], toC = move.to[1];
      if (toR >= 0 && toR <= 7 && toC >= 0 && toC <= 7) {
        // Drop back ONTO the board - let it fall through for standard execution
        piece = { ...obEntry.piece, state: { ...(obEntry.piece.state || {}), off_board: false } };
        effects.push('KNIGHTMARE_DROP');
      } else {
        // Drop to ANOTHER off-board square
        if (move.capture && move.obCapSq) {
          const enemyObIdx = ngs.offBoardPieces.findIndex(
            ob => ob.obSq[0] === move.obCapSq![0] && ob.obSq[1] === move.obCapSq![1] && ob.piece.color !== obEntry.piece.color
          );
          if (enemyObIdx >= 0) {
             const capturedOb = ngs.offBoardPieces[enemyObIdx];
             ngs.offBoardPieces = ngs.offBoardPieces.filter((_, i) => i !== enemyObIdx);
             onPieceDestroyed(capturedOb.piece);
          }
        }
        
        ngs.offBoardPieces.push({
          piece: { ...obEntry.piece },
          obSq: [toR, toC]
        });
        effects.push('KNIGHTMARE_JUMP_OFF'); // Re-use the jump off effect for sound/anim
        ngs.lastMove = move;
        ngs.turn++;
        return { board: nb, effects, gameState: ngs };
      }
    } else {
      throw new Error('Knightmare not found in offBoardPieces');
    }
  }

  // obJump: Knightmare jumping off the board into limbo
  if (move.obJump) {
    const jumpingPiece = nb[move.from[0]][move.from[1]]!;
    nb[move.from[0]][move.from[1]] = null;

    if (move.capture && move.obCapSq) {
       const enemyObIdx = ngs.offBoardPieces.findIndex(
         ob => ob.obSq[0] === move.obCapSq![0] && ob.obSq[1] === move.obCapSq![1] && ob.piece.color !== jumpingPiece.color
       );
       if (enemyObIdx >= 0) {
          const capturedOb = ngs.offBoardPieces[enemyObIdx];
          ngs.offBoardPieces = ngs.offBoardPieces.filter((_, i) => i !== enemyObIdx);
          onPieceDestroyed(capturedOb.piece);
       }
    }

    ngs.offBoardPieces.push({
      piece: { ...jumpingPiece, state: { ...(jumpingPiece.state || {}) } },
      obSq: move.to
    });
    effects.push('KNIGHTMARE_JUMP_OFF');
    ngs.lastMove = move;
    ngs.turn++;
    return { board: nb, effects, gameState: ngs };
  }

  if (!piece) {
    throw new Error('Attempted to move empty square');
  }

  // ── Step 1: Pre-execution special handling ──────────────────────────────
  if (move.dissipate) {
    piece.state = piece.state || {};
    piece.state.dissipated = true;
    piece.state.home_sq = move.from;
    nb[move.from[0]][move.from[1]] = null; // Remove from board
    
    // Move to limbo so we can find it later for respawn
    ngs.offBoardPieces.push({
      piece: { ...piece, state: { ...piece.state } },
      obSq: move.from
    });
    effects.push('DJINN_DISSIPATED');
  }
  // Legacy drop path (non-Knightmare) — kept for safety
  if (move.drop && move.drop !== 'KNIGHTMARE') {
    piece = piece || { type: 'N' as const, color: ngs.turn % 2 === 1 ? 'w' as const : 'b' as const, pixie: move.drop, id: Math.random().toString(), state: {} };
    nb[move.to[0]][move.to[1]] = piece;
    effects.push('KNIGHTMARE_DROP');
    return { board: nb, effects, gameState: ngs };
  }
  if (move.rocket) {
    nb[move.from[0]][move.from[1]] = null;
    nb[move.to[0]][move.to[1]] = piece;
    piece.state = piece.state || {};
    piece.state.used_rocket = true;
    effects.push('ROCKETMAN_TELEPORT');
  }
  if (move.pushFalloff) {
    const fallenPiece = nb[move.pushFalloff[0]][move.pushFalloff[1]];
    nb[move.pushFalloff[0]][move.pushFalloff[1]] = null;
    ngs.frozen = ngs.frozen.filter(f => f.square[0] !== move.pushFalloff![0] || f.square[1] !== move.pushFalloff![1]);
    if (fallenPiece) onPieceDestroyed(fallenPiece);
    effects.push('SUMOROOK_PUSH');
  }
  if (move.push2 && move.push2From) {
    const enemy2 = nb[move.push2From[0]][move.push2From[1]];
    if (enemy2) nb[move.push2[0]][move.push2[1]] = enemy2;
  }
  if (move.push) {
    const fromR = move.pushFrom ? move.pushFrom[0] : move.to[0];
    const fromC = move.pushFrom ? move.pushFrom[1] : move.to[1];
    const enemy = nb[fromR][fromC]!;
    nb[fromR][fromC] = null;
    ngs.frozen = ngs.frozen.filter(f => f.square[0] !== fromR || f.square[1] !== fromC);
    
    if (move.push2From) {
      nb[move.push2From[0]][move.push2From[1]] = null;
      ngs.frozen = ngs.frozen.filter(f => f.square[0] !== move.push2From![0] || f.square[1] !== move.push2From![1]);
    }
    nb[move.push[0]][move.push[1]] = enemy;
    effects.push('SUMOROOK_PUSH');
  }
  if (move.duel) {
    const mt = piece.state?.mutual_target;
    if (mt) {
      const duelVictim = nb[mt[0]][mt[1]];
      nb[mt[0]][mt[1]] = null;
      nb[move.from[0]][move.from[1]] = null;
      if (duelVictim) onPieceDestroyed(duelVictim);
      onPieceDestroyed(piece);
      effects.push('GUNSLINGER_DUEL');
    }
  }
  if (move.epCapSq) {
    const epVictim = nb[move.epCapSq[0]][move.epCapSq[1]];
    nb[move.epCapSq[0]][move.epCapSq[1]] = null;
    if (epVictim) onPieceDestroyed(epVictim);
  }
  if (move.bladeThru && move.bladeThru.length > 0) {
    // PRD says doomed = turn + 1
    for (const [r, c] of move.bladeThru) {
      const target = nb[r][c];
      if (target && !target.invulnerable && target.id) {
        ngs.doomed[target.id] = ngs.turn + 1;
      }
    }
  }

  // ── Save captured piece info BEFORE Step 2 clears it ───────────────────
  const capturedPiece = move.capture ? nb[move.to[0]][move.to[1]] : null;

  if (capturedPiece) {
    onPieceDestroyed(capturedPiece);
  }

  // ── Step 2: Standard execution ──────────────────────────────────────────
  const skipStandard = move.dissipate || move.duel || move.rocket;
  if (!skipStandard) {
    if (!move.drop) {
      nb[move.from[0]][move.from[1]] = null;
    }
    nb[move.to[0]][move.to[1]] = piece;
  } // end skipStandard

  // ── Castling: slide the rook ─────────────────────────────────────────────
  if (piece.type === 'K' && Math.abs(move.to[1] - move.from[1]) === 2 && !move.rocket && !move.drop && !move.obJump && !move.dissipate) {
    const backRank = move.from[0];
    if (move.to[1] === 6) { // Kingside
      nb[backRank][5] = nb[backRank][7];
      nb[backRank][7] = null;
      effects.push('CASTLE_KINGSIDE');
    } else if (move.to[1] === 2) { // Queenside
      nb[backRank][3] = nb[backRank][0];
      nb[backRank][0] = null;
      effects.push('CASTLE_QUEENSIDE');
    }
  }

  // ── Step 3: Pawn promotion ──────────────────────────────────────────────
  const isWhite = piece.color === 'w';
  const promoRank = isWhite ? 0 : 7;
  if (piece.type === 'P' && move.to[0] === promoRank) {
    const enemyColor = isWhite ? 'b' : 'w';
    const aristocratBlocks = hasAristocrat(nb, enemyColor);
    if (piece.pixie === 'GOLDEN_PAWN') {
      if (!aristocratBlocks) {
        effects.push('PIXIE_WIN');
        ngs.gameOver = true;
        ngs.winner = piece.color;
      } else {
        effects.push('GOLDEN_PAWN_BLOCKED');
      }
    } else if (aristocratBlocks) {
      // Enemy Aristocrat suppresses ALL promotions — pawn stays as pawn on the rank
      effects.push('PROMOTION_BLOCKED');
    } else {
      nb[move.to[0]][move.to[1]] = { type: move.promotion || 'Q', color: piece.color, pixie: undefined, id: piece.id };
      effects.push('PROMOTION');
    }
  }

  // ── Step 4: Ability state mutations ─────────────────────────────────────
  piece.state = piece.state || {}; // Ensure state object exists
  
  switch (piece.pixie) {
    case 'ELECTROKNIGHT': {
      if (move.capture) {
        if (piece.state.is_charged && move.lightning) {
          const target = getBestLightningTarget(move.to, nb, piece.color);
          if (target) {
            const victim = nb[target[0]][target[1]];
            nb[target[0]][target[1]] = null;
            if (victim) onPieceDestroyed(victim);
          }
          effects.push('ELECTRO_LIGHTNING');
        }
        piece.state.consec_moves = 0;
        piece.state.is_charged = false;
      } else {
        piece.state.consec_moves = (piece.state.consec_moves || 0) + 1;
        if (piece.state.consec_moves >= 3) piece.state.is_charged = true;
      }
      break;
    }
    case 'BANKER': {
      if (move.capture && capturedPiece && capturedPiece.type === 'P') {
        // Banker only triggers when it captures an enemy PAWN
        const pawn = findMostAdvancedOwnPawn(nb, piece.color);
        if (pawn) pawn.pixie = 'GOLDEN_PAWN';
        effects.push('BANKER_CHAIN');
      }
      break;
    }
    case 'FISSION_REACTOR': {
      if (move.capture) {
        piece.state.capture_count = (piece.state.capture_count || 0) + 1;
        if (piece.state.capture_count >= 5) {
          nb[move.to[0]][move.to[1]] = null; // remove self
          for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const er = move.to[0]+dr;
            const ec = move.to[1]+dc;
            if (inBounds(er, ec) && nb[er][ec] && nb[er][ec]!.color !== piece.color && !nb[er][ec]!.invulnerable) {
              const blastVictim = nb[er][ec]!;
              nb[er][ec] = null;
              onPieceDestroyed(blastVictim);
            }
          }
          effects.push('FISSION_EXPLOSION');
        }
      }
      break;
    }


    case 'PILGRIM':
      piece.state.total_dist = (piece.state.total_dist || 0) + chebyshevDist(move.from[0], move.from[1], move.to[0], move.to[1]);
      if (piece.pixie === 'PILGRIM' && piece.state.total_dist >= 20 && !piece.state.resurrected) {
        const deadAllies = ngs.deadPieces.filter(p => p.color === piece.color && !p.pixie);
        if (deadAllies.length > 0) {
          const valMap: Record<string, number> = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };
          deadAllies.sort((a, b) => (valMap[b.type] || 0) - (valMap[a.type] || 0));
          const toResurrect = deadAllies[0];
          
          let spawnSq: [number, number] | null = null;
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const er = move.to[0] + dr, ec = move.to[1] + dc;
            if (inBounds(er, ec) && nb[er][ec] === null) {
              spawnSq = [er, ec];
              break;
            }
          }
          
          if (spawnSq) {
            nb[spawnSq[0]][spawnSq[1]] = { ...toResurrect, id: Math.random().toString(36).substring(2) };
            piece.state.resurrected = true;
            const idx = ngs.deadPieces.findIndex(p => p.id === toResurrect.id);
            if (idx >= 0) ngs.deadPieces.splice(idx, 1);
            effects.push('PILGRIM_RESURRECT');
          }
        }
      }
      break;
    case 'DANCER':
      if (!piece.state.active_flag && givesCheck(move.to, nb, piece.color, ngs)) {
        piece.state.bonus_moves = 2;
        piece.state.active_flag = true;
        piece.state.just_checked = true;
        effects.push('DANCER_CHECK'); // signals search engine to grant 2 bonus quiet moves
      } else if ((piece.state.bonus_moves || 0) > 0) {
        piece.state.bonus_moves = piece.state.bonus_moves! - 1;
        if (piece.state.bonus_moves === 0) piece.state.active_flag = false;
      }
      break;
    case 'FISH_KNIGHT':
      piece.state.moved_last_turn = !move.fishBonus;
      break;
    case 'MARAUDER':
      if (move.capture) {
        piece.state.kill_count = (piece.state.kill_count || 0) + 1;
        effects.push('MARAUDER_GROW');
      }
      break;
    case 'HERO_PAWN': {
      const oppHero = piece.color === 'w' ? 'b' : 'w';
      if (isCheck(nb, oppHero, ngs)) {
        nb[move.to[0]][move.to[1]] = { type: 'Q', color: piece.color, pixie: undefined, id: piece.id };
        effects.push('HERO_PROMOTE');
      }
      break;
    }
    case 'SHRIKE':
      piece.state.has_moved = true;
      if (move.shrikePath) {
        const shrikeVictim = nb[move.shrikePath[0]][move.shrikePath[1]];
        nb[move.shrikePath[0]][move.shrikePath[1]] = null;
        if (shrikeVictim) onPieceDestroyed(shrikeVictim);
        effects.push('SHRIKE_CAPTURE');
      }
      break;
    case 'HORDE_MOTHER':
      if (move.capture) {
        if (move.hordeSpawn) {
          const [sr, sc] = move.hordeSpawn;
          if (inBounds(sr, sc) && nb[sr][sc] === null) {
            const hordelingId = `hordeling_t${ngs.turn}_${sr}_${sc}`;
            nb[sr][sc] = {
              type: 'P', color: piece.color, pixie: 'HORDELING',
              id: hordelingId, state: {}, invulnerable: false
            };
            piece.state = piece.state || {};
            if (!piece.state.hordeling_ids) piece.state.hordeling_ids = [];
            piece.state.hordeling_ids.push(hordelingId);
            effects.push('HORDE_SPAWN');
          }
        }
      }
      break;
    case 'ROCKETMAN':
      if (move.rocket) {
        piece.state.used_rocket = true;
        effects.push('ROCKET_BLAST');
      }
      break;
    case 'WAR_AUTOMATON':
      // WAR_AUTOMATON is a pawn — auto-advance triggered globally on any capture below
      break;
  }

  // Handle Djinn Respawn + War Automaton auto-advance on any capture
  if (move.capture) {
    // Check limbo for dissipated Djinns
    const djinnIndex = ngs.offBoardPieces.findIndex(ob => ob.piece.pixie === 'DJINN' && ob.piece.state?.dissipated);
    if (djinnIndex >= 0) {
      const djinnEntry = ngs.offBoardPieces[djinnIndex];
      const p = djinnEntry.piece;
      if (p.state?.home_sq) {
        const [hr, hc] = p.state.home_sq;
        if (nb[hr][hc] === null) {
          p.state.dissipated = false;
          nb[hr][hc] = { ...p, state: { ...p.state } };
          // Remove from limbo
          ngs.offBoardPieces.splice(djinnIndex, 1);
          effects.push('DJINN_RESPAWN');
        }
      }
    }
    // War Automaton: auto-advance on any capture
    const automatonsToMove: { r: number; c: number; p: Piece }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = nb[r][c];
        // DO NOT auto-advance the War Automaton that just made the capture
        if (p && p.pixie === 'WAR_AUTOMATON' && !(r === move.to[0] && c === move.to[1])) {
          automatonsToMove.push({ r, c, p });
        }
      }
    }
    
    // Sort so the player who made the capture has their automatons move first
    automatonsToMove.sort((a, b) => {
      if (a.p.color === piece.color && b.p.color !== piece.color) return -1;
      if (a.p.color !== piece.color && b.p.color === piece.color) return 1;
      return 0;
    });

    for (const { r, c, p } of automatonsToMove) {
      if (r === move.to[0] && c === move.to[1]) continue; // DO NOT advance the capturing Automaton!
      const dir = p.color === 'w' ? -1 : 1;
      const nextR = r + dir;
      if (inBounds(nextR, c) && nb[nextR][c] === null) {
        // Double check it's still at r,c (in case multiple automatons interact, though they just move straight)
        if (nb[r][c] === p) {
          nb[nextR][c] = p;
          nb[r][c] = null;
          effects.push('WAR_AUTOMATON_ADVANCE');
        }
      }
    }
  }

  // ── Step 5: Freeze countdown ─────────────────────────────────────────────
  tracker.decrementFreezes(ngs);

  // ── Step 6: GameState update ──────────────────────────────────────────────
  // Wait, PRD 11 says "ngs.enPassant = getEnPassantTarget(move, nb)" 
  // Let's implement simplified enPassant target logic.
  if (piece.type === 'P' && Math.abs(move.from[0] - move.to[0]) === 2) {
    const r = move.to[0], c = move.to[1];
    const leftPawn = inBounds(r, c - 1) ? nb[r][c - 1] : null;
    const rightPawn = inBounds(r, c + 1) ? nb[r][c + 1] : null;
    const isEnemyPawn = (p: Piece | null) => p && p.color !== piece.color && p.type === 'P';
    if (isEnemyPawn(leftPawn) || isEnemyPawn(rightPawn)) {
      ngs.enPassant = [move.from[0] + (move.to[0] - move.from[0]) / 2, move.from[1]];
    } else {
      ngs.enPassant = undefined;
    }
  } else {
    ngs.enPassant = undefined;
  }

  // ── Castling rights revocation ────────────────────────────────────────────
  if (ngs.castling) {
    ngs.castling = { ...ngs.castling };
    // King moves — lose both sides
    if (piece.type === 'K') {
      if (piece.color === 'w') { ngs.castling.K = false; ngs.castling.Q = false; }
      else                    { ngs.castling.k = false; ngs.castling.q = false; }
    }
    // Rook moves — lose the side it was on
    if (piece.type === 'R') {
      if (move.from[0] === 7 && move.from[1] === 7) ngs.castling.K = false;
      if (move.from[0] === 7 && move.from[1] === 0) ngs.castling.Q = false;
      if (move.from[0] === 0 && move.from[1] === 7) ngs.castling.k = false;
      if (move.from[0] === 0 && move.from[1] === 0) ngs.castling.q = false;
    }
    // Rook captured — lose rights for that corner
    if (move.capture) {
      if (move.to[0] === 7 && move.to[1] === 7) ngs.castling.K = false;
      if (move.to[0] === 7 && move.to[1] === 0) ngs.castling.Q = false;
      if (move.to[0] === 0 && move.to[1] === 7) ngs.castling.k = false;
      if (move.to[0] === 0 && move.to[1] === 0) ngs.castling.q = false;
    }
  }

  // ── Step 7: Doom Resolution ───────────────────────────────────────────────
  for (const pieceId of Object.keys(ngs.doomed)) {
    if (ngs.doomed[pieceId] === ngs.turn) {
      let found = false;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const target = nb[r][c];
          if (target && target.id === pieceId && !target.invulnerable) {
            nb[r][c] = null;
            onPieceDestroyed(target);
            effects.push('BLADERUNNER_DOOM_KILL');
            found = true;
            break;
          }
        }
        if (found) break;
      }
      delete ngs.doomed[pieceId];
    }
  }

  ngs.lastMove = move;
  if (piece.pixie === 'DANCER' && piece.state?.bonus_moves && piece.state.bonus_moves > 0 && !piece.state.just_checked) {
    // Mid-sequence bonus move. Do not increment turn.
  } else {
    ngs.turn++;
  }
  
  if (piece.state?.just_checked) {
    delete piece.state.just_checked;
  }

  // ── Step 8: Global Recalculations ──
  ngs.paralyzed['w'] = calcBasiliskParalysis(nb, 'w');
  ngs.paralyzed['b'] = calcBasiliskParalysis(nb, 'b');

  // Forfeit Dancer bonus moves if not used on the active turn
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = nb[r][c];
      if (p && p.color === piece.color && p.pixie === 'DANCER' && p.state?.bonus_moves) {
        // If this piece is not the one that just moved, OR it didn't just give check (handled above), forfeit bonus
        if (p.id !== piece.id && !p.state.just_checked) {
          p.state.bonus_moves = 0;
          p.state.active_flag = false;
        }
      }
    }
  }

  // Icicle global freeze calculation
  const nowAdjToIcicle = new Set<string>();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = nb[r][c];
      if (p && p.pixie === 'ICICLE') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const er = r+dr, ec = c+dc;
          if (inBounds(er, ec)) {
            const adj = nb[er][ec];
            if (adj && adj.color !== p.color && !adj.invulnerable) {
              nowAdjToIcicle.add(`${er}_${ec}`);
            }
          }
        }
      }
    }
  }

  const nextPendingIcicle: Array<{ square: [number, number]; turns: number }> = [];
  for (const key of nowAdjToIcicle) {
    const [rStr, cStr] = key.split('_');
    const er = parseInt(rStr, 10);
    const ec = parseInt(cStr, 10);
    const existing = ngs.pendingIcicle.find(p => p.square[0] === er && p.square[1] === ec);
    if (existing) {
      existing.turns++;
      if (existing.turns >= 2) {
        const alreadyFrozen = ngs.frozen.some(f => f.square[0] === er && f.square[1] === ec);
        if (!alreadyFrozen) {
          ngs.frozen.push({ square: [er, ec], turns_remaining: 2, frozen_by: [-1, -1] });
          effects.push('ICICLE_FREEZE');
        }
      } else {
        nextPendingIcicle.push(existing);
      }
    } else {
      nextPendingIcicle.push({ square: [er, ec], turns: 1 });
    }
  }
  ngs.pendingIcicle = nextPendingIcicle;

  // ── Gunslinger Duel Mechanics ──
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = nb[r][c];
      if (p && p.pixie === 'GUNSLINGER') {
        let inDuelWith: [number, number] | null = null;
        const dirs = [[-1,-1], [-1,1], [1,-1], [1,1]];
        for (const [dr, dc] of dirs) {
          let cr = r + dr, cc = c + dc;
          while (inBounds(cr, cc)) {
            const target = nb[cr][cc];
            if (target) {
              if (target.color !== p.color) {
                inDuelWith = [cr, cc];
              }
              break;
            }
            cr += dr; cc += dc;
          }
          if (inDuelWith) break;
        }

        p.state = p.state || {};
        if (inDuelWith) {
          const [tr, tc] = inDuelWith;
          if (!p.state.mutual_target || p.state.mutual_target[0] !== tr || p.state.mutual_target[1] !== tc) {
            p.state.mutual_target = [tr, tc];
            p.state.mutual_ply = 0;
          } else {
            p.state.mutual_ply = (p.state.mutual_ply || 0) + 1;
          }

          if (p.state.mutual_ply >= 1) {
            // Duel is now a selectable move (`move.duel`). We don't automatically destroy them anymore.
            // But we keep the state tracked so the duel move is generated.
          }
        } else {
          p.state.mutual_target = undefined;
          p.state.mutual_ply = 0;
        }
      }
      
      // Electroknight charge reset
      if (p && p.pixie === 'ELECTROKNIGHT') {
        const playerWhoJustMoved = ngs.turn % 2 === 0 ? 'w' : 'b';
        if (p.color === playerWhoJustMoved) {
          if (r !== move.to[0] || c !== move.to[1]) {
            p.state = p.state || {};
            p.state.consec_moves = 0;
            p.state.is_charged = false;
          }
        }
      }
    }
  }

  // ── Step 8: Update moved_last_turn state ─────────────────────────────────
  const colorThatMoved = piece.color;
  
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = nb[r][c];
      if (p && p.color === colorThatMoved) {
         if (p.state) p.state.moved_last_turn = false;
      }
    }
  }
  
  if (move.to[0] >= 0 && move.to[0] <= 7 && move.to[1] >= 0 && move.to[1] <= 7) {
     const movedPiece = nb[move.to[0]][move.to[1]];
     if (movedPiece && movedPiece.color === colorThatMoved) {
        movedPiece.state = movedPiece.state || {};
        movedPiece.state.moved_last_turn = true;
     }
  }

  return { board: nb, effects, gameState: ngs };
}
