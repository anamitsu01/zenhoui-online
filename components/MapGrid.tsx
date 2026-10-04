"use client";

import { memo, useEffect, useRef } from "react";
import { colorHex, withAlpha } from "@/lib/colors";
import type { Cell, GameMode, Player, Terrain } from "@/lib/types";
import CaveIcon from "./CaveIcon";

const TERRAIN_BG: Record<Terrain, string> = {
  plain: "#1c2733",
  forest: "#173d2a",
  mountain: "#57524c",
  river: "#1f5a8f",
  bridge: "#6b4f2a",
  glacier: "#d7ecf5",
  unknown: "#06090d",
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

/** step/target are drawn; "any" is clickable without an outline (e.g. scouting anywhere). */
export type HighlightKind = "step" | "target" | "any";

interface Props {
  size: number;
  cells: Cell[];
  mode: GameMode;
  players: Player[];
  actorId: string | null;
  path: number[];
  locked: number[];
  highlights: Map<number, HighlightKind>;
  onCellClick: (cell: number) => void;
  /** Keep this cell in view (scrolls when it nears the edge of the visible area). */
  focusCell: number;
  /** Changing this re-centers on focusCell. */
  recenterKey: number;
}

function MapGrid({ size, cells, mode, players, actorId, path, locked, highlights, onCellClick, focusCell, recenterKey }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Scroll the viewport (never the page) so the focused cell is visible.
  // A re-center request always centers; otherwise only scroll when the cell
  // gets within a couple of cells of the visible edge.
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
    // Cell position in the viewport's scrollable content.
    const x = cr.left - vr.left + vx;
    const y = cr.top - vr.top + vy;
    const w = cr.width;
    const margin = w * 3;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const outside = x < vx + margin || x + w > vx + vw - margin || y < vy + margin || y + w > vy + vh - margin;
    if (center || outside) {
      viewport.scrollTo({ left: x - vw / 2 + w / 2, top: y - vh / 2 + w / 2, behavior: center ? "auto" : "smooth" });
    }
  }, [focusCell, recenterKey]);

  const pieceAt = new Map<number, Player>();
  for (const p of players) if (p.pos >= 0 && (!pieceAt.has(p.pos) || p.id === actorId)) pieceAt.set(p.pos, p);
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
          const piece = pieceAt.get(i);
          const clickable = highlights.get(i);
          const hl = clickable === "any" ? undefined : clickable;
          const owner = cell.o >= 0 ? colorHex(mode, cell.o) : null;
          const icon = cell.f ? FEATURE_ICON[cell.f] : TERRAIN_ICON[cell.t];
          const bg = owner ? withAlpha(owner, 0.62) : TERRAIN_BG[cell.t];
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              disabled={!clickable}
              onClick={() => onCellClick(i)}
              className={`relative flex aspect-square items-center justify-center leading-none ${
                clickable ? "cursor-pointer hover:brightness-150" : "cursor-default"
              }`}
              style={{
                background: bg,
                boxShadow: hl ? `inset 0 0 0 2px ${hl === "step" ? "#f0b43c" : "#f7c964"}` : undefined,
              }}
            >
              {cell.t === "unknown" ? null : (
                <>
                  {icon && <span>{icon}</span>}
                  {cell.t === "river" && <span className="text-[0.7em] text-white/35">≈</span>}
                  {pathSet.has(i) && !piece && <span className="absolute h-[22%] w-[22%] rounded-full bg-white/80" />}
                  {lockedSet.has(i) && <span className="absolute right-0 top-0 text-[0.45em]">🛡️</span>}
                </>
              )}
              {hl && !piece && <span className="absolute inset-[30%] rounded-full bg-lamp/40" />}
              {piece && <Piece player={piece} mode={mode} active={piece.id === actorId} />}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function Piece({ player, mode, active }: { player: Player; mode: GameMode; active: boolean }) {
  return (
    <span
      className={`absolute inset-[8%] z-10 flex items-center justify-center rounded-full border-2 font-black text-white ${
        active ? "zh-pulse border-lamp" : "border-white/90"
      }`}
      style={{ background: colorHex(mode, player.color), fontSize: "0.85em" }}
      title={player.name}
    >
      {player.cave ? <CaveIcon /> : mode === "teams" ? player.number : player.name.slice(0, 1)}
    </span>
  );
}

export default memo(MapGrid);
