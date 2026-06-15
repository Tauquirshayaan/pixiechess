import { Board, GameState, Piece } from './types';
import { evaluate } from './evaluator';
import { StatefulAccumulator } from './nnue/accumulator';
import { PIECE_CATALOG } from '../data/pieceCatalog';

const BASE_VALUES: Record<string, number> = { Q: 9, R: 5, B: 3.2, N: 3, P: 1, K: 0 };

// Mirror of gameStore.ts initState — keeps ability tracking correct from first move
function initPieceState(pixie: string): Record<string, unknown> {
  switch (pixie) {
    case 'ELECTROKNIGHT':   return { consec_moves: 0, is_charged: false };
    case 'BANKER':          return { pawns_banked: 0 };
    case 'FISSION_REACTOR': return { capture_count: 0 };
    case 'PILGRIM':         return { total_dist: 0, resurrected: false };
    case 'DANCER':          return { bonus_moves: 0, active_flag: false };
    case 'DJINN':           return { dissipated: false, home_sq: null };
    case 'GUNSLINGER':      return { mutual_target: null, mutual_ply: 0 };
    case 'ROCKETMAN':       return { used_rocket: false };
    case 'KNIGHTMARE':      return { off_board: false, ob_sq: null };
    case 'FISH_KNIGHT':     return { moved_last_turn: false };
    case 'MARAUDER':        return { kill_count: 0 };
    case 'SHRIKE':          return { has_moved: false };
    case 'HORDE_MOTHER':    return { hordeling_ids: [] };
    case 'WAR_AUTOMATON':
    case 'BLADERUNNER':
    default:                return {};
  }
}

// Piece-square bonus for initial placement (used when NNUE is absent)
// Returns a score bonus for placing a power piece of given base type at [r, c]
function placementBonus(baseType: string, pixie: string, r: number, c: number, color: 'w' | 'b'): number {
  // Flip row for black (so "rank 1" is always the home rank)
  const pr = color === 'w' ? r : 7 - r;
  const meta = PIECE_CATALOG[pixie as keyof typeof PIECE_CATALOG];
  const danger = meta?.danger || 0;

  let bonus = danger * 0.5; // Higher danger = more intrinsic value

  switch (baseType) {
    case 'P': {
      // Passed-pawn potential: advanced pawns score higher
      bonus += (pr / 7.0) * 2.0;
      // Central files preferred
      if (c >= 2 && c <= 5) bonus += 0.5;
      // GOLDEN_PAWN: massive advancement incentive
      if (pixie === 'GOLDEN_PAWN') bonus += pr * 1.5;
      break;
    }
    case 'N': {
      // Knights are best in center
      const centerDist = Math.abs(c - 3.5) + Math.abs(pr - 3.5);
      bonus += Math.max(0, 3.5 - centerDist) * 0.5;
      break;
    }
    case 'B': {
      // Bishops like open diagonals — prefer center files
      if (c >= 2 && c <= 5 && pr >= 2 && pr <= 5) bonus += 1.0;
      // PILGRIM: prefers a starting square with lots of diagonal room
      if (pixie === 'PILGRIM') bonus += 0.5;
      // BASILISK: center is powerful for LOS paralysis
      if (pixie === 'BASILISK') bonus += (c >= 2 && c <= 5) ? 1.5 : 0;
      break;
    }
    case 'R': {
      // Rooks like open files (rank-independent) and centralized files
      if (c >= 2 && c <= 5) bonus += 0.5;
      // SUMOROOK: likes being on the side ranks for push potential
      if (pixie === 'SUMOROOK') bonus += (pr >= 2 && pr <= 5) ? 1.0 : 0;
      break;
    }
    case 'Q': {
      // Queens: moderate center bonus, FISSION_REACTOR wants active position
      if (c >= 2 && c <= 5 && pr >= 2 && pr <= 5) bonus += 1.0;
      if (pixie === 'FISSION_REACTOR' && pr >= 3 && pr <= 5) bonus += 1.5;
      break;
    }
  }
  return bonus;
}

export function autoDeploy(board: Board, gameState: GameState, color: 'w' | 'b', loadout: string[]): Board {
  const newBoard = board.map(row => row.map(p => p ? { ...p } : null)) as Board;

  // 1. Count already-deployed power pieces for this color to respect max-6
  let alreadyDeployed = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = newBoard[r][c];
      if (p && p.color === color && p.pixie) alreadyDeployed++;
    }
  }

  // Deduplicate loadout, remove any already on board, cap at remaining slots (max 6)
  const onBoard = new Set<string>();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = newBoard[r][c];
      if (p && p.color === color && p.pixie) onBoard.add(p.pixie);
    }
  }

  const slotsLeft = 6 - alreadyDeployed;
  if (slotsLeft <= 0 || loadout.length === 0) return newBoard;

  // Build the deploy list: only pieces from loadout not yet on board, up to slotsLeft
  const toDeployList = [...new Set(loadout)]
    .filter(px => !onBoard.has(px))
    .slice(0, slotsLeft);

  if (toDeployList.length === 0) return newBoard;

  // Sort by strategic value: higher base value first, then by danger score
  toDeployList.sort((a, b) => {
    const catA = PIECE_CATALOG[a as keyof typeof PIECE_CATALOG];
    const catB = PIECE_CATALOG[b as keyof typeof PIECE_CATALOG];
    const valA = BASE_VALUES[catA?.base] ?? 0;
    const valB = BASE_VALUES[catB?.base] ?? 0;
    if (valB !== valA) return valB - valA;
    return (catB?.danger ?? 0) - (catA?.danger ?? 0);
  });

  // 2. Build candidate map: base type -> list of [r, c] of unoccupied-by-pixie standard pieces
  const candidatesByType: Map<string, [number, number][]> = new Map();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = newBoard[r][c];
      // Must be: same color, not a King, not already a power piece
      if (p && p.color === color && p.type !== 'K' && !p.pixie) {
        const list = candidatesByType.get(p.type) || [];
        list.push([r, c]);
        candidatesByType.set(p.type, list);
      }
    }
  }

  // 3. Build NNUE accumulator for strategic scoring
  const baseAcc = new StatefulAccumulator();
  baseAcc.refresh(newBoard);

  const remainingLoadout = [...toDeployList];
  // Track used squares across deployments
  const usedSquares = new Set<string>();

  // Greedy placement: pick the globally best (pixie, square) pair each round
  while (remainingLoadout.length > 0) {
    let bestScore = -Infinity;
    let bestChoice: { pixieIndex: number, square: [number, number], powerPiece: Piece } | null = null;

    for (let pIdx = 0; pIdx < remainingLoadout.length; pIdx++) {
      const pixieName = remainingLoadout[pIdx];
      const cat = PIECE_CATALOG[pixieName as keyof typeof PIECE_CATALOG];
      if (!cat) continue;
      const baseType = cat.base;

      const squares = (candidatesByType.get(baseType) || [])
        .filter(([r, c]) => !usedSquares.has(`${r},${c}`));

      if (squares.length === 0) continue;

      const powerPiece: Piece = {
        type: baseType as any,
        color,
        pixie: pixieName as any,
        id: `auto_${pixieName}_${Date.now()}_${pIdx}`,
        state: initPieceState(pixieName) as any,
      };

      for (const [r, c] of squares) {
        const oldPiece = newBoard[r][c];

        // Try placing this piece here — use NNUE if available, else classical + PST bonus
        newBoard[r][c] = powerPiece;
        const nextAcc = baseAcc.clone();
        if (oldPiece) nextAcc.removePiece(oldPiece, r, c);
        nextAcc.addPiece(powerPiece, r, c);

        let score = evaluate(newBoard, gameState, nextAcc);

        // Always add our strategic placement bonus on top (works even when NNUE is absent)
        const pBonus = placementBonus(baseType, pixieName, r, c, color);
        // For white, higher score is better. For black, lower score is better.
        // We normalize: always maximize the "value for our side"
        const signedBonus = color === 'w' ? pBonus : -pBonus;
        score += signedBonus;

        // Normalize: always compare as "white-perspective" value for our color
        const normalizedScore = color === 'w' ? score : -score;

        if (normalizedScore > bestScore) {
          bestScore = normalizedScore;
          bestChoice = { pixieIndex: pIdx, square: [r, c], powerPiece };
        }

        // Revert
        newBoard[r][c] = oldPiece;
      }
    }

    if (!bestChoice) break; // No valid placement found

    // Commit
    const { pixieIndex, square: [br, bc], powerPiece } = bestChoice;
    const finalPiece: Piece = {
      ...powerPiece,
      id: `auto_${powerPiece.pixie}_${br}_${bc}`,
      state: initPieceState(powerPiece.pixie as string) as any,
    };

    const oldPiece = newBoard[br][bc];
    newBoard[br][bc] = finalPiece;
    if (oldPiece) baseAcc.removePiece(oldPiece, br, bc);
    baseAcc.addPiece(finalPiece, br, bc);

    usedSquares.add(`${br},${bc}`);
    remainingLoadout.splice(pixieIndex, 1);
  }

  return newBoard;
}

