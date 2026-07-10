import type { Board, PixieType, GameState } from './types';

// Map standard piece characters to 0-5
const StandardPieceMap: Record<string, number> = {
  'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5
};

// Map PixieType string literals to 6-37 (Matching C++ types.h)
const PixieTypeMap: Record<PixieType, number> = {
  // Pawns (6-13)
  'GOLDEN_PAWN': 6, 'IRONPAWN': 7, 'EPEE_PAWN': 8, 'PAWN_KNIFE': 9,
  'HERO_PAWN': 10, 'SHRIKE': 11, 'WARP_JUMPER': 12, 'WAR_AUTOMATON': 13,
  // Knights (14-19)
  'ELECTROKNIGHT': 14, 'BANKER': 15, 'CAMEL': 16, 'KNIGHTMARE': 17, 'ANTI_VIOLENCE': 18,
  'FISH_KNIGHT': 19,
  // Bishops (20-31)
  'ARISTOCRAT': 20, 'BASILISK': 21, 'BLADERUNNER': 22, 'BOUNCER': 23, 'PILGRIM': 24,
  'DANCER': 25, 'DJINN': 26, 'GUNSLINGER': 27, 'CARDINAL': 28, 'ICICLE': 29,
  'HORDE_MOTHER': 30, 'MARAUDER': 31,
  // Rooks (32-33)
  'PHASE_ROOK': 32, 'SUMOROOK': 33,
  // Queens (34)
  'FISSION_REACTOR': 34,
  // Summons (35)
  'HORDELING': 35
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
        if (piece.pixie && (piece.pixie as string) !== 'NONE') {
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
          let electro_moves = st.ek_moves || 0;
          let electro_idle = st.ek_idle || 0;
          let marauder = st.kill_count || 0;
          let fission = st.capture_count || 0;
          let used = (st.resurrected || st.has_moved) ? 1 : 0;
          let pilgrimDist = st.total_dist || 0;
          let djinnDiss = st.dissipated ? 1 : 0;
          
          let djinnHome = 64;
          if (st.home_sq) {
             const hr = 7 - st.home_sq[0];
             djinnHome = hr * 8 + st.home_sq[1];
          }
          
          let dancerBonus = st.bonus_moves || 0;
          let dancerAct = (st.active_flag && piece.color === sideToMove) ? 1 : 0;
          
          let gunEncoded = 0xFFFFFFFF;
          if (st.gs_targets) {
            for (let i = 0; i < st.gs_targets.length && i < 4; i++) {
              const tgt = st.gs_targets[i];
              const gr = 7 - tgt.sq[0];
              const sq = gr * 8 + tgt.sq[1];
              const ply = tgt.ply;
              const byte = (sq & 0x3F) | ((ply & 0x3) << 6);
              // clear byte
              gunEncoded &= ~(0xFF << (i * 8));
              // set byte
              gunEncoded |= (byte << (i * 8));
            }
          }
          
          let fishMoved = st.moved_last_turn ? 1 : 0;
          
          // Convert gunEncoded to signed int32 to prevent C++ std::stoi overflow
          // (0xFFFFFFFF = 4294967295 unsigned but -1 as signed int32; C++ uses int)
          const gunEncodedSigned = gunEncoded | 0;
          
          // sq,frozen,electro_moves,electro_idle,marauder,fission,used,pilgrim,djinn_diss,djinn_home,dancer_bonus,dancer_act,gun_encoded,fish_moved
          abilityStates.push(`${sq},${frozenTurns},${electro_moves},${electro_idle},${marauder},${fission},${used},${pilgrimDist},${djinnDiss},${djinnHome},${dancerBonus},${dancerAct},${gunEncodedSigned},${fishMoved}`);
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
    const cppRank = 7 - gameState.enPassant[0];
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
      const cppR = 7 - ob.obSq[0];
      const cppC = ob.obSq[1];
      const encoded = ((cppR + 3) << 4) | (cppC + 3);
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
