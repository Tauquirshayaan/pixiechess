import { nnueWeights, ACCUMULATOR_SIZE, NUM_FEATURES } from './nnueLoader';
import { Board, Piece, GameState } from '../types';

const PIECE_TYPES = [
    'P', 'N', 'B', 'R', 'Q', 'K',
    'GOLDEN_PAWN', 'IRONPAWN', 'BLUEPRINT', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON',
    'ELECTROKNIGHT', 'BANKER', 'CAMEL', 'KNIGHTMARE', 'ANTI_VIOLENCE', 'PINATA', 'FISH_KNIGHT', 'ARISTOCRAT', 'BASILISK',
    'BLADERUNNER', 'BOUNCER', 'PILGRIM', 'DANCER', 'DJINN', 'GUNSLINGER', 'CARDINAL', 'ICICLE', 'HORDE_MOTHER', 'MARAUDER',
    'PHASE_ROOK', 'SUMOROOK', 'FISSION_REACTOR', 'ROCKETMAN', 'HORDELING'
];

const PIECE_TO_IDX: Record<string, number> = {};
PIECE_TYPES.forEach((pt, i) => PIECE_TO_IDX[pt] = i);
const NUM_PIECE_TYPES = PIECE_TYPES.length;

export class StatefulAccumulator {
  public whiteValues: Float32Array;
  public blackValues: Float32Array;

  constructor() {
    this.whiteValues = new Float32Array(ACCUMULATOR_SIZE);
    this.blackValues = new Float32Array(ACCUMULATOR_SIZE);
  }

  // Clone for branching in search tree
  clone(): StatefulAccumulator {
    const acc = new StatefulAccumulator();
    acc.whiteValues.set(this.whiteValues);
    acc.blackValues.set(this.blackValues);
    return acc;
  }

  // Calculate from scratch (used ONLY at root node)
  refresh(board: Board) {
    if (!nnueWeights.isLoaded) return;
    
    // Start with biases
    this.whiteValues.set(nnueWeights.ft_bias);
    this.blackValues.set(nnueWeights.ft_bias);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          this.addPiece(piece, r, c);
        }
      }
    }
  }

  // O(1) Incremental Update (calculates delta between old and new board)
  applyDiff(oldBoard: Board, newBoard: Board) {
    if (!nnueWeights.isLoaded) return;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        // Because applyMove shallow copies unaffected squares, unchanged pieces have the exact same object reference!
        // This makes the comparison practically instant.
        if (oldBoard[r][c] !== newBoard[r][c]) {
          const oldPiece = oldBoard[r][c];
          const newPiece = newBoard[r][c];
          
          if (oldPiece) this.removePiece(oldPiece, r, c);
          if (newPiece) this.addPiece(newPiece, r, c);
        }
      }
    }
  }

  removePiece(piece: Piece, r: number, c: number) {
    const wFeatIdx = getFeatureIndex(piece, r, c, 'w');
    const bFeatIdx = getFeatureIndex(piece, r, c, 'b');
    
    const wWeightOffset = wFeatIdx * ACCUMULATOR_SIZE;
    const bWeightOffset = bFeatIdx * ACCUMULATOR_SIZE;
    
    for (let i = 0; i < ACCUMULATOR_SIZE; i++) {
      this.whiteValues[i] -= nnueWeights.ft_weight[wWeightOffset + i];
      this.blackValues[i] -= nnueWeights.ft_weight[bWeightOffset + i];
    }
  }

  addPiece(piece: Piece, r: number, c: number) {
    const wFeatIdx = getFeatureIndex(piece, r, c, 'w');
    const bFeatIdx = getFeatureIndex(piece, r, c, 'b');
    
    const wWeightOffset = wFeatIdx * ACCUMULATOR_SIZE;
    const bWeightOffset = bFeatIdx * ACCUMULATOR_SIZE;
    
    for (let i = 0; i < ACCUMULATOR_SIZE; i++) {
      this.whiteValues[i] += nnueWeights.ft_weight[wWeightOffset + i];
      this.blackValues[i] += nnueWeights.ft_weight[bWeightOffset + i];
    }
  }
}

export function getFeatureIndex(piece: Piece, r: number, c: number, colorToMove: 'w' | 'b'): number {
  const isMine = piece.color === colorToMove;
  const colorOffset = isMine ? 0 : 1;
  const pt = piece.pixie || piece.type;
  const ptIdx = PIECE_TO_IDX[pt] || 0;
  const squareIdx = r * 8 + c;
  
  return (colorOffset * NUM_PIECE_TYPES * 64) + (ptIdx * 64) + squareIdx;
}
