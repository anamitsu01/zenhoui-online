"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ITEM_BY_ID, RUINS_EFFECTS } from "@/lib/content";
import { colorHex, withAlpha } from "@/lib/colors";
import { legalSteps, neighbors4 } from "@/lib/gameEngine";
import type { ClientToServerEvents } from "@/lib/socketEvents";
import type { ItemKind, Player, PublicEvent, RoomState, TurnState } from "@/lib/types";
import { colorName, DICE_COUNT, diceCountFor, isPassable, MAX_ITEMS } from "@/lib/types";
import { play } from "@/lib/sound";
import { EventCutIns, MuteToggle, shakeCount, SoundDirector } from "./BoardEffects";
import CaveIcon from "./CaveIcon";
import ConfirmDialog from "./ConfirmDialog";
import MapGrid, { type HighlightKind } from "./MapGrid";

export type Act = <E extends keyof ClientToServerEvents>(
  event: E,
  payload: Omit<Parameters<ClientToServerEvents[E]>[0], "code">
) => Promise<string | null>;

/** What a click on the map currently means (besides stepping). */
type Targeting = { kind: "item"; index: number } | null;

/**
 * Turns a tap anywhere on the board into a one-cell step: a tap on the line
 * running out from the piece (same row/column) moves that way, and so does a
 * tap that's clearly more horizontal than vertical (or vice versa).
 * Returns the cell to step to, or null when the tap is ambiguous or that way is blocked.
 */
function directionalStep(size: number, from: number, tapped: number, steps: number[]): number | null {
  if (steps.includes(tapped)) return tapped;
  const dx = (tapped % size) - (from % size);
  const dy = Math.floor(tapped / size) - Math.floor(from / size);
  let step: number;
  if (dx !== 0 && Math.abs(dx) >= 2 * Math.abs(dy)) step = from + Math.sign(dx);
  else if (dy !== 0 && Math.abs(dy) >= 2 * Math.abs(dx)) step = from + Math.sign(dy) * size;
  else return null;
  return steps.includes(step) ? step : null;
}

/** Cells an item would affect if used on `cell` (for the confirmation preview). */
function itemArea(item: ItemKind, cell: number, size: number): number[] {
  const radius = item === "barrier" ? 1 : item === "scout" ? 3 : item === "ancientMap" ? 5 : 0;
  const x = cell % size;
  const y = Math.floor(cell / size);
  const out: number[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx);
    }
  return out;
}

/** Whether `cell` is a valid target for the item (mirrors the server's checks). */
function isItemTarget(room: RoomState, me: Player, item: ItemKind | undefined, cell: number): boolean {
  if (!item) return false;
  const def = ITEM_BY_ID[item];
  const c = room.cells[cell];
  const occupied = room.players.some((p) => p.pos === cell && p.id !== me.id);
  switch (def.target) {
    case "cell":
      return true;
    case "ownCell":
      return c.o === me.color && !(item === "warp" && occupied);
    case "riverCell":
      return c.t === "river" && neighbors4(room.size, me.pos).includes(cell);
    case "seenCell":
      return isPassable(c.t) && !occupied;
    default:
      return false;
  }
}

export default function GameBoard({ room, viewerId, act }: { room: RoomState; viewerId: string; act: Act }) {
  const me = room.players.find((p) => p.id === viewerId)!;
  const turn = room.turn;
  const actor = turn ? room.players.find((p) => p.id === turn.playerId) : undefined;
  const myTurn = !!turn && turn.playerId === me.id;
  const [busy, setBusy] = useState(false);
  const [targeting, setTargeting] = useState<Targeting>(null);
  // A tapped target waiting for "この範囲でいいですか?" (tapping another cell re-picks).
  const [picked, setPicked] = useState<{ index: number; cell: number } | null>(null);
  // Errors are tied to the turn state they happened in, so they vanish once the game moves on.
  const turnKey = `${room.set}-${room.turnIndex}-${turn?.stage}-${turn?.path.length}`;
  const [errorState, setErrorState] = useState<{ key: string; message: string | null }>({ key: "", message: null });
  const error = errorState.key === turnKey ? errorState.message : null;
  const activeTargeting =
    myTurn && (turn?.stage === "start" || (turn?.stage === "move" && targeting && me.items[targeting.index] === "bridgeKit")) ? targeting : null;
  const boardRef = useRef<HTMLDivElement>(null);
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

  // Bridges: tap a river next to your piece — at the start of your turn (costs
  // this turn) or mid-move (ends the move and costs your next turn).
  const [bridgeAsk, setBridgeAsk] = useState<{ cell: number; midMove: boolean } | null>(null);
  const bridgeStage = !myTurn || me.cave || !turn ? null : turn.stage === "start" && !targeting ? "start" : turn.stage === "move" ? "move" : null;
  const standingOnOther = room.players.some((p) => p.id !== me.id && p.pos === me.pos);
  const bridgeRivers = useMemo(
    () =>
      bridgeStage && !(bridgeStage === "move" && standingOnOther)
        ? neighbors4(room.size, me.pos).filter((c) => room.cells[c].t === "river")
        : [],
    [bridgeStage, standingOnOther, room.size, room.cells, me.pos]
  );

  const activePick = activeTargeting && picked?.index === activeTargeting.index ? picked : null;
  const pickedItem = activeTargeting ? me.items[activeTargeting.index] : undefined;

  const highlights = useMemo(() => {
    const map = new Map<number, HighlightKind>();
    if (activeTargeting?.kind === "item") {
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
      if (def?.target === "seenCell") {
        room.cells.forEach((c, i) => {
          if (isPassable(c.t) && !room.players.some((p) => p.pos === i && p.id !== me.id)) map.set(i, "line");
        });
      }
      // Light up exactly what the picked target would affect.
      if (activePick && def) for (const c of itemArea(def.id, activePick.cell, room.size)) map.set(c, "preview");
    } else if (steps.length) {
      // Moving: the whole board is tappable (a tap picks a direction, see
      // directionalStep), and each open direction's line is lit to the edge.
      room.cells.forEach((_, i) => map.set(i, "any"));
      for (const c of steps) {
        map.set(c, "step");
        const d = c - me.pos;
        const horizontal = Math.abs(d) === 1;
        for (let n = c + d; n >= 0 && n < room.cells.length; n += d) {
          if (horizontal && Math.floor(n / room.size) !== Math.floor(me.pos / room.size)) break;
          map.set(n, "line");
        }
      }
    }
    if (!activeTargeting) for (const c of bridgeRivers) map.set(c, "target");
    return map;
  }, [activeTargeting, activePick, steps, room, me, bridgeRivers]);

  const onCellClick = useCallback(
    (cell: number) => {
      if (busy) return;
      if (!activeTargeting && bridgeRivers.includes(cell)) {
        setBridgeAsk({ cell, midMove: turn?.stage === "move" });
      } else if (activeTargeting?.kind === "item") {
        // Only cells the item can target (preview cells stay tappable to re-pick).
        if (isItemTarget(room, me, me.items[activeTargeting.index], cell)) setPicked({ index: activeTargeting.index, cell });
      } else {
        const target = directionalStep(room.size, me.pos, cell, steps);
        if (target !== null) run(act("game:step", { cell: target }));
      }
    },
    [busy, activeTargeting, steps, run, act, room, me, bridgeRivers, turn?.stage]
  );

  // Arrow keys / WASD walk the piece.
  useEffect(() => {
    if (!myTurn || turn?.stage !== "move") return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (activeTargeting) return; // picking a river for the bridge kit
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
  }, [myTurn, turn?.stage, me.pos, room.size, onCellClick, activeTargeting]);

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
              setTargeting={(t) => {
                setPicked(null);
                setTargeting(t);
              }}
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
          <span className="flex gap-2">
          <MuteToggle />
          {me.pos >= 0 && room.phase === "playing" && (
            <button
              onClick={() => setRecenter((n) => n + 1)}
              className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:bg-white/10"
            >
              📍 自分のコマへ
            </button>
          )}
          </span>
        </div>
        <div className="relative" ref={boardRef}>
        {myTurn && (turn?.stage === "start" || turn?.stage === "bonus") && !activeTargeting && !bridgeAsk && (
          <RollButton
            anchor={boardRef}
            busy={busy}
            bonus={turn.stage === "bonus"}
            diceCount={diceCountFor(room.settings.mode, room.players, me.color)}
            cave={me.cave ? { total: me.cave.total, need: room.settings.caveThreshold } : null}
            onRoll={() => run(act("game:roll", {}))}
          />
        )}
        <DiceResult room={room} viewerId={viewerId} anchor={boardRef} />
        <MapGrid
          sanctuaryColors={room.sanctuaries.map((s) => s.color)}
          focusCell={me.pos}
          recenterKey={recenterKey}
          size={room.size}
          cells={room.cells}
          mode={room.settings.mode}
          players={room.players}
          actorId={turn?.playerId ?? null}
          remaining={turn?.stage === "move" ? turn.remaining : null}
          followTight={myTurn && turn?.stage === "move"}
          shakeKey={shakeCount(room)}
          path={turn?.path ?? []}
          locked={room.barriers.flatMap((b) => b.cells.filter((c) => room.cells[c]?.o === b.color))}
          highlights={highlights}
          onCellClick={onCellClick}
        />
        </div>
        <Legend />
      </main>

      <aside className="flex flex-col gap-4">
        <PlayerList room={room} me={me} actorId={turn?.playerId} />
        <EventLog room={room} />
      </aside>

      <SetResultBanner room={room} />
      {activePick && pickedItem && (
        <ItemTargetConfirm
          item={pickedItem}
          busy={busy}
          onConfirm={() => {
            setTargeting(null);
            setPicked(null);
            run(act("game:useItem", { index: activePick.index, target: activePick.cell }));
          }}
          onRepick={() => setPicked(null)}
          onCancel={() => {
            setPicked(null);
            setTargeting(null);
          }}
        />
      )}
      {bridgeAsk && (
        <ConfirmDialog
          title="🌉 ここに橋を架けますか?"
          message={
            bridgeAsk.midMove
              ? "移動はここで終わり、次のあなたのターンは1回休みになります。橋は誰でも通れます。"
              : "この手番はここで終わります(サイコロは振りません)。橋は誰でも通れます。"
          }
          confirmLabel="橋を架ける"
          onCancel={() => setBridgeAsk(null)}
          onConfirm={() => {
            const { cell } = bridgeAsk;
            setBridgeAsk(null);
            run(act("game:bridge", { cell }));
          }}
        />
      )}
      <SoundDirector room={room} viewerId={viewerId} />
      <EventCutIns room={room} viewerId={viewerId} />
      <EventPopups room={room} viewerId={viewerId} />
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
          {settings.scoring === "area" ? "陣地点" : "優勢点"} 目標 {settings.targetScore}点 ・ 制圧 {settings.conquestPct}%({need}マス)
          {settings.flagWin > 0 && ` ・ フラッグ${settings.flagWin}本(全${room.flagTotal}本)`}
        </span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: room.colorCount <= 4 ? `repeat(${room.colorCount}, minmax(0, 1fr))` : "repeat(auto-fit, minmax(6.5rem, 1fr))" }}>
        {room.scores.map((score, c) => {
          const hex = colorHex(settings.mode, c);
          const count = room.counts[c] ?? 0;
          return (
            <div key={c} className="rounded-xl p-2" style={{ background: withAlpha(hex, 0.12), border: `1px solid ${withAlpha(hex, 0.45)}` }}>
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-sm font-bold" style={{ color: hex }}>
                  {teamLabel(room, c)}
                  {room.sanctuaries.some((s) => s.color === c) && (
                    <span className="ml-1 rounded bg-amber-300/20 px-1 text-[10px] font-normal text-amber-200" title="聖域: このチームのマスは塗り替えられない">
                      ⛩️聖域
                    </span>
                  )}
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
              <p className="mt-0.5 flex justify-between text-[11px] text-white/50">
                <span>{count}マス</span>
                <span className={settings.flagWin && (room.flagCounts[c] ?? 0) >= settings.flagWin - 1 ? "font-bold text-lamp" : ""}>
                  🚩{room.flagCounts[c] ?? 0}
                  {settings.flagWin ? `/${settings.flagWin}` : ""}
                </span>
              </p>
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
          {turn.stage === "chooseDie" && "使うサイコロを選んでいます"}
          {turn.stage === "bonus" && "ピンゾロ! もう一度サイコロを振ります"}
          {turn.stage === "move" && `移動中(残り ${turn.remaining})`}
          {turn.stage === "caveItem" && "洞窟でアイテムを選んでいます"}
          {turn.stage === "discard" && "持ち物がいっぱいなので、アイテムを1つ捨てています"}
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
        <p className="text-xs text-white/45">盤面中央のサイコロを振ってください</p>
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
            <p className="w-full text-xs text-white/45">アイテムを使うならサイコロの前に。準備ができたら盤面中央のサイコロを振ってください</p>
            {nearRiver && <BridgeHint>隣の光っている川をタップすると橋を架けられます(この手番は終了)</BridgeHint>}
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

  if (turn.stage === "bonus") {
    return (
      <div className="flex flex-col items-center gap-1 py-1 text-center">
        <p className="font-bold text-lamp">ピンゾロ(1と1)! もう一度サイコロを振れます</p>
        <p className="text-xs text-white/50">2回目の出目も合計に加えて進めます(3回目はありません)。盤面中央のサイコロを振ってください</p>
      </div>
    );
  }

  if (turn.stage === "chooseDie") {
    return <ChooseDice key={`${room.set}-${room.turnIndex}`} dice={turn.dice} busy={busy} cave={!!me.cave} onConfirm={(keep) => run(act("game:chooseDie", { keep }))} />;
  }

  if (turn.stage === "caveItem") {
    const full = me.items.length >= MAX_ITEMS;
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="font-bold text-lamp">洞窟から脱出! 秘宝を1つ選んでください</p>
        <div className="flex flex-wrap justify-center gap-2">
          {turn.caveChoices.map((it, i) => (
            <ItemButton key={i} item={it} disabled={busy} onClick={() => run(act("game:caveItem", { index: i }))} />
          ))}
        </div>
        {full && <p className="text-xs text-white/50">持ち物がいっぱい({MAX_ITEMS}個)なので、受け取ったら1つ捨てます</p>}
        <SecondaryButton disabled={busy} onClick={() => run(act("game:caveItem", { index: -1 }))}>
          受け取らない
        </SecondaryButton>
        {turn.remaining > 0 && <p className="text-xs text-white/50">このあと {turn.remaining} マス進めます</p>}
      </div>
    );
  }

  if (turn.stage === "discard") {
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="font-bold text-lamp">持ち物がいっぱいです! 捨てるアイテムを1つ選んでください</p>
        <p className="text-xs text-white/50">持てるのは{MAX_ITEMS}個まで。今手に入れたものを捨ててもかまいません</p>
        <div className="flex flex-wrap justify-center gap-2">
          {me.items.map((it, i) => (
            <ItemButton key={i} item={it} disabled={busy} onClick={() => run(act("game:discardItem", { index: i }))} />
          ))}
        </div>
      </div>
    );
  }

  // move
  const onCave = room.cells[me.pos]?.f === "cave" && turn.path.length >= 2;
  const kitIndex = me.items.indexOf("bridgeKit");
  if (targeting && turn.stage === "move") {
    return (
      <div className="flex flex-col items-center gap-2 py-1 text-center">
        <p className="text-sm">🪵 橋キット: 橋を架ける隣の川を選んでください(手番はそのまま続きます)</p>
        <SecondaryButton onClick={() => setTargeting(null)}>キャンセル</SecondaryButton>
      </div>
    );
  }
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
      <p className="w-full text-xs text-white/45 sm:w-auto">進みたい方向の点線上をタップ(矢印キー・WASDでも移動)</p>
      {nearRiver && !room.players.some((p) => p.id !== me.id && p.pos === me.pos) && (
        <BridgeHint>隣の光っている川をタップすると橋を架けられます(移動はここまで・次のターンは1回休み)</BridgeHint>
      )}
      {nearRiver && kitIndex >= 0 && (
        <SecondaryButton disabled={busy} onClick={() => setTargeting({ kind: "item", index: kitIndex })}>
          🪵 橋キットで橋を架ける(移動を続けられる)
        </SecondaryButton>
      )}
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
      {canStep && turn.remaining === 0.5 && !room.players.some((p) => p.id !== me.id && p.pos === me.pos) && (
        <SecondaryButton disabled={busy} onClick={() => run(act("game:endMove", { enterCave: false }))}>
          ここで止まる(残り0.5は使わない)
        </SecondaryButton>
      )}
    </div>
  );
}

/** 選べる運命: tap the two dice to use (tap again to unpick), then confirm. */
function ChooseDice({ dice, busy, cave = false, onConfirm }: { dice: number[]; busy: boolean; cave?: boolean; onConfirm: (keep: number[]) => void }) {
  const need = dice.length - 1; // one extra die was rolled
  const [keep, setKeep] = useState<number[]>([]);
  const toggle = (i: number) => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : k.length < need ? [...k, i] : [...k.slice(1), i]));
  const total = keep.reduce((s, i) => s + dice[i], 0);
  return (
    <div className="flex flex-col items-center gap-2 py-1 text-center">
      <p className="font-bold text-lamp">選べる運命 — 使うサイコロを{need}つ選んでください</p>
      <div className="flex flex-wrap justify-center gap-3">
        {dice.map((d, i) => {
          const on = keep.includes(i);
          return (
            <button
              key={i}
              disabled={busy}
              onClick={() => toggle(i)}
              className={`rounded-xl p-1 transition ${on ? "-translate-y-1 bg-lamp/25 ring-2 ring-lamp" : "opacity-60 hover:bg-white/10 hover:opacity-100"}`}
              aria-pressed={on}
            >
              <Die value={d} size="lg" />
            </button>
          );
        })}
      </div>
      <p className="text-sm text-white/70">{keep.length === need ? (cave ? `洞窟の合計に +${total}` : `合計 ${total} マス`) : `あと${need - keep.length}つ選んでください`}</p>
      <PrimaryButton disabled={busy || keep.length !== need} onClick={() => onConfirm(keep)}>
        この{need}つで決定
      </PrimaryButton>
    </div>
  );
}

function BridgeHint({ children }: { children: React.ReactNode }) {
  return <p className="w-full rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-200">🌉 {children}</p>;
}

function ModChips({ mods }: { mods: TurnState["mods"] }) {
  const chips: string[] = [];
  if (mods.moveDelta) chips.push(`移動力${mods.moveDelta > 0 ? "+" : ""}${mods.moveDelta}`);
  if (mods.ignoreForest) chips.push("森の追加コスト無視");
  if (mods.noOverwrite) chips.push("相手の色を塗り替えられない");
  if (mods.roller) chips.push("左右も塗る");
  if (mods.doubleDice) chips.push("サイコロ3個から2個");
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
      className={`flex max-w-[14rem] items-center gap-2 rounded-xl border px-3 py-2 text-left disabled:opacity-40 ${
        def.rare ? "border-fuchsia-400/60 bg-fuchsia-500/10 hover:bg-fuchsia-500/20" : "border-white/15 bg-white/[0.04] hover:bg-white/10"
      }`}
    >
      <span className="text-2xl">{def.icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">
          {def.name}
          {def.rare && <span className="ml-1 rounded bg-fuchsia-400/25 px-1 text-[10px] text-fuchsia-200">秘宝</span>}
        </span>
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

function Die({ value, size = "md" }: { value: number; size?: "md" | "lg" | "xl" }) {
  const dim = size === "xl" ? "h-24 w-24 p-3.5" : size === "lg" ? "h-16 w-16 p-2.5" : "h-11 w-11 p-1.5";
  // Flick through random faces for a moment, then land on the real roll.
  const [face, setFace] = useState((value % 6) + 1);
  useEffect(() => {
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      if (ticks >= 7) {
        setFace(value);
        clearInterval(t);
      } else {
        setFace(1 + Math.floor(Math.random() * 6));
      }
    }, 55);
    return () => clearInterval(t);
  }, [value]);
  return (
    <span className={`zh-roll grid grid-cols-3 grid-rows-3 rounded-xl bg-ink shadow-lg ${dim}`}>
      {Array.from({ length: 9 }, (_, k) => {
        const on = PIPS[face]?.some(([x, y]) => x === k % 3 && y === Math.floor(k / 3));
        return (
          <span key={k} className="flex items-center justify-center">
            {on && <span className={`rounded-full ${face === 1 ? "h-[70%] w-[70%] bg-red-600" : "h-[62%] w-[62%] bg-black"}`} />}
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
          : room.winReason === "flags"
            ? `フラッグを同時に${room.settings.flagWin}本支配した`
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
                {p.resting && <span className="text-sky-300">💤 次は1回休み</span>}
                {diceCountFor(room.settings.mode, room.players, p.color) > DICE_COUNT && (
                  <span className="text-lamp-light" title="人数差ハンデ">
                    🎲×{diceCountFor(room.settings.mode, room.players, p.color)}
                  </span>
                )}
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
      return e.item
        ? `${name(e.playerId)}が🎁宝箱を開けた: ${ITEM_BY_ID[e.item].icon}${ITEM_BY_ID[e.item].name}`
        : `${name(e.playerId)}が🎁宝箱を開けた`;
    case "discard":
      return e.item ? `${name(e.playerId)}が${ITEM_BY_ID[e.item].icon}${ITEM_BY_ID[e.item].name}を捨てた` : `${name(e.playerId)}がアイテムを1つ捨てた`;
    case "caveItem":
      return e.item
        ? `${name(e.playerId)}が洞窟の秘宝 ${ITEM_BY_ID[e.item].icon}${ITEM_BY_ID[e.item].name} を手に入れた`
        : e.hidden
          ? `${name(e.playerId)}が洞窟の秘宝を手に入れた`
          : `${name(e.playerId)}は秘宝を受け取らなかった`;
    case "ruins": {
      const r = RUINS_EFFECTS.find((x) => x.roll === e.roll);
      return `${name(e.playerId)}が🏛️遺跡を踏んだ: ${e.roll}「${r?.name}」${r?.description}`;
    }
    case "caveEnter":
      return `${name(e.playerId)}が洞窟に入った`;
    case "caveRoll":
      return `${name(e.playerId)}(洞窟): 🎲${e.dice.join("・")}${e.delta ? `(効果${e.delta > 0 ? "+" : ""}${e.delta})` : ""} → +${e.roll} 合計${e.total}`;
    case "caveExit":
      return `${name(e.playerId)}が洞窟から脱出!(残り${e.extra}マス)`;
    case "bridge":
      return `${name(e.playerId)}が🌉橋を架けた${e.rest ? "(次のターンは1回休み)" : ""}`;
    case "bonusRoll":
      return `${name(e.playerId)}: ⚀⚀ ピンゾロ! もう一度振る`;
    case "rest":
      return `${name(e.playerId)}は1回休み💤`;
    case "flagFound":
      return `${name(e.playerId)}が🚩フラッグを発見!(全員に公開)`;
    case "enclose":
      return `${name(e.playerId)}が${e.count}マスを囲った`;
    case "score":
      return room.settings.scoring === "area"
        ? `第${e.set}セット結果: ${e.gained.map((g, c) => `${teamLabel(room, c)} +${g}`).join(" / ")}`
        : e.leader < 0
          ? `第${e.set}セット結果: 同数のため得点なし`
          : `第${e.set}セット結果: ${teamLabel(room, e.leader)} +${e.gained[e.leader]}点`;
    case "skip":
      return `${name(e.playerId)}の手番を飛ばした`;
    case "flagReach":
      return `${teamLabel(room, e.color)}がフラッグ${e.held}本 — リーチ!`;
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
    ["½", "自分の色: 移動コスト半分"],
    ["+1", "相手の色・相手のコマの隣: 移動コスト+1"],
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
// "You got an item!"

/**
 * Pops up each item as it's picked up (chest or cave). Items are only ever
 * appended on pickup and removed on use, so anything past the previously
 * seen count is new. Nothing pops on first load / reconnect.
 */
// ---------------------------------------------------------------------------
// "この範囲でいいですか?" — floats at the bottom so the lit preview stays visible.

function ItemTargetConfirm({
  item,
  busy,
  onConfirm,
  onRepick,
  onCancel,
}: {
  item: ItemKind;
  busy: boolean;
  onConfirm: () => void;
  onRepick: () => void;
  onCancel: () => void;
}) {
  const def = ITEM_BY_ID[item];
  const question =
    item === "warp" || item === "pegasus"
      ? "光っているマスへ移動しますか?"
      : item === "bridgeKit"
        ? "光っている川に橋を架けますか?"
        : item === "barrier"
          ? "この範囲(光っている3×3の自分のマス)を守りますか?"
          : "この範囲でいいですか?";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="zh-pop pointer-events-auto w-full max-w-md rounded-2xl border-2 border-lamp bg-panel/95 p-4 text-center shadow-2xl backdrop-blur">
        <p className="text-sm font-bold">
          {def.icon} {def.name}: {question}
        </p>
        <p className="mt-0.5 text-xs text-white/50">別のマスをタップすると選び直せます</p>
        <div className="mt-3 flex justify-center gap-2">
          <SecondaryButton onClick={onCancel}>使わない</SecondaryButton>
          <SecondaryButton onClick={onRepick}>選び直す</SecondaryButton>
          <PrimaryButton disabled={busy} onClick={onConfirm}>
            決定
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The roll: a big die in the middle of the board, only when it's time to roll.

/**
 * Screen position of the middle of the board's visible part (the board can be
 * taller than the screen), so center overlays are always in view.
 */
function useBoardCenter(anchor: RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = anchor.current?.getBoundingClientRect();
        if (!r) return;
        const top = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.innerHeight);
        const y = bottom - top > 120 ? (top + bottom) / 2 : window.innerHeight / 2;
        setPos({ x: r.left + r.width / 2, y });
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);
  return pos;
}

function CenterLayer({ anchor, children }: { anchor: RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  const pos = useBoardCenter(anchor);
  if (!pos) return null;
  return (
    <div className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  );
}

function RollButton({
  anchor,
  busy,
  bonus = false,
  diceCount,
  cave,
  onRoll,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  busy: boolean;
  /** ピンゾロ bonus roll. */
  bonus?: boolean;
  diceCount: number;
  cave: { total: number; need: number } | null;
  onRoll: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && !busy) {
        e.preventDefault();
        onRoll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onRoll]);
  return (
    <CenterLayer anchor={anchor}>
      <button
        disabled={busy}
        onClick={onRoll}
        className="zh-pop pointer-events-auto flex flex-col items-center gap-1 rounded-3xl border-2 border-lamp bg-panel/90 px-8 py-5 shadow-[0_0_40px_rgba(240,180,60,0.45)] backdrop-blur transition-transform hover:scale-105 disabled:opacity-50"
      >
        {bonus ? (
          <>
            <span className="text-sm font-black text-red-400">⚀⚀ ピンゾロ!</span>
            <span className="flex gap-2">
              {Array.from({ length: diceCount }, (_, k) => (
                <Die key={k} value={1} />
              ))}
            </span>
          </>
        ) : (
          <span className="zh-wobble text-6xl">🎲</span>
        )}
        <span className="text-lg font-black text-lamp">{bonus ? "もう一度振る(合計に加算)" : cave ? "洞窟でサイコロを振る" : "サイコロを振る"}</span>
        {cave && (
          <span className="text-xs text-white/60">
            合計 {cave.total} / {cave.need} で脱出
          </span>
        )}
        {diceCount > DICE_COUNT && <span className="text-xs font-bold text-lamp-light">人数差ハンデ: サイコロ{diceCount}個</span>}
        <span className="text-[10px] text-white/35">タップ(スペースキーでも可)</span>
      </button>
    </CenterLayer>
  );
}

const DICE_RESULT_MS = 1700;

/** Shows my roll in the middle of the board for a moment (moves, or cave progress). */
function DiceResult({ room, viewerId, anchor }: { room: RoomState; viewerId: string; anchor: RefObject<HTMLDivElement | null> }) {
  const [seen, setSeen] = useState(() => room.log.length);
  const from = seen > room.log.length ? 0 : seen;
  let index = -1;
  for (let i = from; i < room.log.length; i++) {
    const e = room.log[i];
    if ((e.type === "roll" || e.type === "caveRoll") && e.playerId === viewerId && e.dice.length) {
      index = i;
      break;
    }
  }
  useEffect(() => {
    if (index < 0) return;
    const t = setTimeout(() => setSeen(index + 1), DICE_RESULT_MS);
    return () => clearTimeout(t);
  }, [index]);
  if (index < 0) return null;
  const e = room.log[index] as Extract<PublicEvent, { type: "roll" | "caveRoll" }>;
  const need = room.settings.caveThreshold;
  return (
    <CenterLayer anchor={anchor}>
      <div key={index} className="zh-dice-result flex flex-col items-center gap-2 rounded-3xl border-2 border-lamp/70 bg-panel/90 px-8 py-5 shadow-2xl backdrop-blur">
        <span className="flex max-w-[80vw] flex-wrap justify-center gap-3">
          {e.dice.map((d, i) => (
            <Die key={i} value={d} size={e.dice.length <= 2 ? "xl" : e.dice.length <= 4 ? "lg" : "md"} />
          ))}
        </span>
        {e.type === "roll" ? (
          <p className="zh-reveal text-2xl font-black text-lamp">{e.dice.length > diceCountFor(room.settings.mode, room.players, room.players.find((p) => p.id === e.playerId)?.color ?? -1) ? `ボーナス込みで${e.steps}マス進める!` : `${e.steps}マス進める!`}</p>
        ) : (
          <div className="zh-reveal w-56 text-center">
            <p className="text-lg font-black">
              <CaveIcon /> +{e.roll}
              {e.delta !== 0 && <span className="text-sm text-lamp-light">(効果{e.delta > 0 ? "+" : ""}{e.delta})</span>} → 合計{" "}
              <span className="text-lamp">{e.total}</span> / {need}
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-lamp" style={{ width: `${Math.min(100, (e.total / need) * 100)}%` }} />
            </div>
            <p className="mt-1 text-sm font-bold text-white/80">{e.total >= need ? "脱出!" : `脱出まであと${need - e.total}`}</p>
          </div>
        )}
      </div>
    </CenterLayer>
  );
}

// ---------------------------------------------------------------------------
// Popups for the big moments — items, ruins, bridges — shown to every player
// in log order. On your own you close it (OK); everyone else's passes by on
// its own without blocking the board. Events already in the log when the
// screen opened are not replayed.

type PopupEvent = Extract<PublicEvent, { type: "chest" | "caveItem" | "ruins" | "bridge" | "rest" | "caveEnter" }>;

function isPopupEvent(e: PublicEvent): e is PopupEvent {
  return e.type === "chest" || (e.type === "caveItem" && (e.item !== null || !!e.hidden)) || e.type === "ruins" || e.type === "bridge" || e.type === "rest" || e.type === "caveEnter";
}

function EventPopups({ room, viewerId }: { room: RoomState; viewerId: string }) {
  const [seen, setSeen] = useState(() => room.log.length);
  const from = seen > room.log.length ? 0 : seen; // a rematch starts a fresh log
  let index = -1;
  for (let i = from; i < room.log.length; i++) {
    if (isPopupEvent(room.log[i])) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;
  const e = room.log[index] as PopupEvent;
  const own = e.playerId === viewerId;
  const who = own ? "あなた" : room.players.find((p) => p.id === e.playerId)?.name ?? "だれか";
  const close = () => setSeen(index + 1);
  if (e.type === "chest" || e.type === "caveItem")
    return <ItemGotPopup key={index} item={e.item} rare={e.type === "caveItem"} own={own} who={who} onClose={close} />;
  if (e.type === "ruins") return <RuinsPopup key={index} roll={e.roll} own={own} who={who} onClose={close} />;
  if (e.type === "caveEnter") return <CaveEnterPopup key={index} own={own} who={who} need={room.settings.caveThreshold} onClose={close} />;
  return <BridgePopup key={index} kind={e.type === "rest" ? "rest" : e.rest ? "midMove" : "start"} own={own} who={who} onClose={close} />;
}

/** Own popups are modal; others' float without blocking and close themselves after `autoMs`. */
function PopupShell({
  own,
  onClose,
  autoMs,
  canClose = true,
  children,
}: {
  own: boolean;
  onClose: () => void;
  autoMs?: number;
  canClose?: boolean;
  children: React.ReactNode;
}) {
  // The parent re-renders on every room update with a fresh onClose; keep the
  // latest one in a ref so the auto-close timer is not restarted each time.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!autoMs) return;
    const t = setTimeout(() => closeRef.current(), autoMs);
    return () => clearTimeout(t);
  }, [autoMs]);
  useEffect(() => {
    if (!own) return;
    const onKey = (ev: KeyboardEvent) => {
      if (canClose && (ev.key === "Enter" || ev.key === "Escape")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [own, canClose, onClose]);
  return own ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" onClick={() => canClose && onClose()}>
      <div onClick={(ev) => ev.stopPropagation()} className="w-full max-w-xs">
        {children}
      </div>
    </div>
  ) : (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4" role="status">
      <div className="pointer-events-auto w-full max-w-xs cursor-pointer" onClick={onClose} title="タップで閉じる">
        {children}
      </div>
    </div>
  );
}

const OTHERS_POPUP_MS = 2600;
const BRIDGE_MS = 2600;

const CAVE_ENTER_MS = 2600;

function CaveEnterPopup({ own, who, need, onClose }: { own: boolean; who: string; need: number; onClose: () => void }) {
  return (
    <PopupShell own={own} onClose={onClose} autoMs={CAVE_ENTER_MS}>
      <div className="zh-pop rounded-2xl border-2 border-amber-700 bg-panel p-6 text-center shadow-[0_0_40px_rgba(180,110,40,0.45)]">
        <p className="text-xs tracking-[0.3em] text-amber-500/80">CAVE</p>
        <div className="relative mx-auto my-3 flex h-24 w-24 items-end justify-center">
          <span className="zh-cave-enter text-7xl leading-none">
            <CaveIcon size="1em" />
          </span>
        </div>
        <p className="text-xl font-black">{own ? "洞窟に入った!" : `${who}が洞窟に入った!`}</p>
        <p className="mt-1 text-sm text-white/70">
          次のターンから毎ターンサイコロを振り、合計{need}以上で秘宝を手に脱出{own ? "できる" : "する"}
        </p>
      </div>
    </PopupShell>
  );
}

function BridgePopup({ kind, own, who, onClose }: { kind: "start" | "midMove" | "rest"; own: boolean; who: string; onClose: () => void }) {
  const sub =
    kind === "rest"
      ? `建設が続いているため、${own ? "このターン" : "このターンは"}1回休み`
      : kind === "midMove"
        ? "完成まで、次のターンは1回休み"
        : "この手番は建設で終わり";
  return (
    <PopupShell own={own} onClose={onClose} autoMs={BRIDGE_MS}>
      <div className="zh-pop rounded-2xl border-2 border-sky-400 bg-panel p-6 text-center shadow-[0_0_40px_rgba(56,189,248,0.4)]">
        <p className="text-xs tracking-[0.3em] text-sky-300/80">{kind === "rest" ? "1回休み" : "BRIDGE"}</p>
        <div className="relative mx-auto my-3 h-24 w-56">
          <div className="zh-river absolute inset-x-0 bottom-0 h-10 rounded-lg" />
          <div className="absolute inset-x-3 bottom-4 flex gap-1">
            {Array.from({ length: 7 }, (_, k) => (
              <span key={k} className="zh-plank h-3 flex-1 rounded-sm bg-amber-700 shadow" style={{ animationDelay: `${k * 0.22}s` }} />
            ))}
          </div>
          <span className="zh-hammer absolute left-1/2 top-0 -translate-x-1/2 text-4xl">🔨</span>
        </div>
        <p className="text-xl font-black">🌉 {own ? "" : `${who}が`}橋を架けています…</p>
        <p className="mt-1 text-sm text-white/70">{sub}</p>
      </div>
    </PopupShell>
  );
}

const RUINS_REVEAL_MS = 650;

/** The die tumbles, then the effect for the next turn is revealed (gold = blessing, violet = curse). */
function RuinsPopup({ roll, own, who, onClose }: { roll: number; own: boolean; who: string; onClose: () => void }) {
  const effect = RUINS_EFFECTS.find((r) => r.roll === roll)!;
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    play("ruins", { volume: own ? 1 : 0.6 });
    const t = setTimeout(() => {
      setRevealed(true);
      play(effect.good ? "ruinsGood" : "ruinsBad", { volume: own ? 1 : 0.6 });
    }, RUINS_REVEAL_MS);
    return () => clearTimeout(t);
  }, [effect.good, own]);

  const tone = effect.good
    ? { border: "border-lamp", glow: "rgba(240,180,60,0.55)", text: "text-lamp-light", label: "遺跡の加護" }
    : { border: "border-violet-400", glow: "rgba(167,139,250,0.55)", text: "text-violet-300", label: "遺跡の呪い" };
  return (
    <PopupShell own={own} onClose={onClose} canClose={revealed} autoMs={own ? undefined : RUINS_REVEAL_MS + OTHERS_POPUP_MS}>
      <div
        className={`zh-pop relative overflow-hidden rounded-2xl border-2 bg-panel p-6 text-center shadow-2xl ${revealed ? tone.border : "border-white/20"}`}
        style={revealed ? { boxShadow: `0 0 40px 6px ${tone.glow}` } : undefined}
      >
        {revealed && <span className="zh-ruins-rays pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 38%, ${tone.glow}, transparent 60%)` }} />}
        <p className="relative text-xs tracking-[0.3em] text-white/50">ANCIENT RUINS</p>
        <p className="relative mb-3 font-bold text-white/80">🏛️ {own ? "遺跡が目を覚ました…" : `${who}が遺跡を踏んだ…`}</p>
        <div className="relative mb-3 flex justify-center">
          <Die value={roll} size="lg" />
        </div>
        {revealed ? (
          <div className="zh-pop relative">
            <p className={`text-sm font-bold ${tone.text}`}>{tone.label}</p>
            <p className="mt-1 text-5xl">{effect.icon}</p>
            <p className="mt-1 text-2xl font-black">{effect.name}</p>
            <p className="mt-2 text-sm text-white/80">{effect.description}</p>
            <p className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/50">効果は{own ? "あなた" : who}の次のターンに発動します。</p>
            {own && (
              <button
                onClick={onClose}
                className={`mt-4 w-full rounded-full px-6 py-2.5 font-bold text-black ${effect.good ? "bg-lamp hover:bg-lamp-light" : "bg-violet-300 hover:bg-violet-200"}`}
              >
                OK
              </button>
            )}
          </div>
        ) : (
          <p className="relative animate-pulse py-6 text-sm text-white/50">運命のサイコロが転がる…</p>
        )}
      </div>
    </PopupShell>
  );
}

/** `item` is null when an opponent found it: they only learn that something was found. */
function ItemGotPopup({ item, rare, own, who, onClose }: { item: ItemKind | null; rare: boolean; own: boolean; who: string; onClose: () => void }) {
  const def = item ? ITEM_BY_ID[item] : null;
  const what = rare ? "洞窟の秘宝" : "アイテム";
  return (
    <PopupShell own={own} onClose={onClose} autoMs={own ? undefined : OTHERS_POPUP_MS}>
      <div
        className={`zh-pop rounded-2xl border-2 bg-panel p-6 text-center shadow-2xl ${rare ? "border-fuchsia-400" : "border-lamp"}`}
        style={rare ? { boxShadow: "0 0 40px 6px rgba(232,121,249,0.45)" } : undefined}
      >
        <p className={`text-xs tracking-[0.3em] ${rare ? "text-fuchsia-300/80" : "text-lamp/80"}`}>{rare ? "CAVE TREASURE" : "GET ITEM"}</p>
        <p className={`mb-3 font-bold ${rare ? "text-fuchsia-200" : "text-lamp-light"}`}>
          {own ? `${what}を手に入れた!` : `${who}が${what}を手に入れた!`}
        </p>
        <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-2xl bg-white/[0.06] text-6xl">{def ? def.icon : "❓"}</div>
        <p className="text-2xl font-black">{def ? def.name : "???"}</p>
        <p className="mt-2 text-sm text-white/80">{def ? def.description : "何を手に入れたかは分からない…"}</p>
        {own && (
          <>
            <p className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/50">
              自分の手番の最初(サイコロを振る前)に使えます(橋キットは移動中も可)。持てるのは{MAX_ITEMS}個までで、4個目を手に入れたら1つ捨てます。
            </p>
            <button onClick={onClose} className="mt-4 w-full rounded-full bg-lamp px-6 py-2.5 font-bold text-black hover:bg-lamp-light">
              OK
            </button>
          </>
        )}
      </div>
    </PopupShell>
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
        {room.settings.scoring === "area" ? (
          <p className="flex flex-wrap justify-center gap-x-4 text-xl font-black">
            {visible.gained.map((g, c) => (
              <span key={c} style={{ color: colorHex(room.settings.mode, c) }}>
                {teamLabel(room, c)} +{g}点
              </span>
            ))}
          </p>
        ) : visible.leader >= 0 ? (
          <p className="text-2xl font-black" style={{ color: hex }}>
            {teamLabel(room, visible.leader)} +{visible.gained[visible.leader]}点
          </p>
        ) : (
          <p className="text-2xl font-black text-white/70">同数 — 得点なし</p>
        )}
        <p className="mt-1 text-xs text-white/55">
          {room.settings.scoring === "area"
            ? `合計: ${room.scores.map((s, c) => `${teamLabel(room, c)} ${s}`).join(" ・ ")} / ${room.settings.targetScore}`
            : visible.counts.map((n, c) => `${teamLabel(room, c)} ${n}マス`).join(" ・ ")}

        </p>
      </div>
    </div>
  );
}
