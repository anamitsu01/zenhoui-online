"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ITEM_BY_ID, RUINS_EFFECTS } from "@/lib/content";
import { colorHex, withAlpha } from "@/lib/colors";
import { legalSteps, neighbors4 } from "@/lib/gameEngine";
import type { ClientToServerEvents } from "@/lib/socketEvents";
import type { ItemKind, Player, PublicEvent, RoomState, TurnState } from "@/lib/types";
import { colorName, MAX_ITEMS } from "@/lib/types";
import CaveIcon from "./CaveIcon";
import MapGrid, { type HighlightKind } from "./MapGrid";

export type Act = <E extends keyof ClientToServerEvents>(
  event: E,
  payload: Omit<Parameters<ClientToServerEvents[E]>[0], "code">
) => Promise<string | null>;

/** What a click on the map currently means (besides stepping). */
type Targeting = { kind: "item"; index: number } | { kind: "bridge" } | null;

export default function GameBoard({ room, viewerId, act }: { room: RoomState; viewerId: string; act: Act }) {
  const me = room.players.find((p) => p.id === viewerId)!;
  const turn = room.turn;
  const actor = turn ? room.players.find((p) => p.id === turn.playerId) : undefined;
  const myTurn = !!turn && turn.playerId === me.id;
  const [busy, setBusy] = useState(false);
  const [targeting, setTargeting] = useState<Targeting>(null);
  // Errors are tied to the turn state they happened in, so they vanish once the game moves on.
  const turnKey = `${room.set}-${room.turnIndex}-${turn?.stage}-${turn?.path.length}`;
  const [errorState, setErrorState] = useState<{ key: string; message: string | null }>({ key: "", message: null });
  const error = errorState.key === turnKey ? errorState.message : null;
  const activeTargeting = myTurn && turn?.stage === "start" ? targeting : null;
  // Re-center the map on my piece when my turn starts, or when asked.
  const [recenter, setRecenter] = useState(0);
  const recenterKey = recenter * 100000 + (myTurn ? room.set * 100 + room.turnIndex : 0);

  const run = useCallback(
    async (p: Promise<string | null>) => {
      setBusy(true);
      const err = await p;
      setBusy(false);
      setErrorState({ key: turnKey, message: err });
    },
    [turnKey]
  );

  const steps = useMemo(
    () => (myTurn && turn?.stage === "move" ? legalSteps(room, me, turn) : []),
    [room, me, turn, myTurn]
  );

  const highlights = useMemo(() => {
    const map = new Map<number, HighlightKind>();
    if (activeTargeting?.kind === "bridge") {
      for (const c of neighbors4(room.size, me.pos)) if (room.cells[c].t === "river") map.set(c, "target");
    } else if (activeTargeting?.kind === "item") {
      const def = ITEM_BY_ID[me.items[activeTargeting.index]];
      if (def?.target === "cell") room.cells.forEach((_, i) => map.set(i, "any"));
      if (def?.target === "ownCell") {
        room.cells.forEach((c, i) => {
          if (c.o === me.color && !(def.id === "warp" && room.players.some((p) => p.pos === i && p.id !== me.id))) map.set(i, "target");
        });
      }
      if (def?.target === "riverCell") {
        for (const c of neighbors4(room.size, me.pos)) if (room.cells[c].t === "river") map.set(c, "target");
      }
    } else {
      for (const c of steps) map.set(c, "step");
    }
    return map;
  }, [activeTargeting, steps, room, me]);

  const onCellClick = useCallback(
    (cell: number) => {
      if (busy) return;
      if (activeTargeting?.kind === "bridge") {
        setTargeting(null);
        run(act("game:bridge", { cell }));
      } else if (activeTargeting?.kind === "item") {
        setTargeting(null);
        run(act("game:useItem", { index: activeTargeting.index, target: cell }));
      } else if (steps.includes(cell)) {
        run(act("game:step", { cell }));
      }
    },
    [busy, activeTargeting, steps, run, act]
  );

  // Arrow keys / WASD walk the piece.
  useEffect(() => {
    if (!myTurn || turn?.stage !== "move") return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const d: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        w: [0, -1],
        s: [0, 1],
        a: [-1, 0],
        d: [1, 0],
      };
      const dir = d[e.key];
      if (!dir) return;
      e.preventDefault();
      const x = (me.pos % room.size) + dir[0];
      const y = Math.floor(me.pos / room.size) + dir[1];
      if (x < 0 || y < 0 || x >= room.size || y >= room.size) return;
      onCellClick(y * room.size + x);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, turn?.stage, me.pos, room.size, onCellClick]);

  const stuckActor = actor && !actor.connected && actor.id !== me.id ? actor : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="flex min-w-0 flex-col gap-3">
        <ScoreStrip room={room} />
        <section className="rounded-2xl border border-white/10 bg-panel/90 p-3 sm:p-4">
          {room.phase === "gameover" ? (
            <GameOverPanel room={room} me={me} busy={busy} run={run} act={act} />
          ) : (
            <ActionPanel
              room={room}
              me={me}
              actor={actor}
              turn={turn!}
              busy={busy}
              targeting={activeTargeting}
              setTargeting={setTargeting}
              canStep={steps.length > 0}
              run={run}
              act={act}
            />
          )}
          {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
          {me.isHost && stuckActor && room.phase === "playing" && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-center text-sm text-white/60">
              {stuckActor.name} が切断中です。
              <button
                disabled={busy}
                onClick={() => run(act("game:hostSkip", {}))}
                className="ml-2 rounded-full border border-white/20 px-3 py-1 text-white hover:bg-white/10 disabled:opacity-40"
              >
                手番を飛ばす
              </button>
            </div>
          )}
        </section>
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-white/45">
          <span>
            {room.size}×{room.size}マス
            <span className="ml-2 inline-block h-2 w-4 rounded-sm align-middle" style={{ background: "#2dd4bf" }} /> 盤面の端
          </span>
          {me.pos >= 0 && room.phase === "playing" && (
            <button
              onClick={() => setRecenter((n) => n + 1)}
              className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:bg-white/10"
            >
              📍 自分のコマへ
            </button>
          )}
        </div>
        <MapGrid
          focusCell={me.pos}
          recenterKey={recenterKey}
          size={room.size}
          cells={room.cells}
          mode={room.settings.mode}
          players={room.players}
          actorId={turn?.playerId ?? null}
          path={turn?.path ?? []}
          locked={room.locked}
          highlights={highlights}
          onCellClick={onCellClick}
        />
        <Legend />
      </main>

      <aside className="flex flex-col gap-4">
        <PlayerList room={room} me={me} actorId={turn?.playerId} />
        <EventLog room={room} />
      </aside>

      <SetResultBanner room={room} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scores

function ScoreStrip({ room }: { room: RoomState }) {
  const { settings } = room;
  const need = Math.ceil((room.paintable * settings.conquestPct) / 100);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-panel/90 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-bold">
          第{room.set}セット
          <span className="ml-2 text-xs font-normal text-white/45">
            手番 {Math.min(room.turnIndex + 1, room.order.length)}/{room.order.length}
          </span>
        </span>
        <span className="text-xs text-white/45">
          目標 {settings.targetScore}点 ・ 制圧 {settings.conquestPct}%({need}マス)
        </span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${room.colorCount}, minmax(0, 1fr))` }}>
        {room.scores.map((score, c) => {
          const hex = colorHex(settings.mode, c);
          const count = room.counts[c] ?? 0;
          return (
            <div key={c} className="rounded-xl p-2" style={{ background: withAlpha(hex, 0.12), border: `1px solid ${withAlpha(hex, 0.45)}` }}>
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-sm font-bold" style={{ color: hex }}>
                  {teamLabel(room, c)}
                </span>
                <span className="text-xl font-black">
                  {score}
                  <span className="text-xs font-normal text-white/40">/{settings.targetScore}</span>
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (count / room.paintable) * 100)}%`, background: hex }} />
                <div className="absolute top-0 h-full w-px bg-white/60" style={{ left: `${settings.conquestPct}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-white/50">{count}マス</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function teamLabel(room: RoomState, color: number): string {
  if (room.settings.mode === "teams") return `${colorName("teams", color)}チーム`;
  const p = room.players.find((pl) => pl.color === color);
  return p ? p.name : colorName("ffa", color);
}

// ---------------------------------------------------------------------------
// The turn controls

function ActionPanel({
  room,
  me,
  actor,
  turn,
  busy,
  targeting,
  setTargeting,
  canStep,
  run,
  act,
}: {
  room: RoomState;
  me: Player;
  actor: Player | undefined;
  turn: TurnState;
  busy: boolean;
  targeting: Targeting;
  setTargeting: (t: Targeting) => void;
  canStep: boolean;
  run: (p: Promise<string | null>) => void;
  act: Act;
}) {
  const myTurn = turn.playerId === me.id;
  const actorName = actor ? <ColoredName room={room} player={actor} /> : "?";

  if (!myTurn) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 py-1 text-center">
        <p className="text-white/70">{actorName} の手番</p>
        {turn.dice.length > 0 && <DiceRow dice={turn.dice} />}
        <p className="text-sm text-white/50">
          {turn.stage === "start" && (actor?.cave ? "洞窟の中…" : "サイコロを振るのを待っています")}
          {turn.stage === "chooseDie" && "どちらの目を使うか選んでいます"}
          {turn.stage === "move" && `移動中(残り ${turn.remaining})`}
          {turn.stage === "caveItem" && "洞窟でアイテムを選んでいます"}
        </p>
      </div>
    );
  }

  const nearRiver = neighbors4(room.size, me.pos).some((c) => room.cells[c].t === "river");

  if (turn.stage === "start" && me.cave) {
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="font-bold text-lamp">あなたの手番 — 洞窟の中</p>
        <p className="text-sm text-white/60">
          振った目の合計 <b className="text-lg text-ink">{me.cave.total}</b> / {room.settings.caveThreshold} で脱出(超えた分だけ進める)
        </p>
        <PrimaryButton disabled={busy} onClick={() => run(act("game:roll", {}))}>
          🎲 サイコロを振る
        </PrimaryButton>
      </div>
    );
  }

  if (turn.stage === "start") {
    const itemIndex = targeting?.kind === "item" ? targeting.index : -1;
    const pendingItem = itemIndex >= 0 ? ITEM_BY_ID[me.items[itemIndex]] : null;
    return (
      <div className="flex flex-col items-center gap-3 py-1 text-center">
        <p className="font-bold text-lamp">あなたの手番</p>
        <ModChips mods={turn.mods} />
        {targeting ? (
          <div className="flex flex-col items-center gap-2">
            {targeting.kind === "bridge" && <p className="text-sm">橋を架ける川を選んでください(手番は終了します)</p>}
            {pendingItem?.target === "enemy" ? (
              <>
                <p className="text-sm">{pendingItem.icon} {pendingItem.name}: 対象を選んでください</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {room.players
                    .filter((p) => p.color !== me.color)
                    .map((p) => (
                      <button
                        key={p.id}
                        disabled={busy}
                        onClick={() => {
                          setTargeting(null);
                          run(act("game:useItem", { index: itemIndex, target: p.id }));
                        }}
                        className="rounded-full border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
                      >
                        <ColoredName room={room} player={p} />
                      </button>
                    ))}
                </div>
              </>
            ) : (
              pendingItem && (
                <p className="text-sm">
                  {pendingItem.icon} {pendingItem.name}: 盤面のマスを選んでください
                </p>
              )
            )}
            <SecondaryButton onClick={() => setTargeting(null)}>キャンセル</SecondaryButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <PrimaryButton disabled={busy} onClick={() => run(act("game:roll", {}))}>
              🎲 サイコロを振る
            </PrimaryButton>
            {nearRiver && (
              <SecondaryButton disabled={busy} onClick={() => setTargeting({ kind: "bridge" })}>
                🌉 橋を架ける(手番終了)
              </SecondaryButton>
            )}
          </div>
        )}
        {!targeting && me.items.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {me.items.map((it, i) => (
              <ItemButton
                key={i}
                item={it}
                disabled={busy}
                onClick={() => {
                  if (ITEM_BY_ID[it].target === "none") run(act("game:useItem", { index: i, target: null }));
                  else setTargeting({ kind: "item", index: i });
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (turn.stage === "chooseDie") {
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="font-bold text-lamp">二つの運命 — 使う目を選んでください</p>
        <div className="flex gap-3">
          {turn.dice.map((d, i) => (
            <button key={i} disabled={busy} onClick={() => run(act("game:chooseDie", { index: i }))} className="rounded-xl p-1 hover:bg-white/10">
              <Die value={d} size="lg" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (turn.stage === "caveItem") {
    const full = me.items.length >= MAX_ITEMS;
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="font-bold text-lamp">洞窟から脱出! アイテムを1つ選んでください</p>
        <div className="flex flex-wrap justify-center gap-2">
          {turn.caveChoices.map((it, i) => (
            <ItemButton key={i} item={it} disabled={busy || full} onClick={() => run(act("game:caveItem", { index: i }))} />
          ))}
        </div>
        {full && <p className="text-xs text-white/50">アイテムは{MAX_ITEMS}個までしか持てません</p>}
        <SecondaryButton disabled={busy} onClick={() => run(act("game:caveItem", { index: -1 }))}>
          受け取らない
        </SecondaryButton>
        {turn.remaining > 0 && <p className="text-xs text-white/50">このあと {turn.remaining} マス進めます</p>}
      </div>
    );
  }

  // move
  const onCave = room.cells[me.pos]?.f === "cave" && turn.path.length >= 2;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-1 text-center">
      {turn.dice.length > 0 && <DiceRow dice={turn.dice} />}
      <div>
        <p className="text-sm text-white/60">残り移動力</p>
        <p className="text-3xl font-black text-lamp">
          {turn.remaining}
          <span className="text-sm font-normal text-white/40"> / {turn.steps}</span>
        </p>
      </div>
      <ModChips mods={turn.mods} />
      <p className="w-full text-xs text-white/45 sm:w-auto">光っているマスをクリック(矢印キー・WASDでも移動)</p>
      {onCave && (
        <SecondaryButton disabled={busy} onClick={() => run(act("game:endMove", { enterCave: true }))}>
          <CaveIcon /> ここで洞窟に入る
        </SecondaryButton>
      )}
      {!canStep && (
        <SecondaryButton disabled={busy} onClick={() => run(act("game:endMove", { enterCave: false }))}>
          これ以上進めないので終了
        </SecondaryButton>
      )}
    </div>
  );
}

function ModChips({ mods }: { mods: TurnState["mods"] }) {
  const chips: string[] = [];
  if (mods.moveDelta) chips.push(`移動力${mods.moveDelta > 0 ? "+" : ""}${mods.moveDelta}`);
  if (mods.ignoreForest) chips.push("森の追加コスト無視");
  if (mods.noOverwrite) chips.push("相手の色を塗り替えられない");
  if (mods.roller) chips.push("左右も塗る");
  if (mods.doubleDice) chips.push("サイコロ2個");
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-full border border-lamp/40 bg-lamp/10 px-2 py-0.5 text-xs text-lamp-light">
          {c}
        </span>
      ))}
    </div>
  );
}

function ItemButton({ item, disabled, onClick }: { item: ItemKind; disabled?: boolean; onClick: () => void }) {
  const def = ITEM_BY_ID[item];
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={def.description}
      className="flex max-w-[14rem] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40"
    >
      <span className="text-2xl">{def.icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{def.name}</span>
        <span className="block text-[11px] leading-tight text-white/50">{def.description}</span>
      </span>
    </button>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Die({ value, size = "md" }: { value: number; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-16 w-16 p-2.5" : "h-11 w-11 p-1.5";
  return (
    <span className={`zh-roll grid grid-cols-3 grid-rows-3 rounded-xl bg-ink shadow-lg ${dim}`}>
      {Array.from({ length: 9 }, (_, k) => {
        const on = PIPS[value]?.some(([x, y]) => x === k % 3 && y === Math.floor(k / 3));
        return (
          <span key={k} className="flex items-center justify-center">
            {on && <span className={`rounded-full ${value === 1 ? "h-[70%] w-[70%] bg-red-600" : "h-[62%] w-[62%] bg-black"}`} />}
          </span>
        );
      })}
    </span>
  );
}

function DiceRow({ dice }: { dice: number[] }) {
  return (
    <span className="flex gap-2">
      {dice.map((d, i) => (
        <Die key={`${i}-${d}-${dice.join()}`} value={d} />
      ))}
    </span>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-full bg-lamp px-7 py-3 font-bold text-black hover:bg-lamp-light disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-white/20 px-5 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ColoredName({ room, player }: { room: RoomState; player: Player }) {
  return (
    <span className="font-bold" style={{ color: colorHex(room.settings.mode, player.color) }}>
      {player.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Game over

function GameOverPanel({
  room,
  me,
  busy,
  run,
  act,
}: {
  room: RoomState;
  me: Player;
  busy: boolean;
  run: (p: Promise<string | null>) => void;
  act: Act;
}) {
  const winner = room.winner ?? -1;
  const hex = colorHex(room.settings.mode, winner);
  const iWon = me.color === winner;
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <p className="text-xs tracking-[0.4em] text-lamp/80">VICTORY</p>
      <p className="text-3xl font-black" style={{ color: hex }}>
        {teamLabel(room, winner)}の勝利!
      </p>
      <p className="text-sm text-white/60">
        {room.winReason === "conquest"
          ? `盤面の${room.settings.conquestPct}%以上を塗りつぶして制圧した`
          : `${room.settings.targetScore}点に到達した`}
        {iWon && <span className="ml-1 font-bold text-lamp">(あなたの陣営)</span>}
      </p>
      <p className="text-xs text-white/40">霧が晴れ、全体の地図が見えています。</p>
      {me.isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <PrimaryButton disabled={busy} onClick={() => run(act("game:playAgain", {}))}>
            同じ設定でもう一度
          </PrimaryButton>
          <SecondaryButton disabled={busy} onClick={() => run(act("game:backToLobby", {}))}>
            ロビーに戻る(チーム・設定変更)
          </SecondaryButton>
        </div>
      ) : (
        <p className="text-sm text-white/50">ホストが次のゲームを始めるのを待っています…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar

function PlayerList({ room, me, actorId }: { room: RoomState; me: Player; actorId?: string }) {
  const ordered = room.order.map((id) => room.players.find((p) => p.id === id)!).filter(Boolean);
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-sm font-bold text-white/70">手番の順番</h2>
      {ordered.map((p, i) => {
        const hex = colorHex(room.settings.mode, p.color);
        const acting = p.id === actorId;
        const ally = p.color === me.color;
        const done = room.phase === "playing" && i < room.turnIndex;
        return (
          <div
            key={p.id}
            className={`flex gap-2.5 rounded-xl border p-2.5 ${acting ? "border-lamp bg-lamp/10" : "border-white/5 bg-panel/80"} ${
              done ? "opacity-60" : ""
            }`}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white/80 text-sm font-black"
              style={{ background: hex }}
            >
              {room.settings.mode === "teams" ? p.number : p.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`truncate font-semibold ${p.connected ? "" : "opacity-40"}`}>
                  {p.name}
                  {p.isBot && " 🤖"}
                </span>
                {p.id === me.id && <span className="shrink-0 text-[11px] text-white/40">あなた</span>}
                {!p.connected && <span className="shrink-0 text-[11px] text-red-400">切断中</span>}
                {acting && <span className="ml-auto shrink-0 text-[11px] text-lamp">手番</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-white/50">
                {p.cave && <span><CaveIcon /> 洞窟中({p.cave.total}/{room.settings.caveThreshold})</span>}
                {ally
                  ? p.items.map((it, k) => (
                      <span key={k} title={`${ITEM_BY_ID[it].name}: ${ITEM_BY_ID[it].description}`}>
                        {ITEM_BY_ID[it].icon}
                      </span>
                    ))
                  : p.itemCount > 0 && <span>アイテム×{p.itemCount}</span>}
                {p.pos < 0 && <span className="text-white/30">霧の中</span>}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function eventText(room: RoomState, e: PublicEvent): string {
  const name = (id: string) => room.players.find((p) => p.id === id)?.name ?? "?";
  switch (e.type) {
    case "setStart":
      return `― 第${e.set}セット開始 ―`;
    case "roll":
      return `${name(e.playerId)}: 🎲${e.dice.join("・")} → ${e.steps}マス`;
    case "item":
      return `${name(e.playerId)}が${ITEM_BY_ID[e.item].icon}${ITEM_BY_ID[e.item].name}を使った${e.targetName ? `(${e.targetName}へ)` : ""}`;
    case "chest":
      return `${name(e.playerId)}が🎁宝箱を開けた`;
    case "ruins": {
      const r = RUINS_EFFECTS.find((x) => x.roll === e.roll);
      return `${name(e.playerId)}が🏛️遺跡を踏んだ: ${e.roll}「${r?.name}」${r?.description}`;
    }
    case "caveEnter":
      return `${name(e.playerId)}が洞窟に入った`;
    case "caveRoll":
      return `${name(e.playerId)}(洞窟): 🎲${e.roll} 合計${e.total}`;
    case "caveExit":
      return `${name(e.playerId)}が洞窟から脱出!(残り${e.extra}マス)`;
    case "bridge":
      return `${name(e.playerId)}が🌉橋を架けた`;
    case "flagFound":
      return `${name(e.playerId)}が🚩フラッグを発見!(全員に公開)`;
    case "enclose":
      return `${name(e.playerId)}が${e.count}マスを囲った`;
    case "score":
      return e.leader < 0
        ? `第${e.set}セット結果: 同数のため得点なし`
        : `第${e.set}セット結果: ${teamLabel(room, e.leader)} +${e.gained[e.leader]}点(陣地+1・フラッグ${e.flags[e.leader]})`;
    case "skip":
      return `${name(e.playerId)}の手番を飛ばした`;
    case "win":
      return `${teamLabel(room, e.color)}の勝利!`;
  }
}

function EventLog({ room }: { room: RoomState }) {
  const recent = room.log.slice(-8).reverse();
  return (
    <section className="rounded-xl border border-white/10 bg-panel/80 p-3">
      <h2 className="mb-1.5 text-sm font-bold text-white/70">最近の出来事</h2>
      <ul className="space-y-1 text-xs">
        {recent.map((e, i) => (
          <li key={i} className={e.type === "score" || e.type === "flagFound" || e.type === "win" ? "text-lamp-light" : "text-white/60"}>
            {eventText(room, e)}
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-white/45">すべての記録</summary>
        <ul className="mt-1.5 max-h-64 space-y-1 overflow-y-auto pr-1 text-xs text-white/55">
          {room.log.map((e, i) => (
            <li key={i}>{eventText(room, e)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Legend() {
  const items: [React.ReactNode, string][] = [
    ["⛰️", "山(通行不可)"],
    ["🌲", "森(+1コスト)"],
    ["#1f5a8f", "川(橋で渡る)"],
    ["#d7ecf5", "氷河(塗れない)"],
    ["🏛️", "遺跡"],
    [<CaveIcon key="cave" />, "洞窟"],
    ["🎁", "宝箱"],
    ["🚩", "フラッグ"],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-white/45">
      {items.map(([icon, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          {typeof icon === "string" && icon.startsWith("#") ? (
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: icon }} />
          ) : (
            icon
          )}
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// End-of-set announcement

function SetResultBanner({ room }: { room: RoomState }) {
  const result = room.lastScoring;
  // Only announce sets that finish while this screen is open, once each.
  const [initialSet] = useState(result?.set ?? 0);
  const [dismissedSet, setDismissedSet] = useState(0);
  const visible = result && result.set > initialSet && result.set !== dismissedSet ? result : null;
  const visibleSet = visible?.set;

  useEffect(() => {
    if (visibleSet === undefined) return;
    const t = setTimeout(() => setDismissedSet(visibleSet), 3200);
    return () => clearTimeout(t);
  }, [visibleSet]);

  if (!visible) return null;
  const hex = visible.leader >= 0 ? colorHex(room.settings.mode, visible.leader) : "#9ca3af";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-4">
      <div
        className="zh-banner rounded-2xl border-2 bg-panel/95 px-6 py-4 text-center shadow-2xl"
        style={{ borderColor: hex }}
      >
        <p className="text-xs tracking-[0.3em] text-white/50">第{visible.set}セット 結果</p>
        {visible.leader >= 0 ? (
          <p className="text-2xl font-black" style={{ color: hex }}>
            {teamLabel(room, visible.leader)} +{visible.gained[visible.leader]}点
          </p>
        ) : (
          <p className="text-2xl font-black text-white/70">同数 — 得点なし</p>
        )}
        <p className="mt-1 text-xs text-white/55">
          {visible.counts.map((n, c) => `${teamLabel(room, c)} ${n}マス`).join(" ・ ")}
          {visible.leader >= 0 && visible.flags[visible.leader] > 0 && ` ・ フラッグ${visible.flags[visible.leader]}本`}
        </p>
      </div>
    </div>
  );
}
