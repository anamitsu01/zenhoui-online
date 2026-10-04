"use client";

import { useState } from "react";
import { colorHex, withAlpha } from "@/lib/colors";
import type { Player, RoomSettings, RoomState } from "@/lib/types";
import { autoBoardSize, BOARD_SIZE_CHOICES, COLOR_NAMES_TEAMS, MAX_FFA_PLAYERS, MAX_PLAYERS, MIN_PLAYERS } from "@/lib/types";
import RulesPanel from "./RulesPanel";

export default function Lobby({
  room,
  viewerId,
  onStart,
  onSettings,
  onTeam,
  onAddBot,
  onRemoveBot,
}: {
  room: RoomState;
  viewerId: string;
  onStart: () => Promise<string | null>;
  onSettings: (settings: Partial<RoomSettings>) => Promise<string | null>;
  onTeam: (color: number, targetId?: string) => Promise<string | null>;
  onAddBot: (color?: number) => Promise<string | null>;
  onRemoveBot: (botId: string) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const me = room.players.find((p) => p.id === viewerId);
  const isHost = !!me?.isHost;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";
  const { settings } = room;
  const teams = settings.mode === "teams";
  const count = room.players.length;

  const startBlocker =
    count < MIN_PLAYERS
      ? `開始には${MIN_PLAYERS}人以上必要です(現在${count}人)`
      : teams && (!room.players.some((p) => p.color === 0) || !room.players.some((p) => p.color === 1))
        ? "青チームと赤チームに1人以上ずつ必要です"
        : !teams && count > MAX_FFA_PLAYERS
          ? `個人戦は${MAX_FFA_PLAYERS}人までです`
          : null;

  async function handleStart() {
    setStarting(true);
    const err = await onStart();
    setStarting(false);
    setError(err);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // clipboard unavailable; user can copy manually
    }
  }

  const change = async (s: Partial<RoomSettings>) => setError(await onSettings(s));
  const botControls = room.isTest && isHost;
  const canAddBot = count < MAX_PLAYERS && (teams || count < MAX_FFA_PLAYERS);
  const botActions = (p: Player) =>
    botControls && p.isBot ? (
      <span className="flex shrink-0 gap-1">
        {teams && (
          <button
            onClick={async () => setError(await onTeam(1 - p.color, p.id))}
            className="rounded border border-white/15 px-1.5 text-xs text-white/60 hover:bg-white/10"
            title="もう一方のチームへ移す"
          >
            ⇄
          </button>
        )}
        <button
          onClick={async () => setError(await onRemoveBot(p.id))}
          className="rounded border border-white/15 px-1.5 text-xs text-white/60 hover:bg-white/10"
          title="ボットを外す"
        >
          ×
        </button>
      </span>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-xl text-center">
      <p className="mb-1 text-white/60">部屋コード</p>
      <div className="mb-4 flex items-center justify-center gap-3">
        <span className="text-5xl font-black tracking-[0.3em] text-lamp">{room.code}</span>
      </div>
      <div className="mb-6 flex items-center justify-center gap-2">
        <input
          readOnly
          value={shareUrl}
          className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
        />
        <button onClick={copyLink} className="whitespace-nowrap rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
          リンクをコピー
        </button>
      </div>

      {room.isTest && (
        <p className="mb-4 rounded-lg border border-lamp/40 bg-lamp/10 px-4 py-2 text-sm text-lamp-light">
          🤖 テスト部屋: ボットが自動で相手をします。{isHost && "ボットの追加・削除・チーム移動ができます。"}
        </p>
      )}

      <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
        {(["teams", "ffa"] as const).map((m) => (
          <button
            key={m}
            disabled={!isHost}
            onClick={() => change({ mode: m })}
            className={`rounded-full px-5 py-1.5 font-semibold ${
              settings.mode === m ? "bg-lamp text-black" : "text-white/60 enabled:hover:text-white"
            }`}
          >
            {m === "teams" ? "チーム戦(青 vs 赤)" : "個人戦"}
          </button>
        ))}
      </div>

      {teams ? (
        <div className="mb-6 grid grid-cols-2 gap-3 text-left">
          {[0, 1].map((c) => {
            const members = room.players.filter((p) => p.color === c);
            const hex = colorHex("teams", c);
            return (
              <div key={c} className="rounded-xl border p-3" style={{ borderColor: withAlpha(hex, 0.5), background: withAlpha(hex, 0.08) }}>
                <p className="mb-2 font-bold" style={{ color: hex }}>
                  {COLOR_NAMES_TEAMS[c]}チーム({members.length})
                </p>
                <ul className="mb-2 space-y-1.5">
                  {members.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <PlayerRow player={p} viewerId={viewerId} />
                      {botActions(p)}
                    </li>
                  ))}
                </ul>
                {botControls && canAddBot && (
                  <button
                    onClick={async () => setError(await onAddBot(c))}
                    className="mb-2 w-full rounded-lg border border-dashed border-white/15 py-1.5 text-sm text-white/60 hover:bg-white/10"
                  >
                    + ボットを追加
                  </button>
                )}
                {me && me.color !== c && (
                  <button
                    onClick={async () => setError(await onTeam(c))}
                    className="w-full rounded-lg border border-white/15 py-1.5 text-sm text-white/70 hover:bg-white/10"
                  >
                    {COLOR_NAMES_TEAMS[c]}に入る
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="mb-6 space-y-2 text-left">
          {room.players.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <span className="h-3 w-3 rounded-full" style={{ background: colorHex("ffa", i) }} />
              <PlayerRow player={p} viewerId={viewerId} />
              {botActions(p)}
            </li>
          ))}
          {botControls && canAddBot && (
            <li>
              <button
                onClick={async () => setError(await onAddBot())}
                className="w-full rounded-lg border border-dashed border-white/15 py-2 text-sm text-white/60 hover:bg-white/10"
              >
                + ボットを追加
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left text-sm sm:grid-cols-4">
        <NumberSetting label="目標点" value={settings.targetScore} disabled={!isHost} min={3} max={100} onChange={(v) => change({ targetScore: v })} />
        <NumberSetting label="制圧(%)" value={settings.conquestPct} disabled={!isHost} min={50} max={100} step={5} onChange={(v) => change({ conquestPct: v })} />
        <NumberSetting label="洞窟の脱出値" value={settings.caveThreshold} disabled={!isHost} min={3} max={60} onChange={(v) => change({ caveThreshold: v })} />
        <NumberSetting label="フラッグ勝利(0=なし)" value={settings.flagWin} disabled={!isHost} min={0} max={9} onChange={(v) => change({ flagWin: v })} />
        <label className="flex flex-col gap-1">
          <span className="text-white/50">盤面</span>
          <select
            value={settings.boardSize}
            disabled={!isHost}
            onChange={(e) => change({ boardSize: Number(e.target.value) })}
            className="rounded-lg border border-white/10 bg-panel px-2 py-1.5"
          >
            <option value={0}>自動({autoBoardSize(count)}×{autoBoardSize(count)})</option>
            {BOARD_SIZE_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s}×{s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {startBlocker && <p className="mb-4 text-sm text-white/50">{startBlocker}</p>}

      {isHost ? (
        <button
          onClick={handleStart}
          disabled={starting || !!startBlocker}
          className="rounded-full bg-lamp px-8 py-3 font-bold text-black hover:bg-lamp-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          {starting ? "開始中..." : "冒険を始める"}
        </button>
      ) : (
        <p className="text-white/60">ホストの開始を待っています…</p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-2 text-xs text-white/35">最大{MAX_PLAYERS}人</p>

      <div className="mt-10 text-left">
        <RulesPanel defaultOpen />
      </div>
    </div>
  );
}

function PlayerRow({ player, viewerId }: { player: Player; viewerId: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <span className={`truncate ${player.connected ? "" : "opacity-40"}`}>
        {player.name}
        {player.isBot && " 🤖"}
        {player.isHost && <span className="ml-1 text-xs text-white/40">(ホスト)</span>}
      </span>
      {player.id === viewerId && <span className="shrink-0 text-xs text-white/40">(あなた)</span>}
    </span>
  );
}

function NumberSetting({
  label,
  value,
  disabled,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-white/50">{label}</span>
      <span className="flex items-center gap-1">
        <button
          disabled={disabled || value <= min}
          onClick={() => onChange(value - step)}
          className="h-8 w-8 rounded-lg border border-white/10 enabled:hover:bg-white/10 disabled:opacity-30"
        >
          −
        </button>
        <span className="w-10 text-center text-base font-bold">{value}</span>
        <button
          disabled={disabled || value >= max}
          onClick={() => onChange(value + step)}
          className="h-8 w-8 rounded-lg border border-white/10 enabled:hover:bg-white/10 disabled:opacity-30"
        >
          +
        </button>
      </span>
    </label>
  );
}
