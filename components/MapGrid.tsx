"use client";

import { memo, useEffect, useRef, useState } from "react";
import { colorHex, withAlpha } from "@/lib/colors";
import type { Cell, GameMode, Player, Terrain } from "@/lib/types";
import CaveIcon from "./CaveIcon";
import Character from "./Character";

/** A few shades per terrain, picked per cell, so ground looks textured rather than flat. */
const TERRAIN_SHADES: Record<Terrain, string[]> = {
  plain: ["#1c2733", "#1f2b37", "#1a2430", "#1d2935"],
  forest: ["#173d2a", "#1a4230", "#153826"],
  mountain: ["#57524c", "#5c5650", "#524d47"],
  river: ["#1f5a8f"],
  bridge: ["#6b4f2a"],
  glacier: ["#d7ecf5", "#dff0f7", "#cfe6f1"],
  unknown: ["#06090d", "#070b10", "#05080c", "#080c12"],
};

const TERRAIN_ICON: Partial<Record<Terrain, string>> = {
  forest: "🌲",
  mountain: "⛰️",
  bridge: "🌉",
};

const FEATURE_ICON = { ruins: "🏛️", cave: <CaveIcon size="1.45em" />, chest: "🎁", flag: "🚩" } as const;

/** Cells never shrink below this, so big boards scroll instead of becoming untappable. */
const MIN_CELL_PX = 16;
/** The board's outer frame: a color used nowhere else, so the edge of the world is unmistakable. */
const EDGE_COLOR = "#2dd4bf";
/** How long cell effects (splats, fills, fog lifting) stay mounted. */
const FX_MS = 1800;
/** Above this many simultaneous changes (new game, game-over reveal) skip effects. */
const FX_LIMIT = 700;

/**
 * step/target are outlined; "line" (the way a step leads, out to the edge) is
 * faintly lit; "any" is clickable without a mark (e.g. scouting anywhere).
 */
export type HighlightKind = "step" | "target" | "line" | "any";

function hash(i: number): number {
  let h = (i + 1) * 2654435761;
  h ^= h >>> 13;
  return Math.abs(h);
}

function cellBg(cell: Cell, i: number, mode: GameMode): string {
  if (cell.o >= 0) return withAlpha(colorHex(mode, cell.o), [0.6, 0.64, 0.57][hash(i) % 3]);
  const shades = TERRAIN_SHADES[cell.t];
  return shades[hash(i) % shades.length];
}

type Fx = { cell: number; kind: "splat" | "fill" | "reveal"; from: string; to: string; delay: number };
type FxBatch = { id: number; items: Fx[] };

interface Props {
  size: number;
  cells: Cell[];
  mode: GameMode;
  players: Player[];
  actorId: string | null;
  /** Movement left for the acting piece (shown over its head), or null. */
  remaining: number | null;
  path: number[];
  locked: number[];
  highlights: Map<number, HighlightKind>;
  onCellClick: (cell: number) => void;
  /** Keep this cell in view (scrolls when it nears the edge of the visible area). */
  focusCell: number;
  /** Changing this re-centers on focusCell. */
  recenterKey: number;
  /** Follow the focused piece closely (while I'm moving). */
  followTight: boolean;
  /** Changing this shakes the board (bombs, big captures). */
  shakeKey: number;
}

function MapGrid({
  size,
  cells,
  mode,
  players,
  actorId,
  remaining,
  path,
  locked,
  highlights,
  onCellClick,
  focusCell,
  recenterKey,
  followTight,
  shakeKey,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // --- camera ---------------------------------------------------------------
  // Scroll the viewport (never the page) so the focused cell is visible.
  // A re-center request always centers; otherwise scroll once the cell gets
  // near the visible edge (much nearer the middle while I'm moving).
  const lastRecenter = useRef(-1);
  useEffect(() => {
    const viewport = viewportRef.current;
    const cell = gridRef.current?.children[focusCell] as HTMLElement | undefined;
    if (!viewport || !cell || focusCell < 0) return;
    const center = lastRecenter.current !== recenterKey;
    lastRecenter.current = recenterKey;
    const vr = viewport.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    const vx = viewport.scrollLeft;
    const vy = viewport.scrollTop;
    const x = cr.left - vr.left + vx;
    const y = cr.top - vr.top + vy;
    const w = cr.width;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const mx = followTight ? vw * 0.3 : w * 3;
    const my = followTight ? vh * 0.3 : w * 3;
    const outside = x < vx + mx || x + w > vx + vw - mx || y < vy + my || y + w > vy + vh - my;
    if (center || outside) {
      viewport.scrollTo({ left: x - vw / 2 + w / 2, top: y - vh / 2 + w / 2, behavior: center ? "auto" : "smooth" });
    }
  }, [focusCell, recenterKey, followTight]);

  // --- screen shake ----------------------------------------------------------
  const lastShake = useRef(shakeKey);
  useEffect(() => {
    if (lastShake.current === shakeKey) return;
    lastShake.current = shakeKey;
    gridRef.current?.animate(
      [
        { transform: "translate(0,0)" },
        { transform: "translate(-6px,3px)" },
        { transform: "translate(5px,-4px)" },
        { transform: "translate(-4px,-2px)" },
        { transform: "translate(3px,3px)" },
        { transform: "translate(0,0)" },
      ],
      { duration: 380, easing: "ease-out" }
    );
  }, [shakeKey]);

  // --- cell effects ------------------------------------------------------------
  // Diff against the previous board: newly painted cells splat (or, for a
  // capture, fill in as a wave spreading from the mover), and cells leaving
  // the fog have it lift off. Batches unmount after FX_MS.
  const [prev, setPrev] = useState(cells);
  const [batches, setBatches] = useState<FxBatch[]>([]);
  if (prev !== cells) {
    setPrev(cells);
    if (prev.length === cells.length) {
      const actor = players.find((p) => p.id === actorId);
      const origin = actor && actor.pos >= 0 ? actor.pos : -1;
      const painted: number[] = [];
      const revealed: number[] = [];
      for (let i = 0; i < cells.length; i++) {
        const a = prev[i];
        const b = cells[i];
        if (a.t === "unknown" && b.t !== "unknown") revealed.push(i);
        else if (b.o >= 0 && a.o !== b.o && a.t !== "unknown") painted.push(i);
      }
      const items: Fx[] = [];
      if (painted.length <= FX_LIMIT) {
        const wave = painted.length > 3;
        for (const i of painted) {
          const d =
            wave && origin >= 0
              ? Math.max(Math.abs((i % size) - (origin % size)), Math.abs(Math.floor(i / size) - Math.floor(origin / size)))
              : 0;
          items.push({ cell: i, kind: wave ? "fill" : "splat", from: cellBg(prev[i], i, mode), to: cellBg(cells[i], i, mode), delay: Math.min(d * 45, 1100) });
        }
      }
      if (revealed.length <= FX_LIMIT) {
        for (const i of revealed) items.push({ cell: i, kind: "reveal", from: cellBg(prev[i], i, mode), to: "", delay: (hash(i) % 6) * 25 });
      }
      if (items.length) setBatches((b) => [...b, { id: (b[b.length - 1]?.id ?? 0) + 1, items }]);
    }
  }
  const newestBatch = batches[batches.length - 1]?.id;
  useEffect(() => {
    if (newestBatch === undefined) return;
    // Each batch removes itself; no cleanup so later batches don't cancel earlier timers.
    setTimeout(() => setBatches((b) => b.filter((x) => x.id !== newestBatch)), FX_MS);
  }, [newestBatch]);
  const fxByCell = new Map<number, Fx>();
  for (const b of batches) for (const f of b.items) fxByCell.set(f.cell, f);

  const pathSet = new Set(path.slice(1));
  const lockedSet = new Set(locked);

  return (
    <div ref={viewportRef} className="relative w-full overflow-auto rounded-lg" style={{ maxHeight: "calc(100dvh - 5rem)" }}>
      <div
        className="mx-auto"
        style={{
          containerType: "inline-size",
          // Fit the screen when cells stay big enough; otherwise grow and scroll.
          width: `max(min(100%, calc(100dvh - 5rem)), ${size * MIN_CELL_PX + 6}px)`,
          // Room above the top row for pieces' heads.
          paddingTop: "14px",
        }}
      >
        <div
          ref={gridRef}
          className="relative grid w-full select-none"
          style={{
            border: `3px solid ${EDGE_COLOR}`,
            boxShadow: `0 0 0 1px #000, 0 0 14px ${EDGE_COLOR}55`,
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            fontSize: `calc(100cqw / ${size} * 0.58)`,
            gap: "1px",
            background: "#05080b",
          }}
        >
          {cells.map((cell, i) => {
            const clickable = highlights.get(i);
            const hl = clickable === "step" || clickable === "target" ? clickable : undefined;
            const fx = fxByCell.get(i);
            const icon = cell.f ? FEATURE_ICON[cell.f] : TERRAIN_ICON[cell.t];
            const sway = cell.t === "forest" && !cell.f;
            const base = fx && fx.kind !== "reveal" ? fx.from : cellBg(cell, i, mode);
            return (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                disabled={!clickable}
                onClick={() => onCellClick(i)}
                className={`relative flex aspect-square items-center justify-center leading-none ${
                  clickable ? "cursor-pointer hover:brightness-150" : "cursor-default"
                } ${cell.t === "river" ? "zh-river" : ""}`}
                style={{
                  background: cell.t === "river" && cell.o < 0 ? undefined : base,
                  boxShadow: hl ? `inset 0 0 0 2px ${hl === "step" ? "#f0b43c" : "#f7c964"}` : undefined,
                }}
              >
                {fx && fx.kind !== "reveal" && (
                  <span
                    className={`absolute inset-0 ${fx.kind === "splat" ? "zh-splat" : "zh-fill"}`}
                    style={{ background: fx.to, animationDelay: `${fx.delay}ms` }}
                  />
                )}
                {cell.t !== "unknown" && (
                  <>
                    {icon && (
                      <span className={`relative ${sway ? "zh-sway" : ""}`} style={sway ? { animationDelay: `${-(hash(i) % 30) / 10}s` } : undefined}>
                        {icon}
                      </span>
                    )}
                    {pathSet.has(i) && <span className="absolute h-[22%] w-[22%] rounded-full bg-white/80" />}
                    {lockedSet.has(i) && <span className="absolute right-0 top-0 text-[0.45em]">🛡️</span>}
                  </>
                )}
                {fx?.kind === "reveal" && (
                  <span className="zh-unfog absolute inset-0" style={{ background: fx.from, animationDelay: `${fx.delay}ms` }} />
                )}
                {hl && <span className="absolute inset-[30%] rounded-full bg-lamp/40" />}
                {clickable === "line" && <span className="absolute inset-[38%] rounded-full bg-lamp/30" />}
              </button>
            );
          })}
          <PieceLayer size={size} mode={mode} players={players} actorId={actorId} remaining={remaining} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces live in their own layer over the grid so they can glide and hop
// between cells instead of teleporting.

function PieceLayer({
  size,
  mode,
  players,
  actorId,
  remaining,
}: {
  size: number;
  mode: GameMode;
  players: Player[];
  actorId: string | null;
  remaining: number | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {players
        .filter((p) => p.pos >= 0)
        .map((p) => (
          <Piece
            key={p.id}
            player={p}
            size={size}
            mode={mode}
            active={p.id === actorId}
            remaining={p.id === actorId ? remaining : null}
          />
        ))}
    </div>
  );
}

function Piece({
  player,
  size,
  mode,
  active,
  remaining,
}: {
  player: Player;
  size: number;
  mode: GameMode;
  active: boolean;
  remaining: number | null;
}) {
  // Which way it last moved: drives facing, eye direction and lean.
  const [last, setLast] = useState({ pos: player.pos, dir: [0, 1] as [number, number], hops: 0 });
  if (last.pos !== player.pos) {
    const dx = (player.pos % size) - (last.pos % size);
    const dy = Math.floor(player.pos / size) - Math.floor(last.pos / size);
    const adjacent = Math.abs(dx) + Math.abs(dy) === 1;
    setLast({ pos: player.pos, dir: adjacent ? [dx, dy] : last.dir, hops: last.hops + 1 });
  }
  const x = player.pos % size;
  const y = Math.floor(player.pos / size);
  const color = colorHex(mode, player.color);
  const label = mode === "teams" ? String(player.number) : player.name.slice(0, 1);

  return (
    <div
      className="absolute"
      style={{
        // The grid has 1px gaps: each cell pitch is (width + 1px) / size.
        left: `calc((100% + 1px) * ${x} / ${size})`,
        top: `calc((100% + 1px) * ${y} / ${size})`,
        width: `calc((100% + 1px) / ${size} - 1px)`,
        height: `calc((100% + 1px) / ${size} - 1px)`,
        transition: "left 0.2s ease-in-out, top 0.2s ease-in-out",
        zIndex: 10 + y,
      }}
      title={player.name}
    >
      {/* ground shadow, squeezes while airborne */}
      <span key={`s${last.hops}`} className="zh-shadow absolute bottom-[4%] left-[18%] h-[22%] w-[64%] rounded-[50%] bg-black/55" />
      {active && <span className="zh-ring absolute bottom-[-2%] left-[6%] h-[30%] w-[88%] rounded-[50%] border-2 border-lamp" />}
      {/* landing dust */}
      {last.hops > 0 && (
        <span key={`d${last.hops}`} className="zh-dust absolute bottom-0 left-1/2 h-[40%] w-[120%] -translate-x-1/2">
          <span className="absolute bottom-0 left-[5%] h-[35%] w-[35%] rounded-full bg-white/50" />
          <span className="absolute bottom-0 right-[5%] h-[35%] w-[35%] rounded-full bg-white/50" />
        </span>
      )}
      {player.cave ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <CaveIcon size="1.5em" />
          <span className="absolute right-0 top-0 h-[34%] w-[34%] rounded-full border border-black" style={{ background: color }} />
        </span>
      ) : (
        <span key={`h${last.hops}`} className={`absolute bottom-[8%] left-[-20%] h-[150%] w-[140%] ${last.hops > 0 ? "zh-hop" : ""}`}>
          <span
            className="zh-idle block h-full w-full"
            style={{ rotate: `${last.dir[0] * 6}deg`, animationDelay: `${-(player.number % 4) * 0.35}s` }}
          >
            <Character color={color} label={label} dir={last.dir} />
          </span>
        </span>
      )}
      {remaining !== null && remaining > 0 && (
        <span
          className="zh-bubble absolute left-1/2 top-[-125%] -translate-x-1/2 whitespace-nowrap rounded-full border border-black/60 bg-lamp px-[0.4em] py-[0.05em] font-black leading-tight text-black shadow"
          style={{ fontSize: "0.8em" }}
        >
          あと{remaining}
        </span>
      )}
    </div>
  );
}

export default memo(MapGrid);
