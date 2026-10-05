import { ITEM_BY_ID, ITEMS, RARE_ITEMS } from "./content";
import { generateTerrain } from "./mapGen";
import {
  autoBoardSize,
  Cell,
  DICE_COUNT,
  emptyPending,
  Feature,
  isPaintable,
  isPassable,
  ItemKind,
  MAX_FFA_PLAYERS,
  MAX_ITEMS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  Player,
  RoomSettings,
  RoomState,
  Terrain,
  TEST_ROOM_CODE,
  TurnState,
  VISION,
  WinReason,
} from "./types";

export class GameError extends Error {}

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function die(): number {
  return rand(6) + 1;
}

function rollDice(count: number): number[] {
  return Array.from({ length: count }, die);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomItem(): ItemKind {
  return ITEMS[rand(ITEMS.length)].id;
}

/** Two different cave treasures to choose from. */
function rareChoices(): ItemKind[] {
  return shuffle(RARE_ITEMS.map((i) => i.id)).slice(0, 2);
}

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = TEST_ROOM_CODE;
  while (code === TEST_ROOM_CODE) {
    code = "";
    for (let i = 0; i < 5; i++) code += alphabet[rand(alphabet.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Grid helpers

function xy(size: number, i: number): [number, number] {
  return [i % size, Math.floor(i / size)];
}

function idx(size: number, x: number, y: number): number {
  return y * size + x;
}

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function neighbors4(size: number, i: number): number[] {
  const [x, y] = xy(size, i);
  const out: number[] = [];
  for (const [dx, dy] of DIRS4) if (inBounds(size, x + dx, y + dy)) out.push(idx(size, x + dx, y + dy));
  return out;
}

/** Cells within Chebyshev distance r (a (2r+1)² square). */
function square(size: number, i: number, r: number): number[] {
  const [x, y] = xy(size, i);
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (inBounds(size, x + dx, y + dy)) out.push(idx(size, x + dx, y + dy));
  return out;
}

function chebyshev(size: number, a: number, b: number): number {
  const [ax, ay] = xy(size, a);
  const [bx, by] = xy(size, b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// ---------------------------------------------------------------------------
// Lobby

function newPlayer(id: string, name: string, color: number, isHost: boolean, isBot = false): Player {
  return {
    id,
    name,
    connected: true,
    isHost,
    isBot,
    color,
    number: 0,
    pos: -1,
    items: [],
    itemCount: 0,
    pending: emptyPending(),
    cave: null,
    resting: false,
  };
}

export function createRoom(hostId: string, hostName: string, isTest = false): RoomState {
  return {
    code: makeRoomCode(),
    isTest,
    phase: "lobby",
    players: [newPlayer(hostId, hostName, 0, true)],
    settings: { mode: "teams", targetScore: 15, conquestPct: 75, caveThreshold: 20, boardSize: 0, flagWin: 5 },
    colorCount: 2,
    size: 0,
    cells: [],
    seen: [],
    knownFlags: [],
    locked: [],
    sanctuaries: [],
    flagCounts: [],
    flagTotal: 0,
    paintable: 0,
    set: 0,
    order: [],
    turnIndex: 0,
    turn: null,
    scores: [],
    counts: [],
    lastScoring: null,
    log: [],
    winner: null,
    winReason: null,
    createdAt: Date.now(),
  };
}

/** In teams mode new players join the smaller team. In ffa mode colors are assigned at start. */
function smallerTeam(players: Player[]): number {
  const blue = players.filter((p) => p.color === 0).length;
  const red = players.filter((p) => p.color === 1).length;
  return red < blue ? 1 : 0;
}

export function addPlayer(room: RoomState, playerId: string, name: string): RoomState {
  if (room.phase !== "lobby") throw new GameError("このゲームはすでに開始されています");
  if (room.players.some((p) => p.id === playerId)) return room;
  if (room.players.length >= MAX_PLAYERS) throw new GameError(`部屋の定員(${MAX_PLAYERS}人)に達しています`);
  const players = [...room.players, newPlayer(playerId, name, smallerTeam(room.players), false)];
  if (!players.some((p) => p.isHost)) players[0] = { ...players[0], isHost: true };
  return { ...room, players };
}

export function markConnection(room: RoomState, playerId: string, connected: boolean): RoomState {
  return { ...room, players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)) };
}

export function removePlayer(room: RoomState, playerId: string): RoomState {
  const players = room.players.filter((p) => p.id !== playerId);
  if (players.length > 0 && !players.some((p) => p.isHost)) players[0] = { ...players[0], isHost: true };
  return { ...room, players };
}

export function updateSettings(room: RoomState, requesterId: string, settings: Partial<RoomSettings>): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみが設定を変更できます");
  if (room.phase !== "lobby" && room.phase !== "gameover") throw new GameError("ゲーム中は設定を変更できません");
  const next: RoomSettings = { ...room.settings };
  if (settings.mode === "teams" || settings.mode === "ffa") next.mode = settings.mode;
  const clampInt = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
  next.targetScore = clampInt(settings.targetScore, 3, 100) ?? next.targetScore;
  next.conquestPct = clampInt(settings.conquestPct, 50, 100) ?? next.conquestPct;
  next.caveThreshold = clampInt(settings.caveThreshold, 3, 60) ?? next.caveThreshold;
  next.flagWin = clampInt(settings.flagWin, 0, 9) ?? next.flagWin;
  if (settings.boardSize !== undefined) {
    const b = clampInt(settings.boardSize, 0, 80);
    if (b !== undefined) next.boardSize = b === 0 ? 0 : Math.max(15, b);
  }
  return { ...room, settings: next };
}

// Test rooms: the host can add bots that play automatically (see lib/bot.ts).

export function addBot(room: RoomState, requesterId: string, color?: number): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみがボットを追加できます");
  if (!room.isTest) throw new GameError("ボットはテスト部屋でのみ使えます");
  if (room.phase !== "lobby") throw new GameError("ゲーム中はボットを追加できません");
  if (room.players.length >= MAX_PLAYERS) throw new GameError(`部屋の定員(${MAX_PLAYERS}人)に達しています`);
  let n = 1;
  while (room.players.some((p) => p.name === `ボット${n}`)) n++;
  const id = `bot-${Date.now().toString(36)}-${rand(1e6).toString(36)}`;
  const team = color === 0 || color === 1 ? color : smallerTeam(room.players);
  return { ...room, players: [...room.players, newPlayer(id, `ボット${n}`, team, false, true)] };
}

export function removeBot(room: RoomState, requesterId: string, botId: string): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみがボットを外せます");
  if (room.phase !== "lobby") throw new GameError("ゲーム中はボットを外せません");
  if (!room.players.some((p) => p.id === botId && p.isBot)) throw new GameError("ボットが見つかりません");
  return { ...room, players: room.players.filter((p) => p.id !== botId) };
}

/** Teams mode: a player switches themselves between 青 and 赤. */
export function chooseTeam(room: RoomState, playerId: string, color: number, targetId?: string): RoomState {
  if (room.phase !== "lobby" && room.phase !== "gameover") throw new GameError("ゲーム中はチームを変更できません");
  if (color !== 0 && color !== 1) throw new GameError("不正なチームです");
  // The host may also move bots between teams.
  let moving = playerId;
  if (targetId && targetId !== playerId) {
    const requester = room.players.find((p) => p.id === playerId);
    const target = room.players.find((p) => p.id === targetId);
    if (!requester?.isHost || !target?.isBot) throw new GameError("ボットのチームはホストのみが変更できます");
    moving = targetId;
  }
  return { ...room, players: room.players.map((p) => (p.id === moving ? { ...p, color } : p)) };
}

// ---------------------------------------------------------------------------
// Map generation

interface GeneratedMap {
  t: Terrain[];
  f: Feature[];
}

function generateMap(size: number, bases: number[], flagCount: number): GeneratedMap {
  // Small boards with many players may not fit everything at full spacing:
  // relax the spacing rules step by step rather than giving up.
  for (let relax = 0; relax <= 3; relax++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const map = tryGenerateMap(size, bases, flagCount, relax);
      if (map) return map;
    }
  }
  // Extremely unlikely; fall back to an open field so the game can always start.
  return { t: Array(size * size).fill("plain"), f: Array(size * size).fill(null) };
}

function tryGenerateMap(size: number, bases: number[], flagCount: number, relax: number): GeneratedMap | null {
  const n = size * size;
  const terrain = generateTerrain(size, bases, relax);
  if (!terrain) return null;
  const t: Terrain[] = terrain;
  const f: Feature[] = Array(n).fill(null);

  // Features on plain ground, away from the starting areas.
  const farFromBases = (c: number, d: number) => bases.every((b) => chebyshev(size, b, c) >= d);
  function place(feature: Exclude<Feature, null>, count: number, minBaseDist: number, minSpacing: number) {
    const candidates = shuffle(Array.from({ length: n }, (_, i) => i)).filter(
      (c) => t[c] === "plain" && f[c] === null && farFromBases(c, minBaseDist)
    );
    const chosen: number[] = [];
    for (const c of candidates) {
      if (chosen.length >= count) break;
      if (chosen.every((o) => chebyshev(size, o, c) >= minSpacing)) {
        chosen.push(c);
        f[c] = feature;
      }
    }
    return chosen.length;
  }

  const flagSpacing = Math.max(4 - relax, Math.round(size / (Math.sqrt(flagCount) + 1.5)) - relax * 2);
  if (place("flag", flagCount, Math.max(3, 5 - relax), flagSpacing) < flagCount) return null;
  place("cave", Math.round(n / 150), 4, 4);
  place("ruins", Math.round(n / 90), 4, 3);
  place("chest", Math.round(n / 60), 3, 2);

  // Every base must reach every other base on foot (no bridges needed), and
  // every flag must be reachable once rivers are bridged.
  const walk = (allowRiver: boolean) => {
    const seen = new Uint8Array(n);
    const queue = [bases[0]];
    seen[bases[0]] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      for (const nb of neighbors4(size, c)) {
        if (seen[nb]) continue;
        if (t[nb] === "mountain" || (!allowRiver && t[nb] === "river")) continue;
        seen[nb] = 1;
        queue.push(nb);
      }
    }
    return seen;
  };
  const onFoot = walk(false);
  if (!bases.every((b) => onFoot[b])) return null;
  const withBridges = walk(true);
  for (let c = 0; c < n; c++) if (f[c] === "flag" && !withBridges[c]) return null;

  return { t, f };
}

// ---------------------------------------------------------------------------
// Game setup

function basePositions(size: number, colorCount: number): number[] {
  const m = Math.round(size * 0.2);
  const lo = m;
  const hi = size - 1 - m;
  const corners = [idx(size, lo, lo), idx(size, hi, hi), idx(size, hi, lo), idx(size, lo, hi)];
  return corners.slice(0, colorCount);
}

/**
 * Team mode: every player gets their own starting spot, spread across the
 * board (not too close to the edge or to anyone else).
 */
function scatteredStarts(size: number, count: number): number[] {
  const margin = Math.max(3, Math.round(size * 0.08));
  const span = size - 2 * margin;
  for (let spacing = Math.round(size / (Math.sqrt(count) + 0.5)); spacing >= 4; spacing--) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const starts: number[] = [];
      for (let tries = 0; tries < 400 && starts.length < count; tries++) {
        const c = idx(size, margin + rand(span), margin + rand(span));
        if (starts.every((o) => chebyshev(size, o, c) >= spacing)) starts.push(c);
      }
      if (starts.length === count) return starts;
    }
  }
  return Array.from({ length: count }, (_, i) => idx(size, margin + i * 2, margin)); // unreachable in practice
}

const START_OFFSETS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

function validateStart(room: RoomState) {
  const count = room.players.length;
  if (count < MIN_PLAYERS) throw new GameError(`${MIN_PLAYERS}人以上で開始できます`);
  if (room.settings.mode === "teams") {
    if (!room.players.some((p) => p.color === 0) || !room.players.some((p) => p.color === 1)) {
      throw new GameError("青チームと赤チームに1人以上ずつ必要です");
    }
  } else if (count > MAX_FFA_PLAYERS) {
    throw new GameError(`個人戦は${MAX_FFA_PLAYERS}人までです`);
  }
}

function dealNewGame(prev: RoomState): RoomState {
  const room = structuredClone(prev);
  const ffa = room.settings.mode === "ffa";
  if (ffa) room.players.forEach((p, i) => (p.color = i));
  const colorCount = ffa ? room.players.length : 2;
  const size = room.settings.boardSize || autoBoardSize(room.players.length);
  // Team mode: one start per player, scattered. Individual mode: one corner each.
  const starts = ffa ? basePositions(size, colorCount) : scatteredStarts(size, room.players.length);
  // Enough flags that a flag win (if on) needs most but not all of them.
  const flagWin = room.settings.flagWin;
  const flagCount = Math.max(Math.min(9, Math.max(5, Math.round(size / 4.3))), flagWin ? flagWin + 2 : 0);
  const map = generateMap(size, starts, flagCount);

  room.colorCount = colorCount;
  room.size = size;
  room.cells = map.t.map((t, i) => ({ t, f: map.f[i], o: -1 }));
  room.seen = Array.from({ length: colorCount }, () => "0".repeat(size * size));
  room.knownFlags = [];
  room.locked = [];
  room.sanctuaries = [];
  room.flagCounts = Array(colorCount).fill(0);
  room.flagTotal = room.cells.filter((c) => c.f === "flag").length;
  room.paintable = room.cells.filter((c) => isPaintable(c.t)).length;
  room.scores = Array(colorCount).fill(0);
  room.lastScoring = null;
  room.log = [];
  room.winner = null;
  room.winReason = null;

  const shuffledStarts = shuffle(starts);
  for (let c = 0; c < colorCount; c++) {
    const members = room.players.filter((p) => p.color === c);
    members.forEach((p, i) => {
      // Individual mode: one player per corner. Team mode: everyone takes their own scattered spot.
      const base = ffa ? starts[c] : shuffledStarts.pop()!;
      for (const cell of square(size, base, 1)) room.cells[cell].o = c;
      const [bx, by] = xy(size, base);
      const [dx, dy] = ffa ? START_OFFSETS[i % START_OFFSETS.length] : [0, 0];
      p.number = i + 1;
      p.pos = idx(size, bx + dx, by + dy);
      p.items = [];
      p.itemCount = 0;
      p.pending = emptyPending();
      p.cave = null;
      p.resting = false;
    });
  }
  for (const p of room.players) reveal(room, p.color, p.pos, VISION, p.id);

  // Teams alternate (青1 → 赤1 → 青2 → 赤2 ...); ffa goes in join order.
  const byColor = Array.from({ length: colorCount }, (_, c) => room.players.filter((p) => p.color === c));
  const order: string[] = [];
  for (let i = 0; order.length < room.players.length; i++) {
    for (const list of byColor) if (list[i]) order.push(list[i].id);
  }
  room.order = order;
  room.phase = "playing";
  room.set = 1;
  room.turnIndex = 0;
  recount(room);
  room.log.push({ type: "setStart", set: 1 });
  beginTurn(room);
  return room;
}

export function startGame(room: RoomState, requesterId: string): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみがゲームを開始できます");
  if (room.phase !== "lobby") throw new GameError("すでにゲームが開始されています");
  validateStart(room);
  return dealNewGame(room);
}

export function playAgain(room: RoomState, requesterId: string): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみが再戦を開始できます");
  if (room.phase !== "gameover") throw new GameError("ゲームはまだ終わっていません");
  validateStart(room);
  return dealNewGame(room);
}

/** Back to the lobby after a game (to change teams or settings). */
export function backToLobby(room: RoomState, requesterId: string): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみが操作できます");
  if (room.phase !== "gameover") throw new GameError("ゲームはまだ終わっていません");
  const r = structuredClone(room);
  r.phase = "lobby";
  if (r.settings.mode === "ffa") {
    // Re-seed teams so switching back to teams mode starts balanced.
    r.players.forEach((p, i) => (p.color = i % 2));
  }
  return r;
}

// ---------------------------------------------------------------------------
// Board mechanics

function seenBy(room: RoomState, color: number, cell: number): boolean {
  return room.seen[color]?.[cell] === "1";
}

function reveal(room: RoomState, color: number, center: number, radius: number, byPlayerId: string) {
  const seen = room.seen[color].split("");
  for (const c of square(room.size, center, radius)) {
    if (seen[c] === "1") continue;
    seen[c] = "1";
    if (room.cells[c].f === "flag" && !room.knownFlags.includes(c)) {
      room.knownFlags.push(c);
      room.log.push({ type: "flagFound", playerId: byPlayerId });
    }
  }
  room.seen[color] = seen.join("");
}

function isProtected(room: RoomState, cell: number, painter: number): boolean {
  if (room.players.some((p) => p.cave && p.pos === cell)) return true;
  const owner = room.cells[cell].o;
  if (owner >= 0 && owner !== painter && room.sanctuaries.some((s) => s.color === owner)) return true;
  return room.locked.includes(cell) && room.cells[cell].o !== painter;
}

/** Returns true when the cell changed color. */
function paint(room: RoomState, cell: number, painter: Player, noOverwrite: boolean): boolean {
  const c = room.cells[cell];
  const color = painter.color;
  if (!isPaintable(c.t) || c.o === color) return false;
  if (c.o >= 0 && noOverwrite) return false;
  if (isProtected(room, cell, color)) return false;
  c.o = color;
  return true;
}

/**
 * Anything not connected to the board edge through non-`color` cells is
 * enclosed and becomes `color` (terrain doesn't block; glaciers etc. just
 * stay unpainted).
 */
function captureEnclosed(room: RoomState, painter: Player): number {
  const color = painter.color;
  const { size, cells } = room;
  const n = size * size;
  const outside = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = xy(size, i);
    const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    if (edge && cells[i].o !== color) {
      outside[i] = 1;
      queue.push(i);
    }
  }
  while (queue.length) {
    const c = queue.pop()!;
    for (const nb of neighbors4(size, c)) {
      if (outside[nb] || cells[nb].o === color) continue;
      outside[nb] = 1;
      queue.push(nb);
    }
  }
  let captured = 0;
  for (let i = 0; i < n; i++) {
    if (!outside[i] && cells[i].o !== color && paint(room, i, painter, false)) captured++;
  }
  return captured;
}

function recount(room: RoomState) {
  const counts = Array(room.colorCount).fill(0);
  const flags = Array(room.colorCount).fill(0);
  for (const c of room.cells) {
    if (c.o < 0) continue;
    counts[c.o]++;
    if (c.f === "flag") flags[c.o]++;
  }
  room.counts = counts;
  // "リーチ": announce when a color gets one flag away from a flag win.
  const need = room.settings.flagWin;
  if (need > 1) {
    flags.forEach((held, color) => {
      if (held === need - 1 && (room.flagCounts[color] ?? 0) < need - 1) room.log.push({ type: "flagReach", color, held });
    });
  }
  room.flagCounts = flags;
}

/** Holding enough flags at once wins on the spot. */
function checkFlagWin(room: RoomState): boolean {
  const need = room.settings.flagWin;
  if (!need || room.phase !== "playing") return false;
  const color = room.flagCounts.findIndex((n) => n >= need);
  if (color < 0) return false;
  finish(room, color, "flags");
  return true;
}

function afterPaint(room: RoomState, player: Player) {
  const captured = captureEnclosed(room, player);
  if (captured > 0) room.log.push({ type: "enclose", playerId: player.id, count: captured });
  recount(room);
}

/**
 * Movement points to enter `cell` (can be a half): forest 2 / otherwise 1;
 * your own color halves it, an opponent's color adds 1; and closing in on an
 * opponent's piece (within 1 cell, diagonals included) adds 1 more.
 */
export function stepCost(room: RoomState, cell: number, turn: TurnState): number {
  let cost = room.cells[cell].t === "forest" && !turn.mods.ignoreForest ? 2 : 1;
  const mover = room.players.find((p) => p.id === turn.playerId);
  if (!mover) return cost;
  const owner = room.cells[cell].o;
  if (owner === mover.color) cost /= 2;
  else if (owner >= 0) cost = turn.mods.skates ? (cost + 1) / 2 : cost + 1;
  if (room.players.some((p) => p.color !== mover.color && p.pos >= 0 && chebyshev(room.size, p.pos, cell) <= 1)) cost += 1;
  return cost;
}

function occupiedByOther(room: RoomState, cell: number, playerId: string): boolean {
  return room.players.some((p) => p.id !== playerId && p.pos === cell);
}

/** Can a piece at `pos` with `remaining` movement still end exactly on a free cell? */
function canFinish(room: RoomState, player: Player, turn: TurnState, pos: number, remaining: number, memo: Map<number, boolean>): boolean {
  if (remaining === 0) return !occupiedByOther(room, pos, player.id);
  const key = pos * 256 + remaining * 2; // remaining moves in halves
  const known = memo.get(key);
  if (known !== undefined) return known;
  memo.set(key, false);
  const result = neighbors4(room.size, pos).some((nb) => {
    if (!isPassable(room.cells[nb].t)) return false;
    const cost = stepCost(room, nb, turn);
    return cost <= remaining && canFinish(room, player, turn, nb, remaining - cost, memo);
  });
  memo.set(key, result);
  return result;
}

/** Why a step to `to` is illegal, or null when it's fine. */
function stepError(room: RoomState, player: Player, turn: TurnState, to: number): string | null {
  if (!Number.isInteger(to) || to < 0 || to >= room.size * room.size) return "盤面の外です";
  if (!neighbors4(room.size, player.pos).includes(to)) return "隣のマスにしか進めません";
  const cell = room.cells[to];
  if (cell.t === "mountain") return "山は通れません";
  if (cell.t === "river") return "川は橋がないと渡れません";
  const cost = stepCost(room, to, turn);
  if (cost > turn.remaining) return `移動力が足りません(このマスは${cost}必要)`;
  if (turn.remaining - cost === 0 && occupiedByOther(room, to, player.id)) return "他のコマがいるマスには止まれません";
  // Don't walk into a dead end where the move can no longer finish on a free
  // cell — unless no finishing route exists at all (then anything goes and
  // the player may stop when stuck).
  const memo = new Map<number, boolean>();
  if (!canFinish(room, player, turn, to, turn.remaining - cost, memo) && canFinish(room, player, turn, player.pos, turn.remaining, memo)) {
    return "そこへ進むと止まれるマスがなくなります";
  }
  return null;
}

export function legalSteps(room: RoomState, player: Player, turn: TurnState): number[] {
  return neighbors4(room.size, player.pos).filter((c) => stepError(room, player, turn, c) === null);
}

// ---------------------------------------------------------------------------
// Turn flow

function byId(room: RoomState, id: string): Player {
  const p = room.players.find((pl) => pl.id === id);
  if (!p) throw new GameError("プレイヤーが見つかりません");
  return p;
}

function beginTurn(room: RoomState) {
  const player = byId(room, room.order[room.turnIndex]);
  // 聖域 wears off as its user's turns come around.
  for (const s of room.sanctuaries) if (s.playerId === player.id) s.turnsLeft--;
  room.sanctuaries = room.sanctuaries.filter((s) => s.turnsLeft > 0);
  // 1回休み: the turn passes straight on (it still counts toward the set).
  if (player.resting) {
    player.resting = false;
    room.log.push({ type: "rest", playerId: player.id });
    room.turn = null;
    endTurn(room);
    return;
  }
  const pend = player.pending;
  room.turn = {
    playerId: player.id,
    stage: "start",
    dice: [],
    steps: 0,
    remaining: 0,
    path: [player.pos],
    mods: {
      roller: pend.roller,
      wideRoller: false,
      skates: false,
      noOverwrite: pend.noOverwrite,
      ignoreForest: pend.ignoreForest,
      moveDelta: pend.moveDelta,
      doubleDice: pend.doubleDice,
    },
    caveChoices: [],
  };
  player.pending = emptyPending();
}

/** Validates it's this player's turn at one of `stages`, returns a working copy. */
function actorTurn(room: RoomState, playerId: string, stages: TurnState["stage"][]) {
  if (room.phase !== "playing" || !room.turn) throw new GameError("ゲーム中ではありません");
  if (room.turn.playerId !== playerId) throw new GameError("あなたの手番ではありません");
  if (!stages.includes(room.turn.stage)) throw new GameError("今はその操作はできません");
  const r = structuredClone(room);
  return { r, player: byId(r, playerId), turn: r.turn! };
}

function checkConquest(room: RoomState): boolean {
  const need = Math.ceil((room.paintable * room.settings.conquestPct) / 100);
  const c = room.counts.findIndex((n) => n >= need);
  if (c < 0) return false;
  finish(room, c, "conquest");
  return true;
}

function finish(room: RoomState, color: number, reason: WinReason) {
  room.phase = "gameover";
  room.winner = color;
  room.winReason = reason;
  room.turn = null;
  room.log.push({ type: "win", color, reason });
}

function scoreSet(room: RoomState) {
  const counts = room.counts.slice();
  const max = Math.max(...counts);
  const leaders = counts.flatMap((n, c) => (n === max ? [c] : []));
  const leader = leaders.length === 1 ? leaders[0] : -1;
  const flags = Array(room.colorCount).fill(0);
  room.cells.forEach((cell) => {
    if (cell.f === "flag" && cell.o >= 0) flags[cell.o]++;
  });
  const gained = Array(room.colorCount).fill(0);
  if (leader >= 0) gained[leader] = 1 + flags[leader];
  room.scores = room.scores.map((s, c) => s + gained[c]);
  room.lastScoring = { set: room.set, counts, leader, flags, gained };
  room.log.push({ type: "score", set: room.set, counts, leader, flags, gained });
  room.locked = [];
}

function endTurn(room: RoomState) {
  if (room.phase !== "playing" || checkFlagWin(room) || checkConquest(room)) return;
  room.turnIndex++;
  if (room.turnIndex >= room.order.length) {
    scoreSet(room);
    const top = Math.max(...room.scores);
    if (top >= room.settings.targetScore) {
      finish(room, room.scores.indexOf(top), "score");
      return;
    }
    room.set++;
    room.turnIndex = 0;
    room.log.push({ type: "setStart", set: room.set });
  }
  beginTurn(room);
}

function startMove(room: RoomState, turn: TurnState, player: Player) {
  const steps = Math.max(1, sum(turn.dice) + turn.mods.moveDelta);
  turn.stage = "move";
  turn.steps = steps;
  turn.remaining = steps;
  turn.path = [player.pos];
  room.log.push({ type: "roll", playerId: player.id, dice: turn.dice, steps });
}

export function roll(room: RoomState, playerId: string): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["start"]);

  if (player.cave) {
    turn.dice = rollDice(DICE_COUNT);
    player.cave.total += sum(turn.dice);
    r.log.push({ type: "caveRoll", playerId, roll: sum(turn.dice), total: player.cave.total });
    if (player.cave.total < r.settings.caveThreshold) {
      endTurn(r);
      return r;
    }
    const extra = player.cave.total - r.settings.caveThreshold;
    player.cave = null;
    r.log.push({ type: "caveExit", playerId, extra });
    turn.stage = "caveItem";
    turn.caveChoices = rareChoices();
    turn.steps = extra;
    turn.remaining = extra;
    turn.path = [player.pos];
    return r;
  }

  if (turn.mods.doubleDice) {
    // Ruins "選べる運命": roll one extra die, then drop the one you don't want.
    turn.dice = rollDice(DICE_COUNT + 1);
    turn.stage = "chooseDie";
    return r;
  }
  turn.dice = rollDice(DICE_COUNT);
  startMove(r, turn, player);
  return r;
}

export function chooseDie(room: RoomState, playerId: string, index: number): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["chooseDie"]);
  // `index` is the die to leave out.
  if (turn.dice[index] === undefined) throw new GameError("使わないサイコロを選んでください");
  turn.dice = turn.dice.filter((_, i) => i !== index);
  startMove(r, turn, player);
  return r;
}

/** Pick one of the offered items when leaving a cave (index -1 = take nothing). */
export function takeCaveItem(room: RoomState, playerId: string, index: number): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["caveItem"]);
  if (index >= 0) {
    const item = turn.caveChoices[index];
    if (!item) throw new GameError("アイテムを選んでください");
    if (player.items.length >= MAX_ITEMS) throw new GameError(`アイテムは${MAX_ITEMS}個までしか持てません`);
    player.items.push(item);
    player.itemCount = player.items.length;
  }
  turn.caveChoices = [];
  if (turn.remaining > 0) {
    turn.stage = "move";
  } else {
    endTurn(r);
  }
  return r;
}

export function step(room: RoomState, playerId: string, to: number): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["move"]);
  const err = stepError(r, player, turn, to);
  if (err) throw new GameError(err);

  const from = player.pos;
  turn.remaining -= stepCost(r, to, turn);
  turn.path.push(to);
  player.pos = to;
  reveal(r, player.color, to, VISION, playerId);

  paint(r, to, player, turn.mods.noOverwrite);
  const reach = turn.mods.wideRoller ? 2 : turn.mods.roller ? 1 : 0;
  if (reach) {
    const [fx, fy] = xy(r.size, from);
    const [tx, ty] = xy(r.size, to);
    const [dx, dy] = [tx - fx, ty - fy];
    for (let k = 1; k <= reach; k++) {
      for (const [px, py] of [
        [tx + dy * k, ty + dx * k],
        [tx - dy * k, ty - dx * k],
      ]) {
        if (inBounds(r.size, px, py)) paint(r, idx(r.size, px, py), player, turn.mods.noOverwrite);
      }
    }
  }

  const cell = r.cells[to];
  if (cell.f === "chest" && player.items.length < MAX_ITEMS) {
    player.items.push(randomItem());
    player.itemCount = player.items.length;
    cell.f = null;
    r.log.push({ type: "chest", playerId, color: player.color });
  } else if (cell.f === "ruins") {
    const d = die();
    applyRuins(player, d);
    cell.f = null;
    r.log.push({ type: "ruins", playerId, roll: d });
  }

  afterPaint(r, player);
  if (checkFlagWin(r)) return r;

  if (turn.remaining === 0) {
    if (cell.f === "cave") enterCave(r, player);
    endTurn(r);
  } else if (cell.f !== "cave" && legalSteps(r, player, turn).length === 0) {
    // Leftover movement that can't be spent (e.g. half a point with no own
    // cell next to you): the move just ends. On a cave, let the player choose.
    endTurn(r);
  }
  return r;
}

function applyRuins(player: Player, roll: number) {
  const p = player.pending;
  if (roll === 1) p.moveDelta += 3;
  else if (roll === 2) p.moveDelta -= 2;
  else if (roll === 3) p.ignoreForest = true;
  else if (roll === 4) p.noOverwrite = true;
  else if (roll === 5) p.roller = true;
  else p.doubleDice = true;
}

function enterCave(room: RoomState, player: Player) {
  player.cave = { total: 0 };
  room.log.push({ type: "caveEnter", playerId: player.id });
}

/** Stop moving early: only when stuck, or to go into a cave you're standing on. */
export function endMove(room: RoomState, playerId: string, enterCaveHere: boolean): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["move"]);
  if (enterCaveHere) {
    if (r.cells[player.pos].f !== "cave") throw new GameError("ここは洞窟ではありません");
    if (turn.path.length < 2) throw new GameError("出たばかりの洞窟には入れません");
    enterCave(r, player);
  } else if (legalSteps(r, player, turn).length > 0) {
    throw new GameError("まだ進めます(出た目の数だけ進んでください)");
  }
  endTurn(r);
  return r;
}

/** Spend the whole turn building a bridge on an adjacent river. */
/**
 * Build a bridge on an adjacent river. At the start of the turn it costs the
 * whole turn; mid-move it ends the move and costs the player's next turn.
 */
export function buildBridge(room: RoomState, playerId: string, cell: number): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["start", "move"]);
  if (player.cave) throw new GameError("洞窟の中では橋を架けられません");
  const midMove = turn.stage === "move";
  if (midMove && occupiedByOther(r, player.pos, playerId)) throw new GameError("他のコマがいるマスでは橋を架けられません");
  placeBridge(r, player, cell);
  if (midMove) player.resting = true;
  r.log.push({ type: "bridge", playerId, rest: midMove });
  endTurn(r);
  return r;
}

function placeBridge(room: RoomState, player: Player, cell: number) {
  if (!neighbors4(room.size, player.pos).includes(cell)) throw new GameError("自分のコマの隣の川を選んでください");
  if (room.cells[cell].t !== "river") throw new GameError("川を選んでください");
  room.cells[cell].t = "bridge";
  room.paintable++;
}

export function applyItem(room: RoomState, playerId: string, index: number, target: number | string | null): RoomState {
  const { r, player, turn } = actorTurn(room, playerId, ["start"]);
  if (player.cave) throw new GameError("洞窟の中ではアイテムを使えません");
  const item = player.items[index];
  if (!item) throw new GameError("アイテムがありません");
  const def = ITEM_BY_ID[item];
  let targetName: string | undefined;

  switch (item) {
    case "dash":
      turn.mods.moveDelta += 5;
      break;
    case "roller":
      turn.mods.roller = true;
      break;
    case "bomb":
      for (const c of square(r.size, player.pos, 1)) paint(r, c, player, false);
      afterPaint(r, player);
      if (checkFlagWin(r)) return r;
      break;
    case "scout": {
      const c = cellTarget(r, target);
      reveal(r, player.color, c, 3, playerId);
      break;
    }
    case "warp": {
      const c = cellTarget(r, target);
      if (r.cells[c].o !== player.color) throw new GameError("自分の色のマスを選んでください");
      if (occupiedByOther(r, c, playerId)) throw new GameError("他のコマがいるマスには移動できません");
      player.pos = c;
      turn.path = [c];
      reveal(r, player.color, c, VISION, playerId);
      break;
    }
    case "barrier": {
      const c = cellTarget(r, target);
      if (r.cells[c].o !== player.color) throw new GameError("自分の色のマスを選んでください");
      for (const s of square(r.size, c, 1)) {
        if (r.cells[s].o === player.color && !r.locked.includes(s)) r.locked.push(s);
      }
      break;
    }
    case "jam": {
      const victim = r.players.find((p) => p.id === target);
      if (!victim || victim.color === player.color) throw new GameError("相手のプレイヤーを選んでください");
      victim.pending.moveDelta -= 2;
      targetName = victim.name;
      break;
    }
    case "bridgeKit":
      placeBridge(r, player, cellTarget(r, target));
      break;
    case "megaBomb":
      for (const c of square(r.size, player.pos, 2)) paint(r, c, player, false);
      afterPaint(r, player);
      if (checkFlagWin(r)) return r;
      break;
    case "missile": {
      // Three strikes anywhere on the board (fog included); each paints a 3×3
      // and clears the fog there for the firing team so they see where it landed.
      for (let k = 0; k < 3; k++) {
        const center = rand(r.size * r.size);
        for (const c of square(r.size, center, 1)) paint(r, c, player, false);
        reveal(r, player.color, center, 1, playerId);
      }
      afterPaint(r, player);
      if (checkFlagWin(r)) return r;
      break;
    }
    case "ancientMap": {
      const c = cellTarget(r, target);
      // Every flag is exposed (to everyone, like any found flag), plus a big clearing.
      const seen = r.seen[player.color].split("");
      r.cells.forEach((cell, i) => {
        if (cell.f !== "flag") return;
        seen[i] = "1";
        if (!r.knownFlags.includes(i)) r.knownFlags.push(i);
      });
      r.seen[player.color] = seen.join("");
      reveal(r, player.color, c, 5, playerId);
      break;
    }
    case "wideRoller":
      turn.mods.wideRoller = true;
      break;
    case "sanctuary":
      r.sanctuaries = r.sanctuaries.filter((s) => s.color !== player.color);
      r.sanctuaries.push({ color: player.color, playerId, turnsLeft: 2 });
      break;
    case "storm":
      for (const p of r.players) if (p.color !== player.color) p.pending.moveDelta -= 3;
      targetName = "相手全員";
      break;
    case "pegasus": {
      const c = cellTarget(r, target);
      if (!seenBy(r, player.color, c)) throw new GameError("見えているマスを選んでください");
      if (!isPassable(r.cells[c].t)) throw new GameError("そこには降りられません");
      if (occupiedByOther(r, c, playerId)) throw new GameError("他のコマがいるマスには移動できません");
      player.pos = c;
      turn.path = [c];
      reveal(r, player.color, c, VISION, playerId);
      break;
    }
    case "skates":
      turn.mods.skates = true;
      break;
  }

  player.items.splice(index, 1);
  player.itemCount = player.items.length;
  r.log.push({ type: "item", playerId, item: def.id, targetName });
  return r;
}

function cellTarget(room: RoomState, target: number | string | null): number {
  if (typeof target !== "number" || !Number.isInteger(target) || target < 0 || target >= room.size * room.size) {
    throw new GameError("マスを選んでください");
  }
  return target;
}

// ---------------------------------------------------------------------------
// Host tools

/** Lets the host move the game along when the player whose turn it is has dropped. */
export function hostSkip(room: RoomState, requesterId: string): RoomState {
  const requester = room.players.find((p) => p.id === requesterId);
  if (!requester?.isHost) throw new GameError("ホストのみが操作できます");
  if (room.phase !== "playing" || !room.turn) throw new GameError("進められる手番がありません");
  const actor = byId(room, room.turn.playerId);
  if (actor.connected) throw new GameError("そのプレイヤーは接続中です");
  const r = structuredClone(room);
  r.log.push({ type: "skip", playerId: actor.id });
  endTurn(r);
  return r;
}

// ---------------------------------------------------------------------------
// Visibility

const FOG: Cell = { t: "unknown", f: null, o: -1 };

export function sanitizeForPlayer(room: RoomState, viewerId: string): RoomState {
  if (room.phase !== "playing") return { ...room, seen: [] };
  const viewer = room.players.find((p) => p.id === viewerId);
  const color = viewer?.color ?? -1;
  const visible = (c: number) => seenBy(room, color, c) || room.knownFlags.includes(c);
  const turn = room.turn;
  const actorIsAlly = !!turn && byId(room, turn.playerId).color === color;
  return {
    ...room,
    seen: [],
    cells: room.cells.map((c, i) => (visible(i) ? c : FOG)),
    players: room.players.map((p) =>
      p.color === color ? p : { ...p, items: [], pos: p.pos >= 0 && visible(p.pos) ? p.pos : -1 }
    ),
    turn: turn && {
      ...turn,
      path: actorIsAlly ? turn.path : turn.path.filter(visible),
      caveChoices: turn.playerId === viewerId ? turn.caveChoices : [],
    },
  };
}
