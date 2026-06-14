import type { Move, Piece, Board } from '../engine/types';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import { useGameStore } from '../store/gameStore';

const sq = (r: number, c: number) => String.fromCharCode(97 + c) + (8 - r);
const FILE = (c: number) => String.fromCharCode(97 + c);



interface Props {
  isCalculating: boolean;
  pendingResult: {
    move: Move;
    score: number;
    nodes: number;
    effects: string[];
    piece: Piece | null;
    depth?: number;
    ttHits?: number;
    multiPv?: { move: Move; score: number }[];
    board?: Board;
  } | null;
  error: string | null;
  winMsg: string | null;
  evalStream?: { score?: number, depth?: number, pv?: string, nodes?: number } | null;
  onApply: () => void;
  onSelectPv?: (previewMove: Move, pvScore: number) => void;
}

/** Generate a SAN string for a move given the current board state. */
function moveToSAN(move: Move, piece: Piece | null, effects: string[] = []): string {
  if (!piece) return `${sq(move.from[0], move.from[1])}→${sq(move.to[0], move.to[1])}`;

  // Castling detection: king moves 2 squares
  if (piece.type === 'K' && Math.abs(move.to[1] - move.from[1]) === 2) {
    const san = move.to[1] === 6 ? 'O-O' : 'O-O-O';
    return san + (effects.includes('CHECK') ? '+' : effects.includes('PIXIE_WIN') ? '#' : '');
  }

  const base = piece.pixie ? PIECE_CATALOG[piece.pixie].base : piece.type;
  const dest = sq(move.to[0], move.to[1]);
  const isPawn = base === 'P';
  let san = '';

  if (isPawn) {
    if (move.capture || move.epCapSq) {
      san = FILE(move.from[1]) + 'x' + dest;
    } else {
      san = dest;
    }
    if (move.promotion) san += '=' + move.promotion;
  } else {
    const pieceChar = base === 'K' ? 'K' : base;
    san = pieceChar + (move.capture ? 'x' : '') + dest;
  }

  if (effects.includes('CHECK')) san += '+';
  if (effects.includes('PIXIE_WIN')) san += '#';
  return san;
}

export default function ResultPanel({ isCalculating, pendingResult, error, winMsg, evalStream, onApply, onSelectPv }: Props) {
  if (isCalculating) {
    if (!evalStream) return null;
    return (
      <div style={{ 
        display: 'flex', flexDirection: 'column', gap: 6, padding: '12px', marginTop: 4,
        background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#94A3B8', fontSize: 16, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#10B981', borderRadius: '50%', marginRight: 6, animation: 'pulse 1.5s infinite' }} />
              <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }`}</style>
              Live Eval
            </span>
            {evalStream.score !== undefined && (
              <span style={{ color: '#111827', fontSize: 16, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>
                {evalStream.score > 0 ? '+' : ''}{(evalStream.score / 100).toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div style={{ color: '#64748B', fontSize: 13, fontWeight: 500, fontFamily: "'Inter', sans-serif", letterSpacing: 0.2, display: 'flex', justifyContent: 'space-between' }}>
          <span>{evalStream.pv ? evalStream.pv.split(' ').slice(0, 3).join(' ') + '...' : 'Searching...'}</span>
          <span style={{ color: '#94A3B8' }}>Depth {evalStream.depth || 0}</span>
        </div>
      </div>
    );
  }

  if (winMsg) {
    return (
      <div style={{ padding: '4px 8px' }}>
        <div style={{ color: '#D97706', fontSize: 16, fontWeight: 500 }}>{winMsg}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '4px 8px' }}>
        <div style={{ color: '#EF4444', fontSize: 16, fontWeight: 500 }}>✕ {error}</div>
      </div>
    );
  }

  if (!pendingResult) return null;

  const { move, score, effects, piece } = pendingResult;
  const mainSan = moveToSAN(move, piece, effects);

  const handlePreviewAndSelect = (e: React.MouseEvent, previewMove: Move, pvScore: number) => {
    e.stopPropagation();
    if (!previewMove || !pendingResult.board) return;
    const store = useGameStore.getState();
    
    if (onSelectPv) {
      onSelectPv(previewMove, pvScore);
    } else {
      store.setPendingResult({
        ...pendingResult,
        move: previewMove,
        score: pvScore
      });
    }

    // 1. Instantly reset board to pre-calc state
    store.setBoard(pendingResult.board);
    store.setLastMove(null, null);

    // 2. After a tiny delay, execute the move to show animation
    setTimeout(() => {
      const tempBoard = pendingResult.board!.map(row => [...row]);
      const pieceToMove = tempBoard[previewMove.from[0]][previewMove.from[1]];
      if (!pieceToMove) return;
      
      tempBoard[previewMove.from[0]][previewMove.from[1]] = null;
      tempBoard[previewMove.to[0]][previewMove.to[1]] = pieceToMove;
      
      store.setBoard(tempBoard);
      store.setLastMove(previewMove.from, previewMove.to);
    }, 150);
  };

  return (
    <div 
      style={{ 
        display: 'flex', flexDirection: 'column', gap: 4, padding: '12px', marginTop: 4,
        background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8
      }}
    >
      <div 
        onClick={(e) => handlePreviewAndSelect(e, move, score)}
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#7C3AED', fontSize: 18, fontWeight: 800, fontFamily: "'Inter', sans-serif" }}>
              {mainSan}
            </span>
            <span style={{ color: '#111827', fontSize: 16, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>
              {score > 0 ? '+' : ''}{(score / 100).toFixed(2)}
            </span>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            style={{
              background: '#10B981', color: 'white', border: 'none', borderRadius: 6,
              padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Inter', sans-serif"
            }}
          >
            APPLY
          </button>
        </div>
        <div style={{ color: '#64748B', fontSize: 13, fontWeight: 500, fontFamily: "'Inter', sans-serif", letterSpacing: 0.2, display: 'flex', justifyContent: 'space-between' }}>
          <span>Engine Evaluation</span>
          <span style={{ color: '#94A3B8' }}>Depth {pendingResult.depth || 0}</span>
        </div>
      </div>

      {pendingResult.multiPv && pendingResult.multiPv.length > 1 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 2 }}>Alternative Lines</div>
          {pendingResult.multiPv.map((pv, i) => {
            // Skip rendering the currently selected move in the alt list
            if (pv.move.from[0] === move.from[0] && pv.move.from[1] === move.from[1] && pv.move.to[0] === move.to[0] && pv.move.to[1] === move.to[1]) return null;
            
            return (
              <div 
                key={i} 
                onClick={(e) => handlePreviewAndSelect(e, pv.move, pv.score)}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748B', fontFamily: "'Inter', sans-serif", cursor: 'pointer', padding: '6px 8px', background: '#F1F5F9', borderRadius: 4 }}
              >
                <span style={{ color: '#475569', fontWeight: 600 }}>{moveToSAN(pv.move, null, [])}</span>
                <span style={{ fontWeight: 600 }}>{pv.score > 0 ? '+' : ''}{(pv.score / 100).toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
