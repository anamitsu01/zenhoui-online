"use client";

import { useEffect, useRef, useState } from "react";
import { colorHex } from "@/lib/colors";
import { buzz, installAudioUnlock, isMuted, play, setMuted } from "@/lib/sound";
import type { PublicEvent, RoomState } from "@/lib/types";
import CaveIcon from "./CaveIcon";

/** Captures at least this big get a cut-in and shake the board. */
export const BIG_CAPTURE = 12;

/** Bumps whenever something should shake the board (bombs, big captures). */
export function shakeCount(room: RoomState): number {
  return room.log.filter((e) => (e.type === "item" && e.item === "bomb") || (e.type === "enclose" && e.count >= BIG_CAPTURE)).length;
}

// ---------------------------------------------------------------------------
// Sounds & haptics, driven by what changed since the last update.

export function SoundDirector({ room, viewerId }: { room: RoomState; viewerId: string }) {
  useEffect(() => installAudioUnlock(), []);

  const prev = useRef<{ log: number; mover: string; steps: number; turn: string } | null>(null);
  useEffect(() => {
    const turn = room.turn;
    const now = {
      log: room.log.length,
      mover: turn?.playerId ?? "",
      steps: turn?.path.length ?? 0,
      turn: turn ? `${room.set}-${room.turnIndex}` : "",
    };
    const before = prev.current;
    prev.current = now;
    if (!before) return; // first render: don't replay history

    const mine = turn?.playerId === viewerId;
    const vol = mine ? 1 : 0.55;

    // A step: footfall (+ a splat, + a buzz on my phone).
    if (turn && now.mover === before.mover && now.steps > before.steps) {
      play("step", { volume: vol });
      play("paint", { volume: vol * 0.8 });
      if (mine) buzz(10);
    }

    const fresh: PublicEvent[] = now.log >= before.log ? room.log.slice(before.log) : room.log;
    for (const e of fresh) {
      switch (e.type) {
        case "roll":
          if (e.dice.length) play("dice", { volume: e.playerId === viewerId ? 1 : 0.5 });
          break;
        case "caveRoll":
          play("dice", { volume: 0.5 });
          break;
        case "enclose":
          play("enclose", { volume: e.count >= BIG_CAPTURE ? 1 : 0.7 });
          if (e.playerId === viewerId) buzz(e.count >= BIG_CAPTURE ? 60 : 25);
          break;
        case "flagReach":
        case "flagFound":
          play("flag");
          break;
        case "chest":
          play("chest", { volume: e.playerId === viewerId ? 1 : 0.5 });
          break;
        case "ruins":
          // The finder hears it from the popup (timed with the reveal).
          if (e.playerId !== viewerId) play("ruins", { volume: 0.5 });
          break;
        case "item":
          play(e.item === "bomb" ? "bomb" : "item");
          if (e.item === "bomb") buzz(80);
          break;
        case "caveEnter":
        case "caveExit":
          play("cave");
          break;
        case "bridge":
          play("bridge");
          break;
        case "score":
          play("setEnd");
          break;
        case "win":
          play("win");
          break;
      }
    }

    if (turn && mine && now.turn !== before.turn && turn.stage === "start") {
      play("myTurn");
      buzz(30);
    }
  }, [room, viewerId]);

  return null;
}

export function MuteToggle() {
  const [muted, setState] = useState(isMuted);
  return (
    <button
      onClick={() => {
        setMuted(!muted);
        setState(!muted);
        if (muted) play("myTurn");
      }}
      className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:bg-white/10"
      title={muted ? "効果音・振動をオンにする" : "効果音・振動をオフにする"}
    >
      {muted ? "🔇 音オフ" : "🔊 音オン"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cut-ins for the big moments. They sweep across the top of the screen and
// never block clicks, so play goes on underneath.

type CutIn = { key: number; title: string; sub: string; color: string; icon: React.ReactNode };

const CUTIN_MS = 1500;

function cutInFor(room: RoomState, e: PublicEvent, key: number, viewerId: string): CutIn | null {
  const p = "playerId" in e ? room.players.find((pl) => pl.id === e.playerId) : undefined;
  const who = p ? (p.id === viewerId ? "あなた" : p.name) : "";
  const color = p ? colorHex(room.settings.mode, p.color) : "#f0b43c";
  if (e.type === "flagReach") {
    const team = room.settings.mode === "teams" ? (e.color === 0 ? "青チーム" : "赤チーム") : room.players.find((pl) => pl.color === e.color)?.name ?? "";
    return { key, title: "リーチ!", sub: `${team}がフラッグ${e.held}本 — あと1本で勝利`, color: colorHex(room.settings.mode, e.color), icon: "🚩" };
  }
  if (e.type === "flagFound") return { key, title: "フラッグ発見!", sub: `${who}が見つけた — 全員に位置が公開`, color, icon: "🚩" };
  if (e.type === "enclose" && e.count >= BIG_CAPTURE) return { key, title: `${e.count}マス 包囲!`, sub: `${who}が大きく囲った`, color, icon: "🌀" };
  if (e.type === "caveExit") return { key, title: "洞窟から脱出!", sub: `${who}がお宝を持ち帰った`, color, icon: <CaveIcon /> };
  if (e.type === "item" && e.item === "bomb") return { key, title: "ドカン!", sub: `${who}が爆弾を使った`, color, icon: "💣" };
  return null;
}

export function EventCutIns({ room, viewerId }: { room: RoomState; viewerId: string }) {
  // Events already in the log when this mounts (page load, rejoin) are not replayed.
  const [seen, setSeen] = useState(() => room.log.length);
  const from = seen > room.log.length ? 0 : seen; // a rematch starts a fresh log
  let current: CutIn | null = null;
  let index = -1;
  for (let i = from; i < room.log.length; i++) {
    current = cutInFor(room, room.log[i], i, viewerId);
    if (current) {
      index = i;
      break;
    }
  }

  useEffect(() => {
    if (index < 0) return;
    const t = setTimeout(() => setSeen(index + 1), CUTIN_MS);
    return () => clearTimeout(t);
  }, [index]);

  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-40 overflow-hidden" role="status" aria-live="polite">
      <div key={current.key} className="zh-cutin relative left-[-10%] w-[120%] py-3 shadow-2xl" style={{ background: current.color }}>
        <div className="zh-cutin-text flex items-center justify-center gap-3 px-6">
          <span className="text-4xl drop-shadow">{current.icon}</span>
          <div className="text-center">
            <p className="text-3xl font-black tracking-wider text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.5)] sm:text-4xl">{current.title}</p>
            <p className="text-sm font-bold text-white/90">{current.sub}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
