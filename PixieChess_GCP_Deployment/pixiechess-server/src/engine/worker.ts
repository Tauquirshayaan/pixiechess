import type { Board, GameState, Move } from './types';
import { findBestMove } from './search';
import { AbilityTrackerImpl } from './abilityTracker';

export interface SearchRequest {
  board: Board;
  color: 'w' | 'b';
  depth: number;
  gameState: GameState;
}

export interface SearchResponse {
  move: Move | null;
  score: number;
  nodes: number;
  effects: string[];
}

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  try {
    const { board, color, depth, gameState } = e.data;
    
    const tracker = new AbilityTrackerImpl();
    
    const start = performance.now();
    const result = findBestMove(board, color, depth, gameState, tracker);
    const end = performance.now();
    
    console.log(`[Worker] Search depth ${depth} completed in ${(end - start).toFixed(2)}ms. Nodes: ${result.nodes}. Score: ${result.score}`);

    self.postMessage({
      move: result.move,
      score: result.score,
      nodes: result.nodes,
      effects: result.effects
    } as SearchResponse);
  } catch (error) {
    console.error("[Worker] Error during search:", error);
    // If we fail, return an empty/default response to avoid hanging the UI
    self.postMessage({
      move: null,
      score: 0,
      nodes: 0,
      effects: []
    } as SearchResponse);
  }
};
