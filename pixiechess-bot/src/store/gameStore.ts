import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Board, GameState, Move, Piece, PixieType } from '../engine/types';
import { INITIAL_BOARD } from '../data/initialBoard';
import { PIECE_CATALOG } from '../data/pieceCatalog';
import { isCheck, getAllMovesForColor } from '../engine/moveGenerator';
import { calcBasiliskParalysis, inBounds } from '../engine/utils';

// ── State shape ──────────────────────────────────────────────
export interface SelectedPlacement {
  type: 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
  pixie: PixieType | null;
  color: 'w' | 'b';
}

export interface PendingResult {
  move: Move;
  score: number;
  nodes: number;
  effects: string[];
  piece: Piece | null;
  depth?: number;
  ttHits?: number;
  multiPv?: { move: Move, score: number }[];
  board?: Board;
}

export interface CaptureAnimation {
  id: number;
  piece: Piece;
  from: [number, number];
}

interface GameStore {
  board: Board;
  gameState: GameState;

  selectedPlacement: SelectedPlacement | null;
  placementColor: 'w' | 'b';

  botColor: 'w' | 'b';
  searchDepth: number;
  thinkTimeMs: number;
  multiPv: number;
  isCalculating: boolean;
  pendingResult: PendingResult | null;

  moveSel: [number, number] | null;
  moveHl: [number, number][];

  // ── New Batch 1 state ──
  autoMove: boolean;
  flipped: boolean;
  lastMoveFrom: [number, number] | null;
  lastMoveTo: [number, number] | null;
  showSettings: boolean;
  soundEnabled: boolean;
  toastMsg: string | null;
  captures: CaptureAnimation[];

  // ── Batch 2 state ──
  loadout: string[];
  boardStatus: 'normal' | 'check' | 'checkmate' | 'game_over';
  statusWinner: 'w' | 'b' | null;
  suggestedPlacements: [number, number][];
  isAdvising: boolean;

  // Actions
  setPlacementColor: (c: 'w' | 'b') => void;
  selectPlacement: (sel: SelectedPlacement | null) => void;
  setBotColor: (c: 'w' | 'b') => void;
  setSearchDepth: (d: number) => void;
  setThinkTimeMs: (ms: number) => void;
  setMultiPv: (pv: number) => void;
  setCalculating: (v: boolean) => void;
  setPendingResult: (r: PendingResult | null) => void;
  setMoveSel: (sq: [number, number] | null) => void;
  setMoveHl: (sqs: [number, number][]) => void;

  // ── New Batch 1 actions ──
  setAutoMove: (v: boolean) => void;
  toggleFlip: () => void;
  setLastMove: (from: [number, number] | null, to: [number, number] | null) => void;
  setShowSettings: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  toggleBotColor: () => void;
  toggleCastling: (right: 'K' | 'Q' | 'k' | 'q') => void;
  addCapture: (cap: CaptureAnimation) => void;
  removeCapture: (id: number) => void;

  placePiece: (r: number, c: number) => void;
  movePieceUnconditionally: (fromR: number, fromC: number, toR: number, toC: number) => void;
  erasePiece: (r: number, c: number) => void;
  loadStandardBoard: () => void;
  clearBoard: () => void;
  applyBoardMove: (newBoard: Board, newGs: GameState) => void;
  setBoard: (board: Board) => void;
  setGameState: (gs: GameState) => void;

  // ── Batch 2 actions ──
  addToLoadout: (pixieId: string) => void;
  removeFromLoadout: (pixieId: string) => void;
  requestPlacementAdvice: () => Promise<void>;
  requestAutoDeploy: () => Promise<void>;
  updateBoardStatus: () => void;
  refreshGlobalAuras: () => void;
}

function initState(px: PixieType | null): Record<string, unknown> {
  switch (px) {
    case 'ELECTROKNIGHT':   return { consec_moves: 0, is_charged: false };
    case 'BANKER':          return { pawns_banked: 0 };
    case 'FISSION_REACTOR': return { capture_count: 0 };
    case 'PILGRIM':         return { total_dist: 0, resurrected: false };
    case 'DANCER':          return { bonus_moves: 0, active_flag: false };
    case 'DJINN':           return { dissipated: false, home_sq: null };
    case 'GUNSLINGER':      return { mutual_target: null, mutual_ply: 0 };
    case 'ROCKETMAN':       return { used_rocket: false };
    case 'KNIGHTMARE':      return { off_board: false, ob_sq: null };
    case 'FISH_KNIGHT':     return { moved_last_turn: false };
    case 'MARAUDER':        return { kill_count: 0 };
    case 'SHRIKE':          return { has_moved: false };
    case 'HORDE_MOTHER':    return { hordeling_ids: [] };
    case 'WAR_AUTOMATON':   return {};
    case 'BLADERUNNER':     return {};
    default:                return {};
  }
}

const defaultGameState: GameState = {
  frozen: [],
  paralyzed: { w: [], b: [] },
  promotionBlock: false,
  doomed: {},
  turn: 1,
  castling: { K: true, Q: true, k: true, q: true },
  offBoardPieces: [],    // Knightmare limbo
  pendingIcicle: [],     // Icicle consecutive adjacency
  deadPieces: [],
};

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      board: JSON.parse(JSON.stringify(INITIAL_BOARD)),
      gameState: JSON.parse(JSON.stringify(defaultGameState)),

      selectedPlacement: null,
      placementColor: 'w',

  botColor: 'b',
  searchDepth: 99, // Max depth to allow 3-second timer to fully utilize CPU
  thinkTimeMs: 3000,
  multiPv: 1,
  isCalculating: false,
  pendingResult: null,

  moveSel: null,
  moveHl: [],

  // ── New Batch 1 defaults ──
  autoMove: true,
  flipped: false,
  lastMoveFrom: null,
  lastMoveTo: null,
  showSettings: false,
  soundEnabled: true,
  toastMsg: null,
  captures: [],

  loadout: [],
  boardStatus: 'normal',
  statusWinner: null,
  suggestedPlacements: [],
  isAdvising: false,

  setPlacementColor: (c) => set({ placementColor: c }),
  selectPlacement: (sel) => set({ selectedPlacement: sel }),
  setBotColor: (c) => set({ botColor: c }),
  setSearchDepth: (d) => set({ searchDepth: d }),
  setThinkTimeMs: (ms) => set({ thinkTimeMs: ms }),
  setMultiPv: (pv) => set({ multiPv: pv }),
  setCalculating: (v) => set({ isCalculating: v }),
  setPendingResult: (r) => set({ pendingResult: r }),
  setMoveSel: (sq) => set({ moveSel: sq }),
  setMoveHl: (sqs) => set({ moveHl: sqs }),

  // ── New Batch 1 actions ──
  setAutoMove: (v) => set({ autoMove: v }),
  toggleFlip: () => set((s) => ({ flipped: !s.flipped })),
  setLastMove: (from, to) => set({ lastMoveFrom: from, lastMoveTo: to }),
  setShowSettings: (v) => set({ showSettings: v }),
  setSoundEnabled: (v) => set({ soundEnabled: v }),
  showToast: (msg) => set({ toastMsg: msg }),
  clearToast: () => set({ toastMsg: null }),
  toggleBotColor: () => set((s) => ({ botColor: s.botColor === 'w' ? 'b' : 'w' })),
  toggleCastling: (r) => set((s) => ({
    gameState: {
      ...s.gameState,
      castling: {
        ...(s.gameState.castling || { K: true, Q: true, k: true, q: true }),
        [r]: !(s.gameState.castling || { K: true, Q: true, k: true, q: true })[r]
      }
    }
  })),
  addCapture: (cap) => set((s) => ({ captures: [...s.captures, cap] })),
  removeCapture: (id) => set((s) => ({ captures: s.captures.filter(c => c.id !== id) })),



  placePiece: (r, c) => {
    set((state) => {
      const sel = state.selectedPlacement;
      if (!sel) return state;
      const baseType = sel.pixie ? PIECE_CATALOG[sel.pixie].base : sel.type;
      const isKing = baseType === 'K';

      // ── Power Piece constraints ──
      if (sel.pixie) {
        // 1. Must replace corresponding standard piece of the same color
        const target = state.board[r][c];
        if (!target || target.type !== baseType || target.color !== sel.color || target.pixie) {
          state.showToast(`Power pieces can only replace their corresponding standard ${sel.color === 'w' ? 'White' : 'Black'} piece!`);
          return state;
        }

        // 2. Maximum of 6 power pieces allowed per side
        let powerCount = 0;
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const p = state.board[row][col];
            if (p && p.color === sel.color && p.pixie) {
              powerCount++;
            }
          }
        }
        if (powerCount >= 6) {
          state.showToast(`Maximum of 6 power pieces allowed for ${sel.color === 'w' ? 'White' : 'Black'}!`);
          return state;
        }
      }

      // ── One-King enforcement ──
      if (isKing) {
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const existing = state.board[row][col];
            if (existing && existing.type === 'K' && existing.color === sel.color) {
              if (row === r && col === c) {
                // Replacing existing king on the exact same square is allowed
              } else {
                return { ...state, _kingConflict: true } as any;
              }
            }
          }
        }
      }

      const newBoard = state.board.map(row => row.map(p => p ? { ...p, state: p.state ? { ...p.state } : undefined } : null));
      const isInvul = sel.pixie === 'IRONPAWN';
      newBoard[r][c] = {
        type: baseType,
        color: sel.color,
        pixie: sel.pixie || undefined,
        id: Math.random().toString(36).slice(2),
        state: initState(sel.pixie) as any,
        invulnerable: isInvul || undefined,
      };

      const placed = newBoard[r][c]!;

      // ── PINATA: transforms immediately on placement into a random non-Pinata piece ──
      if (placed.pixie === 'PINATA') {
        const allPixies = (Object.keys(PIECE_CATALOG) as PixieType[]).filter(k => k !== 'PINATA');
        const randomPixie = allPixies[Math.floor(Math.random() * allPixies.length)];
        placed.pixie = randomPixie;
        placed.type = PIECE_CATALOG[randomPixie].base;
        placed.state = initState(randomPixie) as any;
        placed.invulnerable = (randomPixie === 'IRONPAWN') || undefined;
      }

      // ── BLUEPRINT: copies the identity of the piece at file-1 on the same rank ──
      if (placed.pixie === 'BLUEPRINT') {
        placed.isBlueprint = true;
      }
      
      if (placed.isBlueprint) {
        const leftPiece = c > 0 ? newBoard[r][c - 1] : null;
        if (leftPiece && leftPiece.pixie !== 'IRONPAWN') {
          // Copy the neighbor's identity (even standard pieces!)
          placed.type = leftPiece.type;
          placed.pixie = leftPiece.pixie;
          placed.state = leftPiece.pixie ? (initState(leftPiece.pixie) as any) : {};
        } else {
          // No valid piece at file-1 — Blueprint becomes a standard pawn but RETAINS its blueprint visual status
          placed.type = 'P';
          placed.pixie = undefined;
          placed.state = {};
        }
      }

      return { board: newBoard, pendingResult: null };
    });
    get().updateBoardStatus();
    get().refreshGlobalAuras();
  },

  movePieceUnconditionally: (fromR, fromC, toR, toC) => {
    set((state) => {
      const nb = state.board.map(row => [...row]);
      const piece = nb[fromR][fromC];
      if (!piece) return state;

      const target = nb[toR][toC];
      if (target) {
        if (target.color === piece.color) {
          state.showToast("Cannot overwrite your own pieces!");
          return state;
        }
        if (target.type === 'K') {
          state.showToast("Cannot capture a King!");
          return state;
        }
        state.addCapture({ id: Date.now() + Math.random(), piece: target, from: [toR, toC] });
      }

      nb[fromR][fromC] = null;
      nb[toR][toC] = piece;

      // ── BLUEPRINT: if moved, check file-1 for copy! ──
      if (piece.isBlueprint) {
        const leftPiece = toC > 0 ? nb[toR][toC - 1] : null;
        if (leftPiece && leftPiece.pixie !== 'IRONPAWN' && !leftPiece.isBlueprint) {
          piece.type = leftPiece.type;
          piece.pixie = leftPiece.pixie;
          piece.state = leftPiece.pixie ? (initState(leftPiece.pixie) as any) : {};
        } else {
          piece.type = 'P';
          piece.pixie = undefined;
          piece.state = {};
        }
      }

      return { board: nb };
    });
    get().updateBoardStatus();
    get().refreshGlobalAuras();
  },

  updateBoardStatus: () => {
    const { board, gameState } = get();

    // ── Missing King Check (Game Over) ──
    let wKing = false;
    let bKing = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'K') {
          if (p.color === 'w') wKing = true;
          if (p.color === 'b') bKing = true;
        }
      }
    }

    if (gameState.gameOver) {
      set({ boardStatus: 'game_over', statusWinner: gameState.winner || null });
      return;
    }

    if (!wKing && !bKing) {
      set({ boardStatus: 'game_over', statusWinner: null }); // Draw/Mutual destruction
      return;
    } else if (!wKing) {
      set({ boardStatus: 'game_over', statusWinner: 'b' });
      return;
    } else if (!bKing) {
      set({ boardStatus: 'game_over', statusWinner: 'w' });
      return;
    }

    const colorToMove = gameState.turn % 2 === 1 ? 'w' : 'b';
    const opponentColor = colorToMove === 'w' ? 'b' : 'w';
    
    if (isCheck(board, colorToMove, gameState)) {
      const moves = getAllMovesForColor(board, colorToMove, gameState);
      if (moves.length === 0) {
        set({ boardStatus: 'checkmate', statusWinner: opponentColor });
      } else {
        set({ boardStatus: 'check', statusWinner: null });
      }
    } else {
      set({ boardStatus: 'normal', statusWinner: null });
    }
  },

  refreshGlobalAuras: () => {
    set((state) => {
      const ngs = { ...state.gameState };
      ngs.paralyzed = { ...ngs.paralyzed };
      ngs.paralyzed['w'] = calcBasiliskParalysis(state.board, 'w');
      ngs.paralyzed['b'] = calcBasiliskParalysis(state.board, 'b');

      // Also reset Icicle freezes to properly visualize them instantly
      // (This just does a basic scan for frozen visualization in sandbox)
      const nowAdjToIcicle = new Set<string>();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = state.board[r][c];
          if (p && p.pixie === 'ICICLE') {
            for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
              const er = r+dr, ec = c+dc;
              if (inBounds(er, ec)) {
                const adj = state.board[er][ec];
                if (adj && adj.color !== p.color && !adj.invulnerable) {
                  nowAdjToIcicle.add(`${er}_${ec}`);
                }
              }
            }
          }
        }
      }
      
      const newFrozen: Array<{ square: [number, number], turns_remaining: number, frozen_by: [number, number] }> = [];
      for (const key of nowAdjToIcicle) {
        const [rStr, cStr] = key.split('_');
        newFrozen.push({
          square: [parseInt(rStr), parseInt(cStr)],
          turns_remaining: 2,
          frozen_by: [-1, -1]
        });
      }
      ngs.frozen = newFrozen;

      return { gameState: ngs };
    });
  },

  erasePiece: (r, c) => {
    set((state) => {
      const piece = state.board[r][c];
      if (piece && piece.type === 'K') {
        state.showToast("Cannot erase a King! Replace it with a Power King instead.");
        return state;
      }
      const newBoard = state.board.map(row => [...row]);
      newBoard[r][c] = null;
      return { board: newBoard, pendingResult: null };
    });
    get().updateBoardStatus();
    get().refreshGlobalAuras();
  },

  loadStandardBoard: () => {
    set({
      board: JSON.parse(JSON.stringify(INITIAL_BOARD)),
      gameState: JSON.parse(JSON.stringify(defaultGameState)),
      pendingResult: null,
      moveHl: [],
      moveSel: null,
      lastMoveFrom: null,
      lastMoveTo: null,
      suggestedPlacements: [],
      boardStatus: 'normal',
      statusWinner: null,
    });
    get().updateBoardStatus();
  },

  clearBoard: () => {
    set({
      board: Array(8).fill(null).map(() => Array(8).fill(null)) as Board,
      gameState: JSON.parse(JSON.stringify(defaultGameState)),
      pendingResult: null,
      moveHl: [],
      moveSel: null,
      lastMoveFrom: null,
      lastMoveTo: null,
      suggestedPlacements: [],
      boardStatus: 'normal',
      statusWinner: null,
    });
    get().updateBoardStatus();
  },

  applyBoardMove: (newBoard, newGs) => {
    set({
      board: newBoard,
      gameState: newGs,
      moveHl: [],
      moveSel: null,
    });
    get().updateBoardStatus();
  },

  setBoard: (board) => set({ board }),
  setGameState: (gs) => set({ gameState: gs }),

  addToLoadout: (pixieId) => set((state) => ({ loadout: [...new Set([...state.loadout, pixieId])] })),
  removeFromLoadout: (pixieId) => set((state) => ({ loadout: state.loadout.filter(id => id !== pixieId) })),
  
  requestPlacementAdvice: async () => {
    const { board, gameState, placementColor, selectedPlacement } = get();
    if (!selectedPlacement || !selectedPlacement.pixie) return;
    set({ isAdvising: true, suggestedPlacements: [] });
    try {
      const apiUrl = import.meta.env.DEV ? 'http://localhost:3000/api/suggest-placement' : '/api/suggest-placement';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board, gameState, color: placementColor,
          pieceType: PIECE_CATALOG[selectedPlacement.pixie as PixieType].base,
          pixieName: selectedPlacement.pixie
        })
      });
      const data = await res.json();
      if (data.suggestions) {
        set({ suggestedPlacements: data.suggestions.map((s: any) => s.square), isAdvising: false });
      } else {
        set({ isAdvising: false });
      }
    } catch (e) {
      console.error(e);
      set({ isAdvising: false });
    }
  },

  requestAutoDeploy: async () => {
    const { board, gameState, placementColor, loadout } = get();
    if (loadout.length === 0) return;
    set({ isAdvising: true });
    try {
      const apiUrl = import.meta.env.DEV ? 'http://localhost:3000/api/auto-deploy' : '/api/auto-deploy';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, gameState, color: placementColor, loadout })
      });
      const data = await res.json();
      if (data.board) {
        set({ board: data.board, isAdvising: false, selectedPlacement: null, suggestedPlacements: [] });
      } else {
        set({ isAdvising: false });
      }
    } catch (e) {
      console.error(e);
      set({ isAdvising: false });
    }
  },
}), {
  name: 'pixiechess-storage',
  storage: createJSONStorage(() => sessionStorage),
}));
