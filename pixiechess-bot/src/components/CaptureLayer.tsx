import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { PIECE_CATALOG } from '../data/pieceCatalog';

const SYMS: Record<string, Record<string, string>> = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' },
};

// ── Which column index in SparePiecesRow each piece type maps to ──
const SPARE_COL: Record<string, number> = { Q: 0, R: 1, B: 2, N: 3, P: 4 };

export default function CaptureLayer() {
  const captures    = useGameStore(s => s.captures);
  const removeCapture = useGameStore(s => s.removeCapture);
  const flipped     = useGameStore(s => s.flipped);

  // Remove each capture after animation finishes (800 ms)
  useEffect(() => {
    const timers = captures.map(cap => setTimeout(() => removeCapture(cap.id), 800));
    return () => timers.forEach(clearTimeout);
  }, [captures, removeCapture]);


  // The GameScreen layout is a relative column:
  // 1. SparePiecesRow (top, height ~56px)
  // 2. Gap (6px)
  // 3. ChessBoard (grid starts at y=62, x=24; grid height=576)
  // 4. Gap (6px)
  // 5. SparePiecesRow (bottom, starts at 62 + 600 + 6 = 668)
  
  const BOARD_START_Y = 62;
  const BOARD_START_X = 24;

  const TOP_SPARE_CY = 28; // Center Y of top spare row
  const BOT_SPARE_CY = 668 + 28; // Center Y of bottom spare row

  // Spare pieces are centered in a 600px width.
  // 5 icons * ~52px width + 4 * 6px gaps = 284px total.
  // Left padding = (600 - 284) / 2 = 158px.
  // First icon center = 158 + 26 = 184px.
  const SPARE_START_CX = 184;
  const SPARE_STEP_X   = 58;

  return (
    <>
      <style>{`
        @keyframes captureToSpare {
          0%   { opacity: 1; transform: translate(0, 0) scale(1); }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.6); }
        }
      `}</style>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 100,
      }}>
        {captures.map(cap => {
          // Visual row/col accounting for board flip
          const vr = flipped ? 7 - cap.from[0] : cap.from[0];
          const vc = flipped ? 7 - cap.from[1] : cap.from[1];

          const meta = cap.piece.pixie ? PIECE_CATALOG[cap.piece.pixie] : null;
          const base = cap.piece.pixie ? PIECE_CATALOG[cap.piece.pixie].base : cap.piece.type;
          const sym  = SYMS[cap.piece.color][base];

          // Target spare icon column
          const spareColIdx = SPARE_COL[base] ?? 2;
          const destCX = SPARE_START_CX + spareColIdx * SPARE_STEP_X;

          // Black pieces → top spare row (unless flipped), White → bottom spare row
          const goesTop = cap.piece.color === 'b' ? !flipped : flipped;
          const destCY = goesTop ? TOP_SPARE_CY : BOT_SPARE_CY;

          // Starting coordinates (top-left of 72x72 piece div)
          const startX = BOARD_START_X + vc * 72;
          const startY = BOARD_START_Y + vr * 72;

          // Delta x, y to reach the destination
          const dx = (destCX - 36) - startX;
          const dy = (destCY - 36) - startY;

          return (
            <div
              key={cap.id}
              style={{
                position: 'absolute',
                top: startY,
                left: startX,
                width: 72,
                height: 72,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'captureToSpare 0.65s ease-in-out forwards',
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
              } as React.CSSProperties}
            >
              <span style={{
                fontSize: 48,
                color: meta ? meta.color : (cap.piece.id?.startsWith('hordeling_') ? '#C084FC' : (cap.piece.color === 'w' ? '#FFFDE7' : '#1A1A2E')),
                textShadow: cap.piece.color === 'w' ? '0 2px 4px rgba(0,0,0,0.9)' : '0 2px 4px rgba(255,255,255,0.15)',
                filter: meta ? `drop-shadow(0 0 7px ${meta.color}aa)` : 'none',
              }}>
                {sym}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
