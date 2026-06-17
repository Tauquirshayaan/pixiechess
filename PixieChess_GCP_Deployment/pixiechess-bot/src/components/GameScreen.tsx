import { useState, useCallback, useEffect, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import Toolbar from './Toolbar';
import ChessBoard from './ChessBoard';
import PlacementPalette from './PlacementPalette';
import ActiveColorPanel from './ActiveColorPanel';
import ResultPanel from './ResultPanel';
import SettingsModal from './SettingsModal';
import Toast from './Toast';
import CaptureLayer from './CaptureLayer';
import SparePiecesRow from './SparePiecesRow';
import { getLegalMoves, isCheck } from '../engine/moveGenerator';
import { applyMove } from '../engine/applyMove';
import { AbilityTrackerImpl } from '../engine/abilityTracker';
import type { Move, Piece } from '../engine/types';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import { inBounds } from '../engine/utils';
import { soundEngine } from '../utils/soundEngine';

function playSoundEffects(effects: string[], capture: boolean) {
  if (!useGameStore.getState().soundEnabled) return;
  if (effects.includes('ELECTRO_LIGHTNING')) soundEngine.playZap();
  else if (effects.includes('GUNSLINGER_DUEL')) soundEngine.playGunshot();
  else if (effects.includes('SUMOROOK_PUSH')) soundEngine.playThud();
  else if (effects.includes('FISSION_EXPLOSION') || effects.includes('ROCKET_BLAST')) soundEngine.playExplosion();
  else if (effects.includes('PIXIE_WIN') || effects.includes('KING_DESTROYED')) soundEngine.playWin();
  else if (effects.includes('PROMOTION') || effects.includes('HERO_PROMOTE')) soundEngine.playPromote();
  else if (capture) soundEngine.playCapture();
  else soundEngine.playMove();
}

export default function GameScreen() {
  const {
    board, gameState,
    isCalculating, setCalculating,
    pendingResult, setPendingResult,
    setMoveSel,
    setMoveHl,
    applyBoardMove,
    lastMoveTo, setLastMove,
    showToast,
    autoMove,
    addCapture,
    flipped,
    boardStatus,
    statusWinner,
  } = useGameStore();

  const moveSel = useGameStore(s => s.moveSel);

  const [error, setError] = useState<string | null>(null);
  const [winMsg, setWinMsg] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [hoveredBoardPiece, setHoveredBoardPiece] = useState<Piece | null>(null);
  // When dropping on empty square: ask the user which color to use
  const [colorPickPending, setColorPickPending] = useState<{ r: number; c: number } | null>(null);
  const [knightmareDrop, setKnightmareDrop] = useState<boolean>(false);
  const [evalStream, setEvalStream] = useState<{ score?: number, depth?: number, pv?: string, nodes?: number } | null>(null);


  // Clear local validMoves whenever the store's moveSel is cleared (e.g. Reset)
  useEffect(() => {
    if (!moveSel) setValidMoves([]);
  }, [moveSel]);

  // Also clear selection if the board/limbo changes under us (e.g. after bot move)
  // This prevents stale move.from coords crashing applyMove for limbo pieces
  const offBoardPieces = useGameStore(s => s.gameState.offBoardPieces);
  useEffect(() => {
    setMoveSel(null);
    setValidMoves([]);
    setKnightmareDrop(false);
  }, [board, offBoardPieces]);

  // Calculate threatened squares from the last piece that moved
  const threatenedSquares = useMemo(() => {
    if (!lastMoveTo || !inBounds(lastMoveTo[0], lastMoveTo[1])) return [];
    const piece = board[lastMoveTo[0]][lastMoveTo[1]];
    if (!piece) return [];
    
    // We only care about moves that capture enemy pieces (threats)
    const moves = getLegalMoves(board, lastMoveTo[0], lastMoveTo[1], gameState, piece.state);
    return moves.filter(m => {
      if (m.capture) return true;
      if (!inBounds(m.to[0], m.to[1])) return false; // Prevent out-of-bounds crash for Knightmare obJump
      const targetPiece = board[m.to[0]][m.to[1]];
      return targetPiece && targetPiece.color !== piece.color;
    }).map(m => m.to);
  }, [board, gameState, lastMoveTo]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); calculate(); }
      if (e.ctrlKey && e.key === 'r') { e.preventDefault(); useGameStore.getState().loadStandardBoard(); showToast('Board reset'); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleCaptureAnim = (move: Move, currentBoard: any) => {
    let capturedPiece = null;
    let capSq = move.to;

    if (move.epCapSq) {
      capSq = move.epCapSq;
      capturedPiece = currentBoard[capSq[0]][capSq[1]];
    } else if (move.capture) {
      if (inBounds(capSq[0], capSq[1])) {
        capturedPiece = currentBoard[capSq[0]][capSq[1]];
      } else {
        const ob = useGameStore.getState().gameState.offBoardPieces?.find(
          p => p.obSq[0] === capSq[0] && p.obSq[1] === capSq[1]
        );
        if (ob) capturedPiece = ob.piece;
      }
    } else if (move.lineCap) {
      // Pick first piece found in line cap
      for (const sq of move.lineCap) {
        if (currentBoard[sq[0]][sq[1]]) {
          capturedPiece = currentBoard[sq[0]][sq[1]];
          capSq = sq;
          break;
        }
      }
    }

    if (capturedPiece) {
      addCapture({ id: Date.now() + Math.random(), piece: capturedPiece, from: capSq });
    }
  };

  const calculate = useCallback(async () => {
    setCalculating(true);
    setError(null);
    setWinMsg(null);
    setPendingResult(null);
    setEvalStream(null);
    setMoveHl([]);

    const currentState = useGameStore.getState();
    const apiUrl = import.meta.env.DEV ? 'http://localhost:3000/api/calculate-stream' : '/api/calculate-stream';
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: currentState.board,
          gameState: currentState.gameState,
          color: currentState.botColor,
          depth: 99, // Force infinite depth, rely entirely on timeLimitMs
          timeLimitMs: currentState.thinkTimeMs,
          multiPv: currentState.multiPv,
          pfenHistory: currentState.pfenHistory,
        })
      });

      if (!response.body) throw new Error('ReadableStream not yet supported in this browser.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'info') {
              setEvalStream(prev => ({ ...prev, ...data }));
            } else if (data.type === 'bestmove') {
              const { move, score, nodes, effects = [], error, depth: resultDepth, ttHits, multiPv } = data.result;
              if (error) {
                setError(error);
                setCalculating(false);
                return;
              }

              if (effects?.includes('PIXIE_WIN')) {
                setWinMsg('✦ Golden Pawn promotes — GAME OVER!');
              } else if (effects?.includes('KING_DESTROYED')) {
                setWinMsg('☠️ King Destroyed — GAME OVER!');
              }
              if (!move) {
                setError('No legal moves found');
              } else {
                const currentBoard = useGameStore.getState().board;
                const preCalcBoard = JSON.parse(JSON.stringify(currentBoard));
                const piece = currentBoard[move.from[0]]?.[move.from[1]] || null;
                setPendingResult({ move, score, nodes, effects, piece, depth: resultDepth, ttHits, multiPv, board: preCalcBoard });
                setMoveHl([move.from, move.to]);

                // Auto-move: apply immediately if enabled
                if (currentState.autoMove) {
                  setTimeout(() => {
                    const tracker = new AbilityTrackerImpl();
                    const latestState = useGameStore.getState();
                    handleCaptureAnim(move, latestState.board);
                    const { board: nb, effects: eff, gameState: ngs } = applyMove(latestState.board, move, latestState.gameState, tracker);
                    if (eff.includes('PIXIE_WIN')) setWinMsg('✦ Golden Pawn promotes — GAME OVER!');
                    else if (eff.includes('KING_DESTROYED')) setWinMsg('☠️ King Destroyed — GAME OVER!');
                    applyBoardMove(nb, ngs);
                    playSoundEffects(eff, !!move.capture);
                    setLastMove(move.from, move.to);
                  }, 300);
                }
              }
              setCalculating(false);
            } else if (data.type === 'error') {
              setError(data.message);
              setCalculating(false);
            }
          } catch (e) {
            console.error('Failed to parse chunk:', line, e);
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError('Engine connection failed. Is the server running?');
      setCalculating(false);
    }
  }, [setCalculating, setPendingResult, setMoveHl, applyBoardMove, setLastMove, autoMove, showToast, addCapture]);

  const applyResult = useCallback(() => {
    const res = useGameStore.getState().pendingResult;
    if (!res?.move) return;
    const currentState = useGameStore.getState();
    const tracker = new AbilityTrackerImpl();
    handleCaptureAnim(res.move, currentState.board);
    const { board: nb, effects, gameState: ngs } = applyMove(currentState.board, res.move, currentState.gameState, tracker);
    if (effects.includes('PIXIE_WIN')) {
      setWinMsg('✦ Golden Pawn promotes — GAME OVER!');
    } else if (effects.includes('KING_DESTROYED')) {
      setWinMsg('☠️ King Destroyed — GAME OVER!');
    }
    applyBoardMove(nb, ngs);
    playSoundEffects(effects, !!res.move.capture);
    setLastMove(res.move.from, res.move.to);
    showToast('Move applied');
  }, [applyBoardMove, setLastMove, showToast, addCapture]);

  const handleSquareClick = useCallback((r: number, c: number, isDrop = false) => {
    const state = useGameStore.getState();

    // If placing from palette
    if (state.selectedPlacement) {
      const sel = state.selectedPlacement;
      const { PIECE_CATALOG: catalog } = { PIECE_CATALOG };
      const selectedBase = sel.pixie ? (catalog[sel.pixie]?.base ?? sel.type) : sel.type;
      const targetPiece  = inBounds(r, c) ? state.board[r][c] : null;

      // Auto-detect color from the target square's existing piece
      let resolvedColor: 'w' | 'b' = sel.color;
      if (targetPiece) {
        resolvedColor = targetPiece.color;  // always match the piece being replaced
      } else if (sel.pixie) {
        // Empty square AND it's a power piece — ask user which color they want
        useGameStore.getState().selectPlacement({ ...sel, _pendingSquare: [r, c] } as any);
        setColorPickPending({ r, c });
        return;
      }
      // If it's an empty square and NOT a power piece (standard spare piece),
      // we just keep resolvedColor = sel.color (since it came from that color's spare row)

      // One-King enforcement (after resolving color)
      if (selectedBase === 'K') {
        const kingExists = state.board.some(row => row.some(p => p && p.type === 'K' && p.color === resolvedColor));
        if (kingExists) {
          showToast(`Only one ${resolvedColor === 'w' ? 'White' : 'Black'} King allowed!`);
          useGameStore.getState().selectPlacement(null);
          return;
        }
      }

      // Place with the resolved color
      useGameStore.getState().selectPlacement({ ...sel, color: resolvedColor });
      useGameStore.getState().placePiece(r, c);
      useGameStore.getState().selectPlacement(null);
      return;
    }

    // Unconditional Move / Sandbox
    if (state.moveSel) {
      const [sr, sc] = state.moveSel;
      const legalMove = validMoves.find(m => m.to[0] === r && m.to[1] === c);

      if (sr === r && sc === c && !legalMove) {
        setMoveSel(null);
        setMoveHl([]);
        setValidMoves([]);
        setKnightmareDrop(false);
        return;
      }

      // If Knightmare DROP mode is active, apply the drop move through the engine
      if (knightmareDrop) {
        const dropMove = validMoves.find(m => m.to[0] === r && m.to[1] === c && m.drop === 'KNIGHTMARE');
        if (dropMove) {
          // Safety: validate the ally limbo piece still exists at move.from
          const allyStillInLimbo = state.gameState.offBoardPieces?.some(
            ob => ob.obSq[0] === dropMove.from[0] && ob.obSq[1] === dropMove.from[1]
          );
          if (!allyStillInLimbo) {
            showToast('Knightmare has moved — please reselect');
          } else {
            const tracker = new AbilityTrackerImpl();
            handleCaptureAnim(dropMove, state.board);
            const { board: nb, gameState: ngs, effects: eff } = applyMove(state.board, dropMove, state.gameState, tracker);
            applyBoardMove(nb, ngs);
            playSoundEffects(eff, !!dropMove.capture);
            setLastMove([sr, sc], [r, c]);
            showToast(dropMove.capture ? 'Knightmare captures in limbo!' : 'Knightmare jumps in limbo!');
          }
        }
        setMoveSel(null);
        setMoveHl([]);
        setValidMoves([]);
        setKnightmareDrop(false);
        return;
      }
      
      // Apply through engine if it's a valid legal move
      if (legalMove) {
        const tracker = new AbilityTrackerImpl();
        handleCaptureAnim(legalMove, state.board);
        const { board: nb, gameState: ngs, effects } = applyMove(state.board, legalMove, state.gameState, tracker);
        applyBoardMove(nb, ngs);
        playSoundEffects(effects, !!legalMove.capture);
        setLastMove([sr, sc], [r, c]);
        
        if (effects.includes('PIXIE_WIN')) {
          showToast('✦ Golden Pawn promotes — GAME OVER!');
        } else if (effects.includes('KING_DESTROYED')) {
          showToast('☠️ King Destroyed — GAME OVER!');
        }
      } else if (isDrop && inBounds(r, c) && inBounds(sr, sc)) {
        // Sandbox: unconditionally move the piece from (sr, sc) to (r, c)
        state.movePieceUnconditionally(sr, sc, r, c);
        setLastMove([sr, sc], [r, c]);
      } else {
        showToast('Invalid move');
      }
      
      setMoveSel(null);
      setMoveHl([]);
      setValidMoves([]);
    } else {
      let piece = null;
      if (inBounds(r, c)) {
        piece = state.board[r][c];
      } else {
        const ob = state.gameState.offBoardPieces?.find(p => p.obSq[0] === r && p.obSq[1] === c);
        if (ob) piece = ob.piece;
      }

      if (piece) {
        setMoveSel([r, c]);
        const moves = getLegalMoves(state.board, r, c, state.gameState, piece.state);
        if (!inBounds(r, c)) {
          setKnightmareDrop(true);
        }
        setValidMoves(moves);
        setMoveHl(moves.map(m => m.to));
      }
    }
  }, [setMoveSel, setMoveHl, setLastMove, knightmareDrop, validMoves, applyBoardMove, showToast]);

  const handleDragStart = useCallback((r: number, c: number) => {
    const state = useGameStore.getState();
    
    let piece = null;
    if (inBounds(r, c)) {
      piece = state.board[r][c];
    } else {
      const ob = state.gameState.offBoardPieces?.find(p => p.obSq[0] === r && p.obSq[1] === c);
      if (ob) piece = ob.piece;
    }

    if (piece) {
      setMoveSel([r, c]);
      const moves = getLegalMoves(state.board, r, c, state.gameState, piece.state);
      if (!inBounds(r, c)) {
        setKnightmareDrop(true);
      }
      setValidMoves(moves);
      setMoveHl(moves.map(m => m.to));
    }
  }, [setMoveSel, setMoveHl]);

  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* ── LEFT COLUMN: Board only ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', zIndex: 100 }}>
          <Toolbar />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <CaptureLayer />
            <SparePiecesRow color={flipped ? 'w' : 'b'} />
            <ChessBoard
              validMoves={validMoves}
              threatenedSquares={threatenedSquares}
              onSquareClick={handleSquareClick}
              onDragStart={handleDragStart}
              onDrop={(r, c) => handleSquareClick(r, c, true)}
              onPieceHover={setHoveredBoardPiece}
            />
            <SparePiecesRow color={flipped ? 'b' : 'w'} />
          </div>
        </div>

        {/* ── RIGHT COLUMN: Controls + Palette + Result ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 360, position: 'sticky', top: 20, maxHeight: 'calc(100vh - 40px)' }}>
          <ActiveColorPanel />

          <PlacementPalette hoveredBoardPiece={hoveredBoardPiece} />

          {/* Calculate */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {boardStatus === 'game_over' && (
              <div style={{
                background: '#7F1D1D', color: '#FEF2F2', padding: '8px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textAlign: 'center', border: '1px solid #450A0A',
                boxShadow: '0 2px 8px rgba(127,29,29,0.4)'
              }}>
                ☠️ GAME OVER! {statusWinner ? (statusWinner === 'w' ? 'White' : 'Black') + ' wins!' : (() => {
                  // Check if both kings are gone (mutual destruction) or threefold repetition
                  const hasWKing = board.some(row => row.some(p => p && p.type === 'K' && p.color === 'w'));
                  const hasBKing = board.some(row => row.some(p => p && p.type === 'K' && p.color === 'b'));
                  return (!hasWKing && !hasBKing) ? 'Mutual Destruction!' : 'Draw by Threefold Repetition!';
                })()}
              </div>
            )}
            {boardStatus === 'checkmate' && (
              <div style={{
                background: '#7F1D1D', color: '#FEF2F2', padding: '8px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textAlign: 'center', border: '1px solid #450A0A',
                boxShadow: '0 2px 8px rgba(127,29,29,0.4)'
              }}>
                🏆 CHECKMATE! {statusWinner === 'w' ? 'White' : 'Black'} wins!
              </div>
            )}
            {boardStatus !== 'game_over' && boardStatus !== 'checkmate' && isCheck(board, 'w', gameState) && (
              <div style={{
                background: '#FEE2E2', color: '#B91C1C', padding: '8px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textAlign: 'center', border: '1px solid #F87171',
                boxShadow: '0 2px 8px rgba(239,68,68,0.2)'
              }}>
                ⚠️ White King in Check!
              </div>
            )}
            {boardStatus !== 'game_over' && boardStatus !== 'checkmate' && isCheck(board, 'b', gameState) && (
              <div style={{
                background: '#FEE2E2', color: '#B91C1C', padding: '8px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textAlign: 'center', border: '1px solid #F87171',
                boxShadow: '0 2px 8px rgba(239,68,68,0.2)'
              }}>
                ⚠️ Black King in Check!
              </div>
            )}
            <button
              onClick={calculate}
              disabled={isCalculating || boardStatus === 'checkmate' || boardStatus === 'game_over'}
              style={{
                background: (isCalculating || boardStatus === 'checkmate' || boardStatus === 'game_over') ? ((boardStatus === 'checkmate' || boardStatus === 'game_over') ? '#991B1B' : '#E0D6F7') : 'linear-gradient(135deg, #7C3AED, #9B6FD4)',
                border: 'none', borderRadius: 8, color: '#FFF',
                cursor: (isCalculating || boardStatus === 'checkmate' || boardStatus === 'game_over') ? 'not-allowed' : 'pointer',
                fontWeight: 900, fontSize: 15, padding: '10px 14px',
                fontFamily: "'Roboto Condensed', 'Inter', sans-serif", letterSpacing: 0.5,
                boxShadow: (isCalculating || boardStatus === 'checkmate' || boardStatus === 'game_over') ? 'none' : '0 4px 20px rgba(124,58,237,0.35)',
                transition: 'all .2s',
                opacity: (isCalculating || boardStatus === 'checkmate' || boardStatus === 'game_over') ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}
            >
              {isCalculating && (
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #FFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              )}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              {boardStatus === 'game_over' ? 'GAME OVER' : 
               boardStatus === 'checkmate' ? 'CHECKMATE' : 
               (isCalculating ? 'THINKING...' : '⚡ CALCULATE')}
            </button>
          </div>

          {/* Result */}
          <ResultPanel
            isCalculating={isCalculating}
            evalStream={evalStream}
            pendingResult={pendingResult}
            error={error}
            winMsg={winMsg}
            onApply={applyResult}
            onSelectPv={(pvMove, pvScore) => {
              if (pendingResult) {
                setPendingResult({
                  ...pendingResult,
                  move: pvMove,
                  score: pvScore
                });
              }
            }}
          />
        </div>
      </div>

      {/* ── Color pick dialog for empty-square drops ── */}
      {colorPickPending && (() => {
        const sel = useGameStore.getState().selectedPlacement;
        const sym = sel?.pixie ? PIECE_CATALOG[sel.pixie].label : sel?.type ?? '';
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}>
            <div style={{
              background: '#FFF', borderRadius: 14, padding: '24px 28px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
              textAlign: 'center', minWidth: 260,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1E1535', marginBottom: 6 }}>
                Choose color for <span style={{ color: '#7C3AED' }}>{sym}</span>
              </div>
              <div style={{ fontSize: 12, color: '#9B90B8', marginBottom: 18 }}>
                Dropping on an empty square — which side should this piece belong to?
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                {(['w', 'b'] as const).map(col => (
                  <button key={col} onClick={() => {
                    const current = useGameStore.getState().selectedPlacement;
                    if (!current) { setColorPickPending(null); return; }
                    const base = current.pixie ? PIECE_CATALOG[current.pixie].base : current.type;
                    // King check
                    if (base === 'K') {
                      const kingExists = useGameStore.getState().board.some(row => row.some(p => p && p.type === 'K' && p.color === col));
                      if (kingExists) {
                        showToast(`Only one ${col === 'w' ? 'White' : 'Black'} King allowed!`);
                        useGameStore.getState().selectPlacement(null);
                        setColorPickPending(null);
                        return;
                      }
                    }
                    useGameStore.getState().selectPlacement({ ...current, color: col });
                    useGameStore.getState().placePiece(colorPickPending.r, colorPickPending.c);
                    useGameStore.getState().selectPlacement(null);
                    setColorPickPending(null);
                  }} style={{
                    padding: '9px 22px', borderRadius: 8, border: 'none',
                    background: col === 'w' ? '#EDE9FF' : '#1E1535',
                    color: col === 'w' ? '#7C3AED' : '#FFF',
                    fontWeight: 800, fontSize: 14, cursor: 'pointer',
                    fontFamily: "'Roboto Condensed', 'Inter', sans-serif",
                  }}>
                    {col === 'w' ? '⬜ White' : '⬛ Black'}
                  </button>
                ))}
              </div>
              <button onClick={() => {
                useGameStore.getState().selectPlacement(null);
                setColorPickPending(null);
              }} style={{
                marginTop: 14, background: 'none', border: 'none',
                color: '#9B90B8', cursor: 'pointer', fontSize: 12,
              }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {winMsg && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(8px)',
          zIndex: 900, // Below settings modal (1000)
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #FFD700 0%, #F59E0B 100%)',
            padding: '40px 60px',
            borderRadius: '24px',
            boxShadow: '0 20px 60px rgba(245, 158, 11, 0.4)',
            color: '#FFF',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
            <h2 style={{ margin: 0, fontSize: 40, fontWeight: 900, textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>VICTORY!</h2>
            <p style={{ margin: '16px 0 0', fontSize: 20, fontWeight: 600, opacity: 0.95 }}>{winMsg}</p>
            <button 
              onClick={() => setWinMsg(null)}
              style={{
                marginTop: 32, padding: '12px 32px', borderRadius: 12,
                background: '#FFF', color: '#D97706', border: 'none',
                fontWeight: 800, cursor: 'pointer', fontSize: 16,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <SettingsModal />
      <Toast />
    </>
  );
}
