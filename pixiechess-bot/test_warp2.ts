import { WHITE_PAWN_ATTACKS } from './src/engine-v2/attacks';
import { sq, bit } from './src/engine-v2/bitboard';
const sqE2 = sq(6, 4);
const sqD3 = sq(5, 3);
console.log("sqE2=", sqE2, "sqD3=", sqD3);
console.log("WHITE_PAWN_ATTACKS[sqE2]=", WHITE_PAWN_ATTACKS[sqE2].toString(16));
console.log("bit(sqD3)=", bit(sqD3).toString(16));
