export type PixieType =
  // Pawns
  | 'GOLDEN_PAWN' | 'IRONPAWN' | 'BLUEPRINT' | 'EPEE_PAWN' | 'PAWN_KNIFE'
  | 'HERO_PAWN' | 'SHRIKE' | 'WARP_JUMPER' | 'WAR_AUTOMATON' | 'HORDELING'
  // Knights
  | 'ELECTROKNIGHT' | 'BANKER' | 'CAMEL' | 'KNIGHTMARE' | 'ANTI_VIOLENCE' | 'PINATA'
  | 'FISH_KNIGHT'
  // Bishops
  | 'BOUNCER' | 'PILGRIM' | 'ARISTOCRAT' | 'BASILISK' | 'BLADERUNNER' | 'DANCER' | 'DJINN' | 'GUNSLINGER' | 'CARDINAL'
  | 'ICICLE' | 'HORDE_MOTHER' | 'MARAUDER'
  // Rooks
  | 'PHASE_ROOK' | 'SUMOROOK'
  // Queens
  | 'FISSION_REACTOR'
  // Kings
  | 'ROCKETMAN';

export interface PieceMeta {
  label: string;
  base: 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
  color: string;
  danger: number;
  description: string;
  isLethal: boolean;
  isControl: boolean;
  isIndestructible: boolean;
}

export interface Piece {
  type: 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
  color: 'w' | 'b';
  pixie?: PixieType;
  id: string;
  state?: AbilityState;
  invulnerable?: boolean;
  isBlueprint?: boolean;
}

export type Board = (Piece | null)[][];

export interface Move {
  from: [number, number];
  to: [number, number];
  capture: boolean;
  icicleFreeze?: [number, number];
  bladeThru?: [number, number][];
  lineCap?: [number, number][];
  push?: [number, number];
  pushFrom?: [number, number];   // SumoRook: original square of the pushed piece
  push2From?: [number, number];  // SumoRook: original square of the 2nd pushed piece
  push2?: [number, number];      // SumoRook: second pushed piece destination
  pushFalloff?: [number, number];// SumoRook: square from which a piece falls off the board
  drop?: PixieType;
  dissipate?: boolean;
  duel?: boolean;                // Gunslinger: execute mutual destruction
  epCapSq?: [number, number];
  rocket?: boolean;
  promotion?: 'Q' | 'R' | 'B' | 'N';
  lightning?: boolean;
  shrikePath?: [number, number]; // Shrike: piece captured in path on first 2-tile move
  warpThru?: [number, number][]; // Warp Jumper: pawns jumped through
  heroPromote?: boolean;         // Hero Pawn: instant promotion on giving check
  hordeSpawn?: [number, number]; // Horde Mother: spawn square for hordeling
  fishBonus?: boolean;           // Fish Knight: bonus king-step this move
  obJump?: boolean;              // Knightmare: this move exits board into off-board limbo
  obCapSq?: [number, number];    // Knightmare: off-board coordinate of an enemy Knightmare captured in limbo
}

export interface FrozenPiece {
  square: [number, number];
  turns_remaining: number;
  frozen_by?: [number, number];
}

export interface AbilityState {
  // ELECTROKNIGHT
  consec_moves?: number;
  is_charged?: boolean;

  // FISSION_REACTOR
  capture_count?: number;

  // PILGRIM
  total_dist?: number;
  resurrected?: boolean;

  // DANCER
  bonus_moves?: number;
  active_flag?: boolean;
  just_checked?: boolean;

  // DJINN
  dissipated?: boolean;
  home_sq?: [number, number];

  // GUNSLINGER
  mutual_target?: [number, number];
  mutual_ply?: number;

  // ROCKETMAN
  used_rocket?: boolean;

  // KNIGHTMARE
  off_board?: boolean;
  ob_sq?: [number, number];

  // BLUEPRINT
  resolved_type?: PixieType | null;

  // PINATA
  resolved?: boolean;

  // BANKER
  pawns_banked?: number;

  // FISH_KNIGHT
  moved_last_turn?: boolean;

  // SHRIKE
  has_moved?: boolean;

  // MARAUDER
  kill_count?: number;       // Gains +1 range per kill (starts at 1)

  // HORDE_MOTHER
  hordeling_ids?: string[];  // Track the IDs of all spawned hordelings

  // WAR_AUTOMATON (pawn)
  auto_pending?: boolean;    // Flag set when a piece dies — advance next turn
}

export interface GameState {
  frozen: FrozenPiece[];
  paralyzed: {
    w: [number, number][];
    b: [number, number][];
  };
  promotionBlock: boolean;
  doomed: Record<string, number>;
  lastMove?: Move;
  turn: number;
  enPassant?: [number, number];
  castling?: { K: boolean; Q: boolean; k: boolean; q: boolean; };
  // Knightmare off-board limbo: pieces that have jumped outside the board
  offBoardPieces: Array<{ piece: Piece; obSq: [number, number] }>;
  // Icicle consecutive adjacency tracking (2 turns needed before freeze)
  pendingIcicle: Array<{ square: [number, number]; turns: number }>;
  deadPieces: Piece[];
  gameOver?: boolean;
  winner?: 'w' | 'b' | null;
}

export interface AbilityTracker {
  decrementFreezes(gameState: GameState): void;
  push(gameState: GameState): void;
  pop(): GameState | null;
}
