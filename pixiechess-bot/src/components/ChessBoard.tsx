import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import ChessSquare from './ChessSquare';
import type { Move, Piece } from '../engine/types';
import { inBounds } from '../engine/utils';

interface Props {
  validMoves?: Move[];
  threatenedSquares?: [number, number][];
  onSquareClick?: (r: number, c: number) => void;
  onDragStart?: (r: number, c: number) => void;
  onDrop?: (r: number, c: number) => void;
  onPieceHover?: (piece: Piece | null) => void;
}

// ── Purple board colors from reference image ──
const BL = '#C4B1D9';   // Light square — soft lavender
const BD = '#8B6FAE';   // Dark square — rich violet

export default function ChessBoard({ validMoves, threatenedSquares = [], onSquareClick, onDragStart, onDrop, onPieceHover }: Props) {
  const board      = useGameStore(s => s.board);
  const moveSel    = useGameStore(s => s.moveSel);
  const flipped    = useGameStore(s => s.flipped);
  const lastMoveFrom = useGameStore(s => s.lastMoveFrom);
  const lastMoveTo   = useGameStore(s => s.lastMoveTo);
  const enPassant    = useGameStore(s => s.gameState.enPassant);
  const suggestedPlacements = useGameStore(s => s.suggestedPlacements);

  // ── Timed glow: show green glow for 5 s after last move, then fade ──
  const [glowActive, setGlowActive] = useState(false);
  const [glowFrom, setGlowFrom]     = useState<[number,number] | null>(null);
  const [glowTo,   setGlowTo]       = useState<[number,number] | null>(null);

  useEffect(() => {
    if (!lastMoveFrom && !lastMoveTo) {
      // Reset cleared the last move — immediately hide glow
      setGlowActive(false);
      setGlowFrom(null);
      setGlowTo(null);
      return;
    }
    setGlowFrom(lastMoveFrom);
    setGlowTo(lastMoveTo);
    setGlowActive(true);
    const tid = setTimeout(() => setGlowActive(false), 5000);
    return () => clearTimeout(tid);
  }, [lastMoveFrom, lastMoveTo]);

  // Build ordered row/col indices based on flip state
  const rows  = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const cols  = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];

  const offBoardPieces = useGameStore(s => s.gameState.offBoardPieces) || [];
  const paralyzed = useGameStore(s => s.gameState.paralyzed);
  const frozen = useGameStore(s => s.gameState.frozen) || [];
  const pendingIcicle = useGameStore(s => s.gameState.pendingIcicle) || [];
  const dissipatedDjinns = offBoardPieces.filter(ob => ob.piece.pixie === 'DJINN' && ob.piece.state?.dissipated);

  const floatingTiles: React.ReactNode[] = [];
  const renderedOffBoardCoords = new Set<string>();

  const renderFloatingTile = (row: number, col: number, piece: Piece | null, isValidMove: boolean, isCapture: boolean) => {
    const displayRow = flipped ? 7 - row : row;
    const displayCol = flipped ? 7 - col : col;
    const isLight = (row + col) % 2 === 0;
    const bg = isLight ? BL : BD;
    const top = displayRow * 72;
    const left = 24 + displayCol * 72;

    return (
      <ChessSquare
        key={`float-${row}-${col}`}
        r={row} c={col} piece={piece} bg={bg}
        isValidMove={isValidMove && !isCapture}
        isCapture={isCapture}
        draggable={piece !== null}
        isPlaceMode={false}
        isBladeThru={false}
        isDuelSquare={false}
        onSquareClick={onSquareClick}
        onDragStart={onDragStart}
        onDrop={onDrop}
        onPieceHover={onPieceHover}
        style={{
          position: 'absolute',
          top, left,
          width: 72, height: 72,
          zIndex: 50,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          borderRadius: 4,
          opacity: 0.95,
        }}
      />
    );
  };

  for (const ob of offBoardPieces) {
    const [r, c] = ob.obSq;
    renderedOffBoardCoords.add(`${r},${c}`);
    const isValidMove = validMoves?.some(m => m.to[0] === r && m.to[1] === c);
    floatingTiles.push(renderFloatingTile(r, c, ob.piece, !!isValidMove, !!isValidMove));
  }

  if (validMoves) {
    for (const m of validMoves) {
      if (!inBounds(m.to[0], m.to[1])) {
        const key = `${m.to[0]},${m.to[1]}`;
        if (!renderedOffBoardCoords.has(key)) {
          renderedOffBoardCoords.add(key);
          floatingTiles.push(renderFloatingTile(m.to[0], m.to[1], null, true, false));
        }
      }
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 0 60px rgba(139,111,174,0.3), 0 0 0 2px #8B6FAE50',
      }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '24px repeat(8, 72px)',
        gridTemplateRows: 'repeat(8, 72px) 24px',
      }}>
        {rows.map((row, ri) => {
          const rankLabel = (
            <div key={`rl${ri}`} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, color: '#7C3AED', background: '#EDE9FF',
              fontWeight: 700, fontFamily: "'Fira Code', monospace",
            }}>
              {ranks[ri]}
            </div>
          );

          const squares = cols.map((col) => {
            const piece    = board[row][col];
            const isLight  = (row + col) % 2 === 0;
            const isSelected   = moveSel?.[0] === row && moveSel?.[1] === col;
            const isValidMove  = validMoves?.some(m => m.to[0] === row && m.to[1] === col);
            const isCapture    = isValidMove && piece !== null;
            const isThreatened = threatenedSquares.some(([tr, tc]) => tr === row && tc === col);
            const isEnPassantTarget = enPassant?.[0] === row && enPassant?.[1] === col;
            const isParalyzed = piece ? paralyzed[piece.color].some(sq => sq[0] === row && sq[1] === col) : false;
            const isFrozen = frozen.some(f => f.square[0] === row && f.square[1] === col);
            const isSuggestedPlacement = suggestedPlacements.some(s => s[0] === row && s[1] === col);
            const isPendingFreeze = pendingIcicle.some(f => f.square[0] === row && f.square[1] === col);
            const isDjinnHome = dissipatedDjinns.some(d => d.piece.state?.home_sq?.[0] === row && d.piece.state?.home_sq?.[1] === col);
            
            // Extract custom piece action squares for the selected piece
            const isBladeThru = validMoves?.some(m => m.bladeThru?.some(bt => bt[0] === row && bt[1] === col));
            const isDuelSquare = validMoves?.some(m => m.duel && m.to[0] === row && m.to[1] === col);

            // Glow squares: from & to of last move (timed, fades after 5 s)
            const isGlowFrom = glowActive && glowFrom?.[0] === row && glowFrom?.[1] === col;
            const isGlowTo   = glowActive && glowTo?.[0]   === row && glowTo?.[1]   === col;

            // Square background — NO green tint for valid moves, keep natural colour
            let bg = isLight ? BL : BD;
            if (isSelected)                   bg = '#4F46E5';  // bright indigo — selected
            else if (isCapture || isValidMove) bg = isLight ? BL : BD; // keep natural, overlay handles visuals

            return (
              <ChessSquare
                key={`${row}-${col}`}
                r={row} c={col} piece={piece} bg={bg}
                isValidMove={isValidMove && !isCapture}
                isCapture={isCapture}
                isGlowFrom={isGlowFrom}
                isGlowTo={isGlowTo}
                isThreatened={isThreatened}
                isEnPassantTarget={isEnPassantTarget}
                isParalyzed={isParalyzed}
                isFrozen={isFrozen}
                isPendingFreeze={isPendingFreeze}
                isDjinnHome={isDjinnHome}
                isSuggestedPlacement={isSuggestedPlacement}
                isBladeThru={isBladeThru}
                isDuelSquare={isDuelSquare}
                draggable={piece !== null}
                isPlaceMode={false}
                onSquareClick={onSquareClick}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onPieceHover={onPieceHover}
              />
            );
          });

          return [rankLabel, ...squares];
        })}

        {/* Bottom file labels */}
        <div style={{ background: '#EDE9FF' }} />
        {files.map(f => (
          <div key={f} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: '#7C3AED', background: '#EDE9FF',
            fontWeight: 700, fontFamily: "'Fira Code', monospace",
          }}>{f}</div>
        ))}
      </div>
      </div>
      {floatingTiles}
    </div>
  );
}
