export type Terrain = "plain" | "mountain" | "forest" | "river" | "bridge" | "glacier" | "unknown";
export type Feature = "ruins" | "cave" | "chest" | "flag" | null;

export interface Cell {
  /** "unknown" = still under fog for the viewer. */
  t: Terrain;
  f: Feature;
  /** Owning color index, -1 = unpainted. */
  o: number;
}

export type ItemKind = "dash" | "roller" | "bomb" | "scout" | "warp" | "barrier" | "jam" | "bridgeKit";

export type GameMode = "teams" | "ffa";

/** Effects a ruin (or a jam) leaves for the player's *next* turn. */
export interface PendingEffect {
  moveDelta: number;
  ignoreForest: boolean;
  noOverwrite: boolean;
  roller: boolean;
  doubleDice: boolean;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  /** Server-driven test player (only in test rooms). */
  isBot: boolean;
  /** Team / color index. In ffa mode every player has their own. */
  color: number;
  /** Order within the color (1, 2, 3...), used as the piece label. */
  number: number;
  /** Cell index, -1 when unknown to the viewer (hidden in fog). */
  pos: number;
  /** Hidden from other colors (empty array + itemCount). */
  items: ItemKind[];
  itemCount: number;
  pending: PendingEffect;
  /** Non-null while inside a cave: dice total accumulated so far. */
  cave: { total: number } | null;
}

export type TurnStage = "start" | "chooseDie" | "move" | "caveItem";

export interface TurnState {
  playerId: string;
  stage: TurnStage;
  dice: number[];
  /** Movement points for this move (after modifiers). */
  steps: number;
  remaining: number;
  /** Cells visited this move, starting with the start cell. */
  path: number[];
  mods: { roller: boolean; noOverwrite: boolean; ignoreForest: boolean; moveDelta: number; doubleDice: boolean };
  /** Items offered when leaving a cave (pick one). */
  caveChoices: ItemKind[];
}

export type PublicEvent =
  | { type: "setStart"; set: number }
  | { type: "roll"; playerId: string; dice: number[]; steps: number }
  | { type: "item"; playerId: string; item: ItemKind; targetName?: string }
  | { type: "chest"; playerId: string; color: number }
  | { type: "ruins"; playerId: string; roll: number }
  | { type: "caveEnter"; playerId: string }
  | { type: "caveRoll"; playerId: string; roll: number; total: number }
  | { type: "caveExit"; playerId: string; extra: number }
  | { type: "bridge"; playerId: string }
  | { type: "flagFound"; playerId: string }
  | { type: "enclose"; playerId: string; count: number }
  | { type: "score"; set: number; counts: number[]; leader: number; flags: number[]; gained: number[] }
  | { type: "skip"; playerId: string }
  | { type: "win"; color: number; reason: "score" | "conquest" };

export interface RoomSettings {
  mode: GameMode;
  targetScore: number;
  /** Percent of paintable cells one color must own for an instant win. */
  conquestPct: number;
  caveThreshold: number;
  /** 0 = auto (by player count). */
  boardSize: number;
}

export interface ScoringResult {
  set: number;
  counts: number[];
  leader: number;
  flags: number[];
  gained: number[];
}

export interface RoomState {
  code: string;
  /** Test room (opened with TEST_ROOM_CODE): the host can add bots that play automatically. */
  isTest: boolean;
  phase: "lobby" | "playing" | "gameover";
  players: Player[];
  settings: RoomSettings;
  /** Number of colors in play. */
  colorCount: number;
  size: number;
  cells: Cell[];
  /** Server only: per color, cells that color has seen ("0"/"1" string). Emptied for clients. */
  seen: string[];
  /** Flag cells somebody has discovered (visible to everyone). */
  knownFlags: number[];
  /** Cells protected by a barrier until the next scoring. */
  locked: number[];
  /** Paintable cell count, for the conquest bar. */
  paintable: number;
  set: number;
  order: string[];
  turnIndex: number;
  turn: TurnState | null;
  scores: number[];
  /** Current painted cell count per color (public). */
  counts: number[];
  lastScoring: ScoringResult | null;
  log: PublicEvent[];
  winner: number | null;
  winReason: "score" | "conquest" | null;
  createdAt: number;
}

/** Entering this room code opens a fresh private test room with bots. */
export const TEST_ROOM_CODE = "ZZZZZ";
export const TEST_ROOM_BOTS = 3;

/** Dice rolled each turn; movement is their total. */
export const DICE_COUNT = 2;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_FFA_PLAYERS = 4;
export const MAX_ITEMS = 3;
export const VISION = 2;

export const COLOR_NAMES_TEAMS = ["青", "赤"];
export const COLOR_NAMES_FFA = ["赤", "青", "緑", "紫"];

export function colorName(mode: GameMode, color: number): string {
  return (mode === "teams" ? COLOR_NAMES_TEAMS : COLOR_NAMES_FFA)[color] ?? `色${color + 1}`;
}

export const BOARD_SIZE_CHOICES = [30, 42, 50, 58, 70];

export function autoBoardSize(playerCount: number): number {
  if (playerCount <= 4) return 42;
  if (playerCount <= 6) return 50;
  return 58;
}

export function emptyPending(): PendingEffect {
  return { moveDelta: 0, ignoreForest: false, noOverwrite: false, roller: false, doubleDice: false };
}

export function isPaintable(t: Terrain): boolean {
  return t === "plain" || t === "forest" || t === "bridge";
}

export function isPassable(t: Terrain): boolean {
  return t !== "mountain" && t !== "river" && t !== "unknown";
}
