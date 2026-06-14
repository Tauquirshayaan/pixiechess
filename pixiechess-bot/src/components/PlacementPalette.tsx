import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import type { PixieType, Piece } from '../engine/types';

const T = {
  card: '#FFFFFF',
  border: '#D4C8EC',
  borderAct: '#7C3AED',
  textPrimary: '#1E1535',
  textSec: '#6B5F8A',
  textMuted: '#9B90B8',
  accent: '#7C3AED',
  accentSoft: '#EDE9FF',
  btnBg: '#F4F0FA',
  btnBgAct: '#EDE9FF',
};

const SYMS: Record<string, Record<string, string>> = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' },
};

const TABS = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'] as const;
type Tab = typeof TABS[number];

const TAB_BASE: Record<string, string> = {
  Pawn: 'P', Knight: 'N', Bishop: 'B', Rook: 'R', Queen: 'Q', King: 'K',
};

/** Creates a floating emoji ghost — shown during drag, no box or label */
function makePieceDragGhost(sym: string, colorHex: string): HTMLElement {
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

export default function PlacementPalette({ hoveredBoardPiece }: { hoveredBoardPiece?: Piece | null }) {
  const [mainTab, setMainTab] = useState<'Loadout' | 'All'>('Loadout');
  const [tab, setTab] = useState<Tab>('Pawn');
  const [hoverPx, setHoverPx] = useState<PixieType | null>(null);

  const {
    placementColor, setPlacementColor,
    selectedPlacement, selectPlacement,
    loadout, addToLoadout, removeFromLoadout,
    isAdvising, flipped
  } = useGameStore();

  useEffect(() => {
    setPlacementColor(flipped ? 'b' : 'w');
  }, [flipped, setPlacementColor]);

  const filteredPixies = mainTab === 'Loadout'
    ? (loadout as PixieType[])
    : (Object.keys(PIECE_CATALOG) as PixieType[]).filter(key => PIECE_CATALOG[key].base === TAB_BASE[tab]);

  const handleSelectPixie = (pixie: PixieType) => {
    // Toggle: clicking the same piece twice clears the selection
    if (selectedPlacement?.pixie === pixie) {
      selectPlacement(null);
    } else {
      selectPlacement({ type: PIECE_CATALOG[pixie].base, pixie, color: placementColor });
    }
  };

  const tabBtn = (t: Tab): React.CSSProperties => ({
    background: tab === t ? T.btnBgAct : T.btnBg,
    border: `1px solid ${tab === t ? T.borderAct : T.border}`,
    borderRadius: 6,
    color: tab === t ? T.accent : T.textSec,
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    transition: 'all .15s',
  });

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
      {/* Header: PIECES + W/B toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.accent, letterSpacing: 2, textTransform: 'uppercase' }}>Pieces</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['w', 'b'] as const).map(c => (
            <button key={c} onClick={() => setPlacementColor(c)} style={{
              background: placementColor === c ? T.btnBgAct : T.btnBg,
              border: `1px solid ${placementColor === c ? T.borderAct : T.border}`,
              borderRadius: 5, color: placementColor === c ? T.accent : T.textPrimary,
              cursor: 'pointer', padding: '5px 10px', fontSize: 12, fontWeight: 700,
            }}>
              {c === 'w' ? '⬜ W' : '⬛ B'}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tabs (Loadout vs All) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['Loadout', 'All'] as const).map(t => (
          <button key={t} onClick={() => setMainTab(t)} style={{
            flex: 1, background: mainTab === t ? T.btnBgAct : T.btnBg,
            border: `1px solid ${mainTab === t ? T.borderAct : T.border}`,
            borderRadius: 6, color: mainTab === t ? T.accent : T.textSec,
            cursor: 'pointer', fontFamily: "'Inter', sans-serif", padding: '6px',
            fontSize: 13, fontWeight: 700, transition: 'all .15s'
          }}>
            {t === 'Loadout' ? '★ My Loadout' : 'All Pieces'}
          </button>
        ))}
      </div>

      {/* Category tabs (Only show in All Pieces) */}
      {mainTab === 'All' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={tabBtn(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* Selected indicator & AI Advisor */}
      {selectedPlacement?.pixie && (
        <div style={{
          marginBottom: 8, padding: '8px 10px',
          background: T.accentSoft,
          border: `1px solid ${T.borderAct}`,
          borderRadius: 6,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 12, color: T.accent, fontWeight: 700 }}>
            ✦ Selected: {PIECE_CATALOG[selectedPlacement.pixie].label}
          </div>
        </div>
      )}

      {/* Auto Deploy Button (Only in My Loadout) */}
      {mainTab === 'Loadout' && loadout.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => useGameStore.getState().requestAutoDeploy()}
            disabled={isAdvising}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #7C3AED, #9B6FD4)',
              border: 'none', borderRadius: 4, color: '#FFF', padding: '10px',
              fontSize: 14, fontWeight: 800, cursor: isAdvising ? 'wait' : 'pointer',
              display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4,
              boxShadow: '0 4px 12px rgba(124,58,237,0.3)',
              textTransform: 'uppercase'
            }}
          >
            {isAdvising ? 'DEPLOYING...' : 'Auto-Deploy Loadout ✦'}
          </button>
        </div>
      )}

      {/* Power piece grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
        {filteredPixies.map(pixie => {
          const meta   = PIECE_CATALOG[pixie];
          const sym    = SYMS[placementColor][meta.base];
          const active = selectedPlacement?.pixie === pixie;
          return (
            <div key={pixie} style={{ position: 'relative' }}>
              <button
                draggable
                onClick={() => handleSelectPixie(pixie)}
                onDragStart={(e) => {
                  // Select the piece first
                  selectPlacement({ type: meta.base, pixie, color: placementColor });
                  // effectAllowed must be 'move' to match ChessSquare's dropEffect
                  e.dataTransfer.effectAllowed = 'move';
                  // Show only the emoji — no box, no label
                  const ghost = makePieceDragGhost(sym, meta.color);
                  e.dataTransfer.setDragImage(ghost, 26, 26);
                  setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
                }}
                onMouseEnter={() => setHoverPx(pixie)}
                onMouseLeave={() => setHoverPx(null)}
                style={{
                  width: '100%',
                  background: active ? '#F0EBF8' : T.btnBg,
                  border: `2px solid ${active ? meta.color : T.border}`,
                  borderRadius: 8, padding: '6px 8px', cursor: 'grab',
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
                  boxShadow: active ? `0 0 10px ${meta.color}40` : '',
                }}
              >
                <div style={{ position: 'relative' }}>
                  <span style={{ fontSize: 28, flexShrink: 0, color: meta.color, filter: `drop-shadow(0 0 3px ${meta.color}60)` }}>{sym}</span>
                  {/* Side color dot */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0, left: -2,
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: placementColor === 'w' ? '#FFF' : '#000',
                    border: placementColor === 'w' ? '1px solid #000' : '1px solid #FFF',
                    zIndex: 3,
                    pointerEvents: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  }} />
                </div>
                <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: meta.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>
                    {'★'.repeat(Math.ceil(meta.danger / 2))} {meta.danger}/10
                  </div>
                </div>
              </button>

              {/* Loadout Toggle Star */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (loadout.includes(pixie)) removeFromLoadout(pixie);
                  else addToLoadout(pixie);
                }}
                style={{
                  position: 'absolute', top: 4, right: 4, background: 'none',
                  border: 'none', cursor: 'pointer', fontSize: 16,
                  color: loadout.includes(pixie) ? '#F59E0B' : '#D1D5DB',
                  filter: loadout.includes(pixie) ? 'drop-shadow(0 0 2px #F59E0B)' : 'none',
                  zIndex: 2, padding: 2
                }}
                title={loadout.includes(pixie) ? 'Remove from Loadout' : 'Add to Loadout'}
              >
                {loadout.includes(pixie) ? '★' : '☆'}
              </button>

              {/* NO floating tooltip — description shown below grid instead */}
            </div>
          );
        })}
      </div>

      {/* ── Info panel: shows hovered palette piece OR hovered board piece ── */}
      <style>{`
        @media (min-width: 1024px) {
          .pc-fixed-height {
            height: 64px !important;
            box-sizing: border-box !important;
          }
          .pc-fixed-height-placeholder {
            height: 64px !important;
            margin-top: 10px !important;
          }
        }
      `}</style>
      {(() => {
        // Priority: board piece hover > palette piece hover
        if (hoveredBoardPiece && (hoveredBoardPiece.pixie || hoveredBoardPiece.isBlueprint)) {
          const pixieType = hoveredBoardPiece.isBlueprint ? 'BLUEPRINT' : hoveredBoardPiece.pixie!;
          const m = PIECE_CATALOG[pixieType];
          if (m) {
            return (
              <div className="pc-fixed-height" style={{
                marginTop: 10, background: T.accentSoft,
                border: `1px solid ${m.color}40`,
                borderRadius: 8, padding: '6px 10px', fontSize: 13, color: T.textSec, lineHeight: 1.4,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box'
              }}>
                <div style={{ color: m.color, fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, background: hoveredBoardPiece.color === 'w' ? '#EDE9FF' : '#1E1535', color: hoveredBoardPiece.color === 'w' ? '#7C3AED' : '#FFF', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                    {hoveredBoardPiece.color === 'w' ? 'WHITE' : 'BLACK'}
                  </span>
                  {m.label}
                  {m.danger > 1 && (
                    <span style={{ fontSize: 11 }}>{'🔥'.repeat(m.danger)}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {m.isLethal && <span style={{ background: '#FEE2E2', color: '#EF4444', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>LETHAL</span>}
                  {m.isControl && <span style={{ background: '#E0E7FF', color: '#4F46E5', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>CONTROL</span>}
                  {m.isIndestructible && <span style={{ background: '#FEF3C7', color: '#D97706', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>INDESTRUCTIBLE</span>}
                </div>
              </div>
            );
          }
        }
        if (hoverPx && PIECE_CATALOG[hoverPx]) {
          const m = PIECE_CATALOG[hoverPx];
          return (
            <div style={{
              marginTop: 10, background: T.accentSoft,
              border: `1px solid ${m.color}40`,
              borderRadius: 8, padding: 10, fontSize: 13, color: T.textSec, lineHeight: 1.6,
            }}>
              <div style={{ color: m.color, fontWeight: 800, marginBottom: 3, fontSize: 14 }}>
                {m.label}
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {m.isLethal && <span style={{ background: '#FEE2E2', color: '#EF4444', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>LETHAL</span>}
                {m.isControl && <span style={{ background: '#E0E7FF', color: '#4F46E5', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>CONTROL</span>}
                {m.isIndestructible && <span style={{ background: '#FEF3C7', color: '#D97706', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>INDESTRUCTIBLE</span>}
              </div>
              {m.description}
            </div>
          );
        }
        return (
          <div className="pc-fixed-height-placeholder" style={{
            height: 0,
            overflow: 'hidden'
          }} />
        );
      })()}
    </div>
  );
}
