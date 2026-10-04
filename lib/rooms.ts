import { RoomState } from "./types";

// Single-process in-memory room store. Fine for an MVP running on one
// Node instance; would need a shared store (e.g. Redis) to scale to
// multiple server processes.
const rooms = new Map<string, RoomState>();

export function getRoom(code: string): RoomState | undefined {
  return rooms.get(code.toUpperCase());
}

export function saveRoom(room: RoomState): void {
  rooms.set(room.code, room);
}

export function deleteRoom(code: string): void {
  rooms.delete(code.toUpperCase());
}

export function roomExists(code: string): boolean {
  return rooms.has(code.toUpperCase());
}

// Ensure a freshly created room doesn't collide with an existing code.
export function reserveUniqueCode(makeRoom: () => RoomState): RoomState {
  let room = makeRoom();
  while (rooms.has(room.code)) {
    room = makeRoom();
  }
  rooms.set(room.code, room);
  return room;
}

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours of inactivity

export function pruneStaleRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}
