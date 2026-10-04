// Plays many random games straight against the engine to shake out rule bugs.
// Run: npx tsx scripts/simulate.ts [games]
import {
  addPlayer,
  buildBridge,
  chooseDie,
  createRoom,
  endMove,
  GameError,
  legalSteps,
  neighbors4,
  roll,
  sanitizeForPlayer,
  startGame,
  step,
  takeCaveItem,
  updateSettings,
  applyItem,
} from "../lib/gameEngine";
import { ITEM_BY_ID } from "../lib/content";
import type { RoomState } from "../lib/types";

const games = Number(process.argv[2]) || 200;

function rand<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

let sharedEnds = 0;
let midMoveBridges = 0;

function check(room: RoomState) {
  const positions = room.players.map((p) => p.pos);
  // Passing through other pieces mid-move is allowed; only count resting overlaps.
  if (room.turn?.stage !== "move" && new Set(positions).size !== positions.length) sharedEnds++;
  for (const p of room.players) {
    const t = room.cells[p.pos].t;
    if (t === "mountain" || t === "river") throw new Error(`piece on ${t}`);
  }
  for (const c of room.cells) {
    if (c.o >= 0 && (c.t === "glacier" || c.t === "mountain" || c.t === "river")) throw new Error(`painted ${c.t}`);
  }
}

/** One random action for whoever's turn it is. */
function act(room: RoomState): RoomState {
  const turn = room.turn!;
  const player = room.players.find((p) => p.id === turn.playerId)!;
  if (turn.stage === "start") {
    const r = Math.random();
    if (!player.cave && player.items.length && r < 0.3) {
      const index = Math.floor(Math.random() * player.items.length);
      const def = ITEM_BY_ID[player.items[index]];
      let target: number | string | null = null;
      if (def.target === "enemy") target = rand(room.players.filter((p) => p.color !== player.color)).id;
      else if (def.target === "riverCell") target = rand(neighbors4(room.size, player.pos));
      else if (def.target === "ownCell") target = rand(room.cells.flatMap((c, i) => (c.o === player.color ? [i] : [])));
      else if (def.target === "cell") target = Math.floor(Math.random() * room.cells.length);
      try {
        return applyItem(room, player.id, index, target);
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
    }
    if (!player.cave && r < 0.35) {
      const river = neighbors4(room.size, player.pos).find((c) => room.cells[c].t === "river");
      if (river !== undefined) return buildBridge(room, player.id, river);
    }
    return roll(room, player.id);
  }
  if (turn.stage === "chooseDie") return chooseDie(room, player.id, Math.floor(Math.random() * turn.dice.length));
  if (turn.stage === "caveItem") {
    try {
      return takeCaveItem(room, player.id, 0);
    } catch {
      return takeCaveItem(room, player.id, -1);
    }
  }
  const river = neighbors4(room.size, player.pos).find((c) => room.cells[c].t === "river");
  if (river !== undefined && Math.random() < 0.15 && !room.players.some((p) => p.id !== player.id && p.pos === player.pos)) {
    midMoveBridges++;
    return buildBridge(room, player.id, river);
  }
  const options = legalSteps(room, player, turn);
  if (!options.length) return endMove(room, player.id, false);
  return step(room, player.id, rand(options));
}

let totalTurns = 0;
const reasons: Record<string, number> = {};
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const n = 2 + Math.floor(Math.random() * 7);
  let room = createRoom("p0", "P0");
  for (let i = 1; i < n; i++) room = addPlayer(room, `p${i}`, `P${i}`);
  const ffa = n <= 4 && Math.random() < 0.5;
  room = updateSettings(room, "p0", { mode: ffa ? "ffa" : "teams", targetScore: 10 });
  room = startGame(room, "p0");
  let actions = 0;
  while (room.phase === "playing") {
    room = act(room);
    check(room);
    sanitizeForPlayer(room, "p0");
    if (++actions > 20000) throw new Error("game did not end");
  }
  totalTurns += room.set;
  const key = `${room.settings.mode}/${room.winReason}`;
  reasons[key] = (reasons[key] ?? 0) + 1;
}
console.log(`${games} games OK in ${Date.now() - t0}ms, avg ${(totalTurns / games).toFixed(1)} sets, shared resting cells: ${sharedEnds}, mid-move bridges: ${midMoveBridges}`, reasons);
