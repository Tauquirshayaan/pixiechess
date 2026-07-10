import { generatePixieMoves } from './src/engine-v2/pixieGen';
import { bit, sq, ZERO } from './src/engine-v2/bitboard';

// mock state
const state = {
  whiteAll: bit(sq(6, 4)),
  blackAll: bit(sq(5, 3)),
  empty: ~ (bit(sq(6, 4)) | bit(sq(5, 3))),
  occupied: bit(sq(6, 4)) | bit(sq(5, 3)),
  whitePawns: ZERO,
  blackPawns: ZERO,
  invulnerable: ZERO,
  activePixies: [
    { sq: sq(6, 4), type: 'WARP_JUMPER', color: 'w' }
  ]
};

const moves = generatePixieMoves(state as any, 'w', {} as any);
console.log("Generated Moves:", JSON.stringify(moves));
