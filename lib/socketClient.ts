"use client";

import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./socketEvents";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export interface StoredIdentity {
  playerId: string;
  name: string;
}

const storageKey = (code: string) => `zenhoui:player:${code.toUpperCase()}`;

export function loadIdentity(code: string): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(storageKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredIdentity;
  } catch {
    return null;
  }
}

export function saveIdentity(code: string, identity: StoredIdentity): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(storageKey(code), JSON.stringify(identity));
}

export function clearIdentity(code: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(storageKey(code));
}
