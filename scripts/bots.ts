// Joins bot players to a room and has them play randomly — for testing alone.
// Run: npx tsx scripts/bots.ts <ROOMCODE> [count] [url]
import { io, Socket } from "socket.io-client";
import { ITEM_BY_ID } from "../lib/content";
import { legalSteps, neighbors4 } from "../lib/gameEngine";
import type { ClientToServerEvents, ServerToClientEvents } from "../lib/socketEvents";
import type { RoomState } from "../lib/types";

const [code, countArg, url = "http://localhost:3000"] = process.argv.slice(2);
if (!code) {
  console.error("usage: npx tsx scripts/bots.ts <ROOMCODE> [count] [url]");
  process.exit(1);
}
const count = Number(countArg) || 1;

function rand<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function startBot(i: number) {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, { transports: ["websocket"] });
  let me = "";
  let pending = false;
  let latest: RoomState | null = null;
  const name = `ボット${i + 1}`;
  const done = (res: { ok: boolean; error?: string }) => {
    pending = false;
    if (!res.ok) console.log(`${name}: ${res.error}`);
    if (latest) onRoom(latest);
  };

  function act(fn: () => void) {
    if (pending) return;
    pending = true;
    setTimeout(fn, 250 + Math.random() * 350);
  }

  function onRoom(room: RoomState) {
    latest = room;
    const turn = room.turn;
    if (room.phase !== "playing" || !turn || turn.playerId !== me || pending) return;
    const self = room.players.find((p) => p.id === me)!;

    if (turn.stage === "start") {
      const river = neighbors4(room.size, self.pos).find((c) => room.cells[c].t === "river");
      const useable = self.items.findIndex((it) => ITEM_BY_ID[it].target === "none");
      if (!self.cave && useable >= 0 && Math.random() < 0.5) {
        act(() => socket.emit("game:useItem", { code, index: useable, target: null }, done));
      } else if (!self.cave && river !== undefined && Math.random() < 0.3) {
        act(() => socket.emit("game:bridge", { code, cell: river }, done));
      } else {
        act(() => socket.emit("game:roll", { code }, done));
      }
    } else if (turn.stage === "chooseDie") {
      act(() => socket.emit("game:chooseDie", { code, index: turn.dice[0] >= turn.dice[1] ? 0 : 1 }, done));
    } else if (turn.stage === "caveItem") {
      act(() => socket.emit("game:caveItem", { code, index: self.items.length < 3 ? 0 : -1 }, done));
    } else if (turn.stage === "move") {
      const options = legalSteps(room, self, turn);
      // Prefer unpainted / enemy cells so bots spread out a bit.
      const fresh = options.filter((c) => room.cells[c].o !== self.color);
      if (!options.length) act(() => socket.emit("game:endMove", { code, enterCave: false }, done));
      else act(() => socket.emit("game:step", { code, cell: rand(fresh.length && Math.random() < 0.8 ? fresh : options) }, done));
    }
  }

  socket.on("room:update", onRoom);
  socket.on("connect", () => {
    socket.emit("room:join", { code, name }, (res) => {
      if (!res.ok) {
        console.log(`${name}: join failed: ${res.error}`);
        return;
      }
      me = res.data.playerId;
      console.log(`${name} joined as ${me}`);
    });
  });
}

for (let i = 0; i < count; i++) startBot(i);
