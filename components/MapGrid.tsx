"use client";

import { memo } from "react";
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
}

function MapGrid({ size, cells, mode, players, actorId, path, locked, highlights, onCellClick }: Props) {
  const pieceAt = new Map<number, Player>();
  for (const p of players) if (p.pos >= 0 && (!pieceAt.has(p.pos) || p.id === actorId)) pieceAt.set(p.pos, p);
  const pathSet = new Set(path.slice(1));
  const lockedSet = new Set(locked);

  return (
    <div className="mx-auto w-full" style={{ containerType: "inline-size", maxWidth: "max(20rem, calc(100dvh - 2rem))" }}>
      <div
        className="grid w-full select-none overflow-hidden rounded-lg border border-white/10"
        style={{
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
