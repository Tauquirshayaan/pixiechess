import { useGameStore } from '../store/gameStore';

const SYMS: Record<string, Record<string, string>> = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛' },
};

const PIECE_NAMES: Record<string, string> = {
  Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn',
};

const PIECES = ['Q', 'R', 'B', 'N', 'P'] as const;

/** Creates a floating emoji element used as drag ghost (shows only the piece, no box) */
function makeDragGhost(sym: string, colorHex: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:-200px', 'left:-200px',
    'font-size:52px', 'line-height:1',
    'pointer-events:none', 'user-select:none',
    `color:${colorHex}`,
  ].join(';');
  el.textContent = sym;
  document.body.appendChild(el);
  return el;
}

export default function SparePiecesRow({ color }: { color: 'w' | 'b' }) {
  const selectPlacement = useGameStore(s => s.selectPlacement);

  const handleSelect = (type: typeof PIECES[number]) => {
    selectPlacement({ type, pixie: null, color });
  };

  const pieceColor = color === 'w' ? '#FFFDE7' : '#1A1A2E';
  const textShadow = color === 'w' ? '0 2px 4px rgba(0,0,0,.9)' : '0 2px 4px rgba(255,255,255,.15)';

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      justifyContent: 'center',
      padding: '6px 0',
      background: 'rgba(124,58,237,0.06)',
      borderRadius: 8,
    }}>
      {PIECES.map(p => (
        <div
          key={p}
          draggable
          title={`${color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p]}`}
          onClick={() => handleSelect(p)}
          onDragStart={(e) => {
            handleSelect(p);
            e.dataTransfer.effectAllowed = 'move';   // must match ChessSquare dropEffect
            const ghost = makeDragGhost(SYMS[color][p], pieceColor);
            e.dataTransfer.setDragImage(ghost, 26, 26);
            setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
          }}
          style={{
            fontSize: 44,
            cursor: 'grab',
            color: pieceColor,
            textShadow: textShadow,
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.18))',
            userSelect: 'none',
            padding: '0 4px',
            borderRadius: 6,
            transition: 'transform .1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {SYMS[color][p]}
        </div>
      ))}
    </div>
  );
}
