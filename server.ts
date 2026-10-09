import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { botAct } from "./lib/bot";
import {
  addBot,
  addPlayer,
  backToLobby,
  buildBridge,
  chooseDie,
  chooseTeam,
  createRoom,
  discardItem,
  endMove,
  GameError,
  hostSkip,
  markConnection,
  playAgain,
  removeBot,
  removePlayer,
  roll,
  sanitizeForPlayer,
  startGame,
  step,
  takeCaveItem,
  updateSettings,
  applyItem,
} from "./lib/gameEngine";
import { getRoom, pruneStaleRooms, reserveUniqueCode, saveRoom } from "./lib/rooms";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  SocketResult,
} from "./lib/socketEvents";
import type { RoomState } from "./lib/types";
import { TEST_ROOM_BOTS } from "./lib/types";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOST || "0.0.0.0";
const LOBBY_DISCONNECT_GRACE_MS = Number(process.env.LOBBY_DISCONNECT_GRACE_MS) || 20_000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function ok<T>(data: T): SocketResult<T> {
  return { ok: true, data };
}
function fail<T>(error: string): SocketResult<T> {
  return { ok: false, error };
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

function broadcastRoom(io: IO, room: RoomState) {
  saveRoom(room);
  for (const player of room.players) {
    if (player.isBot) continue;
    io.to(playerRoomTag(room.code, player.id)).emit("room:update", sanitizeForPlayer(room, player.id));
  }
  scheduleBot(io, room.code);
}

// Bots in test rooms act on their own after a short pause, one action at a
// time, and only while a human is still connected to watch.
const botTimers = new Map<string, NodeJS.Timeout>();

function botToAct(room: RoomState | undefined) {
  if (!room || room.phase !== "playing" || !room.turn) return undefined;
  if (!room.players.some((p) => !p.isBot && p.connected)) return undefined;
  const actor = room.players.find((p) => p.id === room.turn!.playerId);
  return actor?.isBot ? actor : undefined;
}

function scheduleBot(io: IO, code: string) {
  if (botTimers.has(code)) return;
  const room = getRoom(code);
  const bot = botToAct(room);
  if (!room || !bot) return;
  const delay = room.turn!.stage === "move" ? 300 : 900;
  botTimers.set(
    code,
    setTimeout(() => {
      botTimers.delete(code);
      const latest = getRoom(code);
      if (botToAct(latest)?.id !== bot.id) return scheduleBot(io, code);
      try {
        broadcastRoom(io, botAct(latest!, bot.id));
      } catch (e) {
        console.error(`bot ${bot.name} in ${code}:`, e);
        // Don't let a confused bot stall the game: try ending its move/turn.
        try {
          broadcastRoom(io, endMove(latest!, bot.id, false));
        } catch {
          // leave it; a human action will reschedule
        }
      }
    }, delay)
  );
}

function roomTag(code: string) {
  return `room:${code}`;
}
function playerRoomTag(code: string, playerId: string) {
  return `room:${code}:player:${playerId}`;
}

app.prepare().then(() => {
  const httpServer = createServer(handle);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(httpServer, {
    cors: { origin: "*" },
    // Room updates carry the whole board (thousands of cells of very repetitive
    // JSON), which compresses to a small fraction.
    perMessageDeflate: { threshold: 1024 },
  });

  setInterval(pruneStaleRooms, 30 * 60 * 1000).unref();

  io.on("connection", (socket) => {
    socket.on("room:create", ({ name }, cb) => {
      try {
        const trimmed = (name ?? "").trim().slice(0, 24) || "プレイヤー";
        const room = reserveUniqueCode(() => createRoom(socket.id, trimmed));
        socket.data.playerId = socket.id;
        socket.data.roomCode = room.code;
        socket.join(roomTag(room.code));
        socket.join(playerRoomTag(room.code, socket.id));
        saveRoom(room);
        cb(ok({ room: sanitizeForPlayer(room, socket.id), playerId: socket.id }));
      } catch (e) {
        cb(fail(e instanceof Error ? e.message : "不明なエラー"));
      }
    });

    socket.on("room:createTest", ({ name }, cb) => {
      try {
        const trimmed = (name ?? "").trim().slice(0, 24) || "プレイヤー";
        let room = reserveUniqueCode(() => createRoom(socket.id, trimmed, true));
        for (let i = 0; i < TEST_ROOM_BOTS; i++) room = addBot(room, socket.id);
        socket.data.playerId = socket.id;
        socket.data.roomCode = room.code;
        socket.join(roomTag(room.code));
        socket.join(playerRoomTag(room.code, socket.id));
        saveRoom(room);
        cb(ok({ room: sanitizeForPlayer(room, socket.id), playerId: socket.id }));
      } catch (e) {
        cb(fail(e instanceof Error ? e.message : "不明なエラー"));
      }
    });

    socket.on("room:join", ({ code, name }, cb) => {
      try {
        const trimmed = (name ?? "").trim().slice(0, 24) || "プレイヤー";
        const room = getRoom(code);
        if (!room) throw new GameError("部屋が見つかりません");
        const updated = addPlayer(room, socket.id, trimmed);
        socket.data.playerId = socket.id;
        socket.data.roomCode = updated.code;
        socket.join(roomTag(updated.code));
        socket.join(playerRoomTag(updated.code, socket.id));
        broadcastRoom(io, updated);
        cb(ok({ room: sanitizeForPlayer(updated, socket.id), playerId: socket.id }));
      } catch (e) {
        cb(fail(e instanceof Error ? e.message : "不明なエラー"));
      }
    });

    socket.on("room:rejoin", ({ code, playerId }, cb) => {
      try {
        const room = getRoom(code);
        if (!room) throw new GameError("部屋が見つかりません");
        if (!room.players.some((p) => p.id === playerId)) {
          throw new GameError("このプレイヤーは部屋にいません");
        }
        const updated = markConnection(room, playerId, true);
        socket.data.playerId = playerId;
        socket.data.roomCode = updated.code;
        socket.join(roomTag(updated.code));
        socket.join(playerRoomTag(updated.code, playerId));
        broadcastRoom(io, updated);
        cb(ok({ room: sanitizeForPlayer(updated, playerId) }));
      } catch (e) {
        cb(fail(e instanceof Error ? e.message : "不明なエラー"));
      }
    });

    function withRoom(
      code: string,
      mutate: (room: RoomState) => RoomState,
      cb: (res: SocketResult<null>) => void
    ) {
      try {
        const room = getRoom(code);
        if (!room) throw new GameError("部屋が見つかりません");
        const updated = mutate(room);
        broadcastRoom(io, updated);
        cb(ok(null));
      } catch (e) {
        cb(fail(e instanceof Error ? e.message : "不明なエラー"));
      }
    }

    socket.on("room:start", ({ code }, cb) => {
      withRoom(code, (room) => startGame(room, socket.data.playerId ?? socket.id), cb);
    });

    socket.on("room:settings", ({ code, settings }, cb) => {
      withRoom(code, (room) => updateSettings(room, socket.data.playerId ?? socket.id, settings), cb);
    });

    socket.on("room:team", ({ code, color, targetId }, cb) => {
      withRoom(code, (room) => chooseTeam(room, socket.data.playerId ?? socket.id, color, targetId), cb);
    });

    socket.on("room:addBot", ({ code, color }, cb) => {
      withRoom(code, (room) => addBot(room, socket.data.playerId ?? socket.id, color), cb);
    });

    socket.on("room:removeBot", ({ code, botId }, cb) => {
      withRoom(code, (room) => removeBot(room, socket.data.playerId ?? socket.id, botId), cb);
    });

    socket.on("game:roll", ({ code }, cb) => {
      withRoom(code, (room) => roll(room, socket.data.playerId ?? socket.id), cb);
    });

    socket.on("game:chooseDie", ({ code, index }, cb) => {
      withRoom(code, (room) => chooseDie(room, socket.data.playerId ?? socket.id, index), cb);
    });

    socket.on("game:step", ({ code, cell }, cb) => {
      withRoom(code, (room) => step(room, socket.data.playerId ?? socket.id, cell), cb);
    });

    socket.on("game:endMove", ({ code, enterCave }, cb) => {
      withRoom(code, (room) => endMove(room, socket.data.playerId ?? socket.id, !!enterCave), cb);
    });

    socket.on("game:caveItem", ({ code, index }, cb) => {
      withRoom(code, (room) => takeCaveItem(room, socket.data.playerId ?? socket.id, index), cb);
    });

    socket.on("game:discardItem", ({ code, index }, cb) => {
      withRoom(code, (room) => discardItem(room, socket.data.playerId ?? socket.id, index), cb);
    });

    socket.on("game:bridge", ({ code, cell }, cb) => {
      withRoom(code, (room) => buildBridge(room, socket.data.playerId ?? socket.id, cell), cb);
    });

    socket.on("game:useItem", ({ code, index, target }, cb) => {
      withRoom(code, (room) => applyItem(room, socket.data.playerId ?? socket.id, index, target ?? null), cb);
    });

    socket.on("game:backToLobby", ({ code }, cb) => {
      withRoom(code, (room) => backToLobby(room, socket.data.playerId ?? socket.id), cb);
    });

    socket.on("game:hostSkip", ({ code }, cb) => {
      withRoom(code, (room) => hostSkip(room, socket.data.playerId ?? socket.id), cb);
    });

    socket.on("game:playAgain", ({ code }, cb) => {
      withRoom(code, (room) => playAgain(room, socket.data.playerId ?? socket.id), cb);
    });

    socket.on("disconnect", () => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      const room = getRoom(roomCode);
      if (!room) return;

      // A reconnecting browser opens its new socket (and rejoins) before the
      // server notices the old one is gone. Only mark the player offline if
      // no other socket is still attached to them.
      const stillConnected = (io.sockets.adapter.rooms.get(playerRoomTag(roomCode, playerId))?.size ?? 0) > 0;
      if (stillConnected) return;

      const updated = markConnection(room, playerId, false);
      broadcastRoom(io, updated);

      if (room.phase === "lobby") {
        // Mobile browsers routinely drop the socket for a few seconds when a
        // tab is backgrounded (e.g. switching apps to share the room code).
        // Give reconnects a grace period before actually dropping the seat,
        // instead of removing them immediately and possibly losing the host.
        setTimeout(() => {
          const latest = getRoom(roomCode);
          if (!latest || latest.phase !== "lobby") return;
          const player = latest.players.find((p) => p.id === playerId);
          if (!player || player.connected) return;
          broadcastRoom(io, removePlayer(latest, playerId));
        }, LOBBY_DISCONNECT_GRACE_MS);
      }
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Zenhoui Sugoroku ready on http://${hostname}:${port}`);
  });
});
