import type { GameState, AbilityTracker } from './types';

export class AbilityTrackerImpl implements AbilityTracker {
  private stack: GameState[] = [];

  // Called at start of EVERY minimax node
  push(gameState: GameState): void {
    // Deep clone the mutable parts of GameState to preserve history
    const snap: GameState = {
      ...gameState,
      frozen: gameState.frozen.map(fp => ({ ...fp })),
      paralyzed: {
        w: gameState.paralyzed.w.map(p => [...p] as [number, number]),
        b: gameState.paralyzed.b.map(p => [...p] as [number, number])
      },
      doomed: { ...gameState.doomed },
      // lastMove and enPassant are replaced entirely in applyMove, so shallow copy is fine
      enPassant: gameState.enPassant ? [...gameState.enPassant] as [number, number] : undefined,
      lastMove: gameState.lastMove ? { ...gameState.lastMove } : undefined
    };
    
    this.stack.push(snap);
  }

  // Called at end of EVERY minimax node
  pop(): GameState | null {
    const snap = this.stack.pop();
    return snap || null;
  }

  // Called after each move — ticks down freeze timers
  decrementFreezes(ngs: GameState): void {
    ngs.frozen = ngs.frozen
      .map(fp => ({ ...fp, turns_remaining: fp.turns_remaining - 1 }))
      .filter(fp => fp.turns_remaining > 0);
  }
}
