import type { Board, PixieType, GameState } from './types';

// Map standard piece characters to 0-5
const StandardPieceMap: Record<string, number> = {
  'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5
};

// Map PixieType string literals to 6-37 (Matching C++ types.h)
const PixieTypeMap: Record<PixieType, number> = {
  // Pawns
  'GOLDEN_PAWN': 6, 'IRONPAWN': 7, 'BLUEPRINT': 8, 'EPEE_PAWN': 9, 'PAWN_KNIFE': 10,
  'HERO_PAWN': 11, 'SHRIKE': 12, 'WARP_JUMPER': 13, 'WAR_AUTOMATON': 14,
  // Knights
  'ELECTROKNIGHT': 15, 'BANKER': 16, 'CAMEL': 17, 'KNIGHTMARE': 18, 'ANTI_VIOLENCE': 19,
  'PINATA': 20, 'FISH_KNIGHT': 21,
  // Bishops
  'ARISTOCRAT': 22, 'BASILISK': 23, 'BLADERUNNER': 24, 'BOUNCER': 25, 'PILGRIM': 26,
  'DANCER': 27, 'DJINN': 28, 'GUNSLINGER': 29, 'CARDINAL': 30, 'ICICLE': 31,
  'HORDE_MOTHER': 32, 'MARAUDER': 33,
  // Rooks
  'PHASE_ROOK': 34, 'SUMOROOK': 35,
  // Queens
  'FISSION_REACTOR': 36,
  // Kings
  'ROCKETMAN': 37,
  
  'HORDELING': 38
};

export function boardToPFEN(board: Board, sideToMove: 'w' | 'b', gameState: GameState): string {
  const pfenArray: number[] = Array(64).fill(-1);
  const abilityStates: string[] = [];
  
  // C++ mapping: sq = r * 8 + c where r=0 is Rank 8.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      
      if (piece) {
        let typeId = -1;
        if (piece.pixie) {
          typeId = PixieTypeMap[piece.pixie];
        } else {
          typeId = StandardPieceMap[piece.type];
        }
        
        if (piece.color === 'b') {
          typeId += 100;
        }
        
        const cppRank = 7 - r;
        const sq = cppRank * 8 + c;
        pfenArray[sq] = typeId;
        
        // Serialize ability state if piece has custom state or is frozen
        const isFrozen = gameState.frozen.find(f => f.square[0] === r && f.square[1] === c);
        if (piece.state || isFrozen) {
          const st = piece.state || {};
          
          let frozenTurns = isFrozen ? isFrozen.turns_remaining : 0;
          let electro = st.consec_moves || 0;
          let marauder = st.kill_count || 0;
          let fission = st.capture_count || 0;
          let used = (st.used_rocket || st.resurrected) ? 1 : 0;
          let pilgrimDist = st.total_dist || 0;
          let djinnDiss = st.dissipated ? 1 : 0;
          
          let djinnHome = 64;
          if (st.home_sq) {
             const hr = st.home_sq[0];
             djinnHome = hr * 8 + st.home_sq[1];
          }
          
          let dancerBonus = st.bonus_moves || 0;
          let dancerAct = (st.active_flag && piece.color === sideToMove) ? 1 : 0;
          
          let gunTarget = 64;
          if (st.mutual_target) {
             const gr = st.mutual_target[0];
             gunTarget = gr * 8 + st.mutual_target[1];
          }
          let gunPly = st.mutual_ply || 0;
          
          let fishMoved = st.moved_last_turn ? 1 : 0;
          
          // sq,frozen,electro,marauder,fission,used,pilgrim,djinn_diss,djinn_home,dancer_bonus,dancer_act,gun_target,gun_ply,fish_moved
          abilityStates.push(`${sq},${frozenTurns},${electro},${marauder},${fission},${used},${pilgrimDist},${djinnDiss},${djinnHome},${dancerBonus},${dancerAct},${gunTarget},${gunPly},${fishMoved}`);
        }
      }
    }
  }
  
  // Castling rights as a bitmask: 1=WK, 2=WQ, 4=BK, 8=BQ
  let castlingBits = 0;
  if (gameState.castling) {
    if (gameState.castling.K) castlingBits |= 1;
    if (gameState.castling.Q) castlingBits |= 2;
    if (gameState.castling.k) castlingBits |= 4;
    if (gameState.castling.q) castlingBits |= 8;
  }
  
  // En passant square in C++ coordinate system (NO_SQ = 64)
  let epSq = 64; // NO_SQ
  if (gameState.enPassant) {
    const cppRank = gameState.enPassant[0];
    epSq = cppRank * 8 + gameState.enPassant[1];
  }
  
  let deadStr = '';
  if (gameState.deadPieces && gameState.deadPieces.length > 0) {
    const deadIds = gameState.deadPieces.map(p => {
      let typeId = p.pixie ? PixieTypeMap[p.pixie] : StandardPieceMap[p.type];
      if (p.color === 'b') typeId += 100;
      return typeId;
    });
    deadStr = ' ' + deadIds.join(',');
  } else {
    deadStr = ' -'; // To explicitly delimit when no dead pieces
  }

  let abilityStr = '';
  if (abilityStates.length > 0) {
    abilityStr = ' ' + abilityStates.join('|');
  } else {
    abilityStr = ' -';
  }

  let limboStr = '';
  if (gameState.offBoardPieces && gameState.offBoardPieces.length > 0) {
    const wLimbo: number[] = [];
    const bLimbo: number[] = [];
    for (const ob of gameState.offBoardPieces) {
      // TS and C++ both use r=0 for Rank 8
      const cppR = ob.obSq[0];
      const cppC = ob.obSq[1];
      const encoded = ((cppR + 2) << 4) | (cppC + 2);
      if (ob.piece.color === 'w') {
        wLimbo.push(encoded);
      } else {
        bLimbo.push(encoded);
      }
    }
    const wStr = wLimbo.length > 0 ? wLimbo.join(',') : '-';
    const bStr = bLimbo.length > 0 ? bLimbo.join(',') : '-';
    limboStr = ` ${wStr};${bStr}`;
  } else {
    limboStr = ' -;-';
  }

  return `${pfenArray.join(',')} ${sideToMove} ${castlingBits} ${epSq}${deadStr}${abilityStr}${limboStr}`;
}
