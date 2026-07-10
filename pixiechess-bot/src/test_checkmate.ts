import { getAllMovesForColor, isCheck } from './engine/moveGenerator';
import type { GameState, Board } from './engine/types';

const gs: GameState = {
  frozen: [], paralyzed: {w:[], b:[]}, doomed: {}, turn: 2,
  castling: {K:false, Q:false, k:false, q:false},
  offBoardPieces: [], pendingIcicle: [], deadPieces: [], promotionBlock: false
};

const b: Board = Array(8).fill(null).map(() => Array(8).fill(null));

// White pieces
b[7][6] = {type:'Q', color:'w', id:'1', state:{}}; // g1
b[7][5] = {type:'R', color:'w', id:'2', state:{}}; // f1
b[7][4] = {type:'B', color:'w', id:'3', state:{}}; // e1
b[7][3] = {type:'N', color:'w', id:'4', state:{}}; // d1
b[7][2] = {type:'B', color:'w', id:'5', state:{}}; // c1
b[7][0] = {type:'R', color:'w', id:'6', state:{}}; // a1

b[6][1] = {type:'P', color:'w', id:'9', state:{}}; // b2
b[6][0] = {type:'P', color:'w', id:'10', state:{}}; // a2

b[5][6] = {type:'P', color:'w', id:'11', state:{}}; // g3
b[5][4] = {type:'P', color:'w', id:'12', state:{}}; // e3
b[5][2] = {type:'K', color:'w', id:'13', state:{}}; // c3

b[4][2] = {type:'P', color:'w', id:'14', state:{}}; // c4

// Black pieces
b[6][7] = {type:'R', color:'b', pixie:'PHASE_ROOK', id:'7', state:{}}; // h2
b[6][2] = {type:'Q', color:'b', id:'8', state:{}}; // c2 (checking Queen)

b[4][6] = {type:'P', color:'b', pixie:'SHRIKE', id:'15', state:{has_moved:true}}; // g4
b[4][4] = {type:'P', color:'b', id:'16', state:{}}; // e4

b[3][6] = {type:'P', color:'b', id:'17', state:{}}; // g5
b[3][3] = {type:'P', color:'b', id:'18', state:{}}; // d5
b[3][2] = {type:'P', color:'b', id:'19', state:{}}; // c5

b[1][1] = {type:'P', color:'b', id:'20', state:{}}; // b7
b[1][0] = {type:'P', color:'b', id:'21', state:{}}; // a7

b[0][6] = {type:'K', color:'b', id:'22', state:{}}; // g8
b[0][0] = {type:'R', color:'b', id:'23', state:{}}; // a8

console.log('isCheck for White:', isCheck(b, 'w', gs));
const moves = getAllMovesForColor(b, 'w', gs);
console.log('White legal moves count:', moves.length);
moves.forEach(m => console.log(`from ${m.from} to ${m.to} (capture: ${m.capture})`));
