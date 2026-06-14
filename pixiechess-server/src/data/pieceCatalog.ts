import type { PixieType, PieceMeta } from '../engine/types';

export const PIECE_CATALOG: Record<PixieType, PieceMeta> = {
  // ── PAWNS ────────────────────────────────────────────────────────────────
  GOLDEN_PAWN: {
    label: 'Golden Pawn', base: 'P', color: '#FACC15', danger: 10,
    description: 'Promotion at rank 8 = instant game WIN (blocked only by enemy Aristocrat alive).',
    isLethal: true, isControl: false, isIndestructible: false
  },
  IRONPAWN: {
    label: 'Ironpawn', base: 'P', color: '#334155', danger: 6,
    description: 'Cannot capture, cannot promote, permanently indestructible. Blocks LOS.',
    isLethal: false, isControl: false, isIndestructible: true
  },
  BLUEPRINT: {
    label: 'Blueprint', base: 'P', color: '#C0C0C0', danger: 5,
    description: 'At game start, copies identity of pawn at file-1 same rank. Standard if none.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  EPEE_PAWN: {
    label: 'Epee Pawn', base: 'P', color: '#C0C0C0', danger: 8,
    description: 'Global en passant: can capture ANY pawn that just moved, anywhere on board.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  PAWN_KNIFE: {
    label: 'Pawn with Knife', base: 'P', color: '#DC2626', danger: 7,
    description: 'Extended diagonal capture: abs(dx)==2, abs(dy)==2, toward d/e file.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  HERO_PAWN: {
    label: 'Hero Pawn', base: 'P', color: '#38BDF8', danger: 9,
    description: 'If this pawn gives check to the enemy king, immediately promote to Queen.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  SHRIKE: {
    label: 'Shrike', base: 'P', color: '#F97316', danger: 8,
    description: 'On its first move forward 2 tiles, captures any piece in the path.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  WARP_JUMPER: {
    label: 'Warp Jumper', base: 'P', color: '#06B6D4', danger: 7,
    description: 'Can jump through (over) any pawn when moving forward.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  WAR_AUTOMATON: {
    label: 'War Automaton', base: 'P', color: '#1E293B', danger: 8,
    description: 'Automatically moves forward 1 tile whenever any piece (either side) is captured.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  HORDELING: {
    label: 'Hordeling', base: 'P', color: '#8B5CF6', danger: 3,
    description: 'Spawned by Horde Mother. Standard pawn movement but cannot promote. Linked to Horde Mother life.',
    isLethal: true, isControl: false, isIndestructible: false
  },

  // ── KNIGHTS ──────────────────────────────────────────────────────────────
  ELECTROKNIGHT: {
    label: 'Electroknight', base: 'N', color: '#1D4ED8', danger: 9,
    description: 'After 3 consecutive own-moves: charged. Next capture also destroys 1 adjacent enemy.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  BANKER: {
    label: 'Banker', base: 'N', color: '#FACC15', danger: 10,
    description: 'Captures enemy pawn → most-advanced own pawn becomes Golden Pawn.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  CAMEL: {
    label: 'Camel', base: 'N', color: '#D97706', danger: 6,
    description: '(3,1) and (1,3) leaps in all 8 orientations. Pure jump, no obstruction.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  KNIGHTMARE: {
    label: 'Knightmare', base: 'N', color: '#6B7280', danger: 7,
    description: 'Can jump off-board. Returns via DROP (1 turn), any empty square.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  ANTI_VIOLENCE: {
    label: 'Anti-Violence', base: 'N', color: '#F472B6', danger: 7,
    description: 'Standard Knight moves. Cannot capture. Adjacent enemy pieces cannot capture.',
    isLethal: false, isControl: true, isIndestructible: false
  },
  PINATA: {
    label: 'Pinata', base: 'N', color: '#D946EF', danger: 8,
    description: 'At game start, randomly becomes any catalog piece.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  FISH_KNIGHT: {
    label: 'Fish', base: 'N', color: '#0EA5E9', danger: 7,
    description: 'If this piece moved last turn, it can also move 1 tile in any direction (no capture) on its next turn.',
    isLethal: true, isControl: false, isIndestructible: false
  },

  // ── BISHOPS ──────────────────────────────────────────────────────────────
  ARISTOCRAT: {
    label: 'Aristocrat', base: 'B', color: '#B45309', danger: 9,
    description: 'Global passive: ALL enemy pawns cannot promote while alive.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  BASILISK: {
    label: 'Basilisk', base: 'B', color: '#16A34A', danger: 9,
    description: 'Paralysis aura. After every move: all enemy pieces in diagonal LOS are paralyzed.',
    isLethal: false, isControl: true, isIndestructible: false
  },
  BLADERUNNER: {
    label: 'Bladerunner', base: 'B', color: '#EC4899', danger: 8,
    description: 'Diagonal ray slides THROUGH enemies without stopping, marking them doomed.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  BOUNCER: {
    label: 'Bouncer', base: 'B', color: '#F97316', danger: 8,
    description: 'Diagonal ray bounces once off board edge per move.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  PILGRIM: {
    label: 'Pilgrim', base: 'B', color: '#78350F', danger: 9,
    description: 'Tracks distance. At 20 squares: may resurrect one captured ally (one-time).',
    isLethal: true, isControl: false, isIndestructible: false
  },
  DANCER: {
    label: 'Dancer', base: 'B', color: '#8B5CF6', danger: 8,
    description: 'After any move that gives check: 2 bonus quiet moves.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  DJINN: {
    label: 'Djinn', base: 'B', color: '#FBBF24', danger: 7,
    description: 'Spend turn to dissipate. Respawns at home_sq on next capture anywhere.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  GUNSLINGER: {
    label: 'Gunslinger', base: 'B', color: '#8B4513', danger: 7,
    description: 'Mutual threat for ≥1 ply unlocks DUEL: both pieces destroyed simultaneously.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  CARDINAL: {
    label: 'Cardinal', base: 'B', color: '#7F1D1D', danger: 6,
    description: 'Standard bishop + 1 non-capture backward step.',
    isLethal: true, isControl: false, isIndestructible: false
  },

  ICICLE: {
    label: 'Icicle', base: 'B', color: '#BAE6FD', danger: 7,
    description: 'Enemies adjacent to this piece for 2 turns become Frozen, costing a turn to unfreeze. Cannot capture.',
    isLethal: false, isControl: true, isIndestructible: false
  },
  HORDE_MOTHER: {
    label: 'Horde Mother', base: 'B', color: '#C084FC', danger: 9,
    description: 'Whenever it captures an enemy, place a non-promotable Hordeling pawn anywhere. If the Horde Mother or any Hordeling dies, they all die.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  MARAUDER: {
    label: 'Marauder', base: 'B', color: '#6B21A8', danger: 8,
    description: 'Moves like a King (1 step any direction). Gains +2 range in every direction for each piece it kills.',
    isLethal: true, isControl: false, isIndestructible: false
  },

  // ── ROOKS ────────────────────────────────────────────────────────────────
  PHASE_ROOK: {
    label: 'Phase Rook', base: 'R', color: '#22D3EE', danger: 7,
    description: 'Slides through own pieces. Stops at and captures enemies normally.',
    isLethal: true, isControl: false, isIndestructible: false
  },
  SUMOROOK: {
    label: 'SumoRook', base: 'R', color: '#475569', danger: 7,
    description: 'Never captures. PUSHES enemy 1 square in attack direction.',
    isLethal: false, isControl: true, isIndestructible: false
  },

  // ── QUEENS ───────────────────────────────────────────────────────────────
  FISSION_REACTOR: {
    label: 'Fission Reactor', base: 'Q', color: '#EF4444', danger: 9,
    description: 'On 5th capture: remove self + all ENEMY pieces at diagonal distance 1.',
    isLethal: true, isControl: false, isIndestructible: false
  },

  // ── KINGS ────────────────────────────────────────────────────────────────
  ROCKETMAN: {
    label: 'Rocketman', base: 'K', color: '#9CA3AF', danger: 6,
    description: 'Once per game: spend a turn to teleport to any empty square not in check.',
    isLethal: true, isControl: false, isIndestructible: false
  },
};
