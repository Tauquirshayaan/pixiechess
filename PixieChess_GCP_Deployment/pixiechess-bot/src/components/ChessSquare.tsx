import type { Piece } from '../engine/types';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import { motion } from 'framer-motion';

const SYMS: Record<string, Record<string, string>> = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' },
};

interface Props {
  r: number;
  c: number;
  piece: Piece | null;
  bg: string;
  isValidMove?: boolean;
  isCapture?: boolean;
  isGlowFrom?: boolean;
  isGlowTo?: boolean;
  isThreatened?: boolean;
  isEnPassantTarget?: boolean;
  isParalyzed?: boolean;
  isFrozen?: boolean;
  isPendingFreeze?: boolean;
  isBladeThru?: boolean;
  isDuelSquare?: boolean;
  isDjinnHome?: boolean;
  draggable?: boolean;
  isPlaceMode?: boolean;
  isSuggestedPlacement?: boolean;
  onSquareClick?: (r: number, c: number) => void;
  onDragStart?: (r: number, c: number) => void;
  onDrop?: (r: number, c: number) => void;
  onPieceHover?: (piece: Piece | null) => void;
  style?: React.CSSProperties;
}

export default function ChessSquare({
  r, c, piece, bg,
  isValidMove, isCapture, isGlowFrom, isGlowTo, isThreatened, isEnPassantTarget,
  isParalyzed, isFrozen, isPendingFreeze, isBladeThru, isDuelSquare, isDjinnHome,
  draggable, isPlaceMode, isSuggestedPlacement,
  onSquareClick, onDragStart, onDrop, onPieceHover, style
}: Props) {
  const meta = piece?.pixie ? PIECE_CATALOG[piece.pixie] : null;
  const base = piece ? (piece.pixie ? PIECE_CATALOG[piece.pixie].base : piece.type) : null;
  const sym  = base ? SYMS[piece!.color][base] : null;

  const isCharged       = piece?.pixie === 'ELECTROKNIGHT' && piece.state?.is_charged;
  const isMarauderGrown = piece?.pixie === 'MARAUDER' && (piece.state?.kill_count || 0) > 0;
  const isDancerActive  = piece?.pixie === 'DANCER' && piece.state?.active_flag;
  const isDuelTarget    = piece?.pixie === 'GUNSLINGER' && piece.state?.mutual_target;
  const fissionCount    = piece?.pixie === 'FISSION_REACTOR' ? (piece.state?.capture_count || 0) : 0;
  const pilgrimDist     = piece?.pixie === 'PILGRIM' ? (piece.state?.total_dist || 0) : 0;
  const marauderKills   = piece?.pixie === 'MARAUDER' ? (piece.state?.kill_count || 0) : 0;

  // ── Safe drag-image creator: builds a temporary off-screen element ──────
  // We do NOT use useRef or append to body in ways React can't track.
  // Instead we create a fresh detached node, set it as drag image, then
  // remove it with setTimeout(0) after the browser has captured the snapshot.
  function makePieceDragImage(symbol: string, colorHex: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'top:-200px',
      'left:-200px',
      'font-size:54px',
      'line-height:1',
      'pointer-events:none',
      'user-select:none',
      `color:${colorHex}`,
    ].join(';');
    el.textContent = symbol;
    document.body.appendChild(el);
    return el;
  }

  return (
    <div
      onClick={() => onSquareClick?.(r, c)}
      onDragOver={(e: any) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = isPlaceMode ? 'copy' : 'move';
      }}
      onDrop={(e: any) => {
        e.preventDefault();
        onDrop?.(r, c);
      }}
      style={{
        width: 72,
        height: 72,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .12s',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* ── Red glow border — last-move from-square ── */}
      {isGlowFrom && (
        <div style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 0 3px rgba(239,68,68,0.4), 0 0 12px 3px rgba(239,68,68,0.25)',
          pointerEvents: 'none',
          zIndex: 1,
          borderRadius: 1,
        }} />
      )}

      {/* ── Red glow border — last-move to-square ── */}
      {isGlowTo && (
        <div style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 0 3px rgba(239,68,68,0.4), 0 0 12px 3px rgba(239,68,68,0.25)',
          pointerEvents: 'none',
          zIndex: 1,
          borderRadius: 1,
        }} />
      )}

      {/* ── AI Suggested Placement Glow ── */}
      {isSuggestedPlacement && !piece && (
        <div style={{
          position: 'absolute', inset: 0,
          boxShadow: 'inset 0 0 15px rgba(234,179,8,0.9), 0 0 25px rgba(234,179,8,0.7)',
          animation: 'pulse-glow 1.5s infinite',
          pointerEvents: 'none', zIndex: 5, borderRadius: 2
        }}>
          <style>{`
            @keyframes pulse-glow {
              0% { opacity: 0.5; transform: scale(0.98); }
              50% { opacity: 1; transform: scale(1); }
              100% { opacity: 0.5; transform: scale(0.98); }
            }
          `}</style>
        </div>
      )}

      {/* ── Yellow dot — valid empty-square move ── */}
      {isValidMove && !piece && (
        <div style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'rgba(255, 215, 0, 0.88)',
          boxShadow: '0 0 8px rgba(255,215,0,0.5)',
          zIndex: 10,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── Yellow ring — capturable enemy piece ── */}
      {isCapture && piece && !isDuelSquare && (
        <div style={{
          position: 'absolute',
          inset: 4,
          borderRadius: '50%',
          border: '4px solid rgba(255, 215, 0, 0.8)',
          pointerEvents: 'none',
          zIndex: 10,
        }} />
      )}

      {/* ── Red Slash — Bladerunner passing-through capture path ── */}
      {isBladeThru && (
        <div style={{
          position: 'absolute',
          inset: 4,
          borderRadius: '4px',
          background: 'rgba(239, 68, 68, 0.25)',
          border: '2px dashed rgba(239, 68, 68, 0.8)',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%) rotate(45deg)',
            width: '120%', height: 2, background: 'rgba(239, 68, 68, 0.5)'
          }} />
        </div>
      )}

      {/* ── Crosshair — Gunslinger Duel Square ── */}
      {isDuelSquare && (
        <div style={{
          position: 'absolute',
          inset: 2,
          borderRadius: '50%',
          border: '3px solid #EF4444',
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.9), inset 0 0 8px rgba(239, 68, 68, 0.5)',
          pointerEvents: 'none',
          zIndex: 11,
          animation: 'pulse-crosshair 1s infinite',
        }}>
          <style>{`
            @keyframes pulse-crosshair {
              0% { transform: scale(0.95); opacity: 0.8; }
              50% { transform: scale(1.05); opacity: 1; }
              100% { transform: scale(0.95); opacity: 0.8; }
            }
          `}</style>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#EF4444' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#EF4444' }} />
        </div>
      )}

      {/* ── Red dot — threatened enemy piece ── */}
      {isThreatened && piece && (
        <div style={{
          position: 'absolute',
          top: 5,
          right: 5,
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: '#EF4444',
          border: '1.5px solid rgba(255,255,255,0.7)',
          boxShadow: '0 0 6px rgba(239,68,68,0.9)',
          zIndex: 15,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── En-passant marker ── */}
      {isEnPassantTarget && !piece && (
        <div style={{
          position: 'absolute',
          fontSize: 28,
          color: 'rgba(239,68,68,0.4)',
          fontWeight: 900,
          zIndex: 5,
          pointerEvents: 'none',
        }}>✕</div>
      )}

      {/* ── Pending Freeze Warning (Icicle) ── */}
      {isPendingFreeze && !isFrozen && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(147, 197, 253, 0.25)', // light blue tint
          boxShadow: 'inset 0 0 10px rgba(147, 197, 253, 0.6)',
          zIndex: 4,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── Djinn Home Square ── */}
      {isDjinnHome && !piece && (
        <div style={{
          position: 'absolute',
          inset: 15,
          borderRadius: '50%',
          border: '2px dashed rgba(168, 85, 247, 0.6)', // purple dashed
          background: 'rgba(168, 85, 247, 0.1)',
          zIndex: 4,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── Piece ── */}
      {piece && sym && (
        <motion.div
          layoutId={piece.id}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
          draggable={draggable}
          onMouseEnter={() => onPieceHover?.(piece)}
          onMouseLeave={() => onPieceHover?.(null)}
          onDragStart={(e: any) => {
            if (!draggable) { e.preventDefault(); return; }
            e.dataTransfer.effectAllowed = 'move';

            // Build a clean floating ghost — only the emoji, no tile background.
            // We append it off-screen, snapshot it, then remove it safely with
            // setTimeout(0) (fires after the browser's drag-image capture).
            const isHordeling = piece.id.startsWith('hordeling_');
            const pieceColor = meta
              ? meta.color
              : isHordeling ? '#C084FC' : (piece.color === 'w' ? '#FFFDE7' : '#1A1A2E');
            const ghost = makePieceDragImage(sym, pieceColor);
            e.dataTransfer.setDragImage(ghost, 27, 27);
            setTimeout(() => {
              if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
            }, 0);

            onDragStart?.(r, c);
          }}
          onDragEnd={(e: any) => {
            // Dropped outside any valid drop target → erase piece from board
            if (e.dataTransfer.dropEffect === 'none') {
              import('../store/gameStore').then(m =>
                m.useGameStore.getState().erasePiece(r, c)
              );
            }
          }}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            cursor: draggable ? 'grab' : 'pointer',
          }}
        >
          <span style={{
            fontSize: 48,
            lineHeight: 1,
            zIndex: 2,
            position: 'relative',
            color: (piece.isBlueprint || piece.pixie === 'HERO_PAWN') ? 'transparent' : (meta ? meta.color : (piece.id.startsWith('hordeling_') ? '#C084FC' : (piece.color === 'w' ? '#FFFDE7' : '#1A1A2E'))),
            backgroundImage: piece.isBlueprint ? 'linear-gradient(to bottom, #FACC15 50%, #C0C0C0 50%)' : (piece.pixie === 'HERO_PAWN' ? 'linear-gradient(to bottom, #DC2626 50%, #38BDF8 50%)' : 'none'),
            WebkitBackgroundClip: (piece.isBlueprint || piece.pixie === 'HERO_PAWN') ? 'text' : undefined,
            WebkitTextFillColor: (piece.isBlueprint || piece.pixie === 'HERO_PAWN') ? 'transparent' : undefined,
            textShadow: piece.color === 'w'
              ? '0 2px 4px rgba(0,0,0,.9)'
              : '0 2px 4px rgba(255,255,255,.15)',
            filter: meta ? `drop-shadow(0 0 7px ${meta.color}aa)` : 'none',
            pointerEvents: 'none', // prevent span from intercepting drag events
          }}>
            {sym}
          </span>

          {/* Side color dot (White/Black indicator) */}
          {meta && (
            <div style={{
              position: 'absolute',
              bottom: 3, left: 3,
              width: 8, height: 8,
              borderRadius: '50%',
              background: piece.color === 'w' ? '#FFF' : '#000',
              border: piece.color === 'w' ? '1px solid #000' : '1px solid #FFF',
              zIndex: 3,
              pointerEvents: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }} />
          )}

          {/* Electroknight charged glow */}
          {isCharged && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 4,
            }}>
              <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 4px #38BDF8)' }}>⚡</span>
            </div>
          )}

          {/* Marauder grown indicator */}
          {isMarauderGrown && (
            <div style={{
              position: 'absolute', inset: 0,
              border: '2px solid #F43F5E',
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 4,
              boxShadow: 'inset 0 0 10px #F43F5E60',
            }} />
          )}

          {/* Dancer Active glow */}
          {isDancerActive && (
            <div style={{
              position: 'absolute', inset: 0,
              border: '2px solid #D946EF',
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 4,
              boxShadow: 'inset 0 0 10px #D946EF60, 0 0 10px #D946EF80',
            }} />
          )}

          {/* Gunslinger Duel Target */}
          {isDuelTarget && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 4,
            }}>
              <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 4px #EF4444)', opacity: 0.8 }}>🎯</span>
            </div>
          )}

          {/* Fission Reactor warning */}
          {piece?.pixie === 'FISSION_REACTOR' && fissionCount > 0 && (
            <div style={{
              position: 'absolute', top: -4, left: -4,
              background: fissionCount >= 4 ? '#EF4444' : '#F59E0B',
              color: '#FFF', fontSize: 10, fontWeight: 'bold',
              padding: '2px 4px', borderRadius: 4, zIndex: 6,
              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
              animation: fissionCount >= 4 ? 'pulse-crosshair 0.5s infinite' : 'none',
            }}>
              ☢️ {fissionCount}/5
            </div>
          )}

          {/* Marauder Kill Count */}
          {piece?.pixie === 'MARAUDER' && marauderKills > 0 && (
            <div style={{
              position: 'absolute', bottom: -4, right: -4,
              background: '#F43F5E', color: '#FFF', fontSize: 10, fontWeight: 'bold',
              padding: '2px 4px', borderRadius: 4, zIndex: 6,
              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
            }}>
              ⚔️ {marauderKills}
            </div>
          )}

          {/* Pilgrim Distance Tracker */}
          {piece?.pixie === 'PILGRIM' && !piece.state?.resurrected && (
            <div style={{
              position: 'absolute', bottom: -4, left: -4,
              background: '#8B5CF6', color: '#FFF', fontSize: 10, fontWeight: 'bold',
              padding: '2px 4px', borderRadius: 4, zIndex: 6,
              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
            }}>
              {pilgrimDist}/20
            </div>
          )}

          {/* Paralyzed indicator */}
          {isParalyzed && (
            <div style={{
              position: 'absolute',
              top: -6, right: -6,
              fontSize: 18,
              zIndex: 15,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 2px #000)',
            }} title="Paralyzed">
              ✋
            </div>
          )}

          {/* Frozen indicator */}
          {isFrozen && (
            <div style={{
              position: 'absolute',
              top: -6, left: -6,
              fontSize: 18,
              zIndex: 15,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 2px #000)',
            }} title="Frozen">
              ❄️
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
