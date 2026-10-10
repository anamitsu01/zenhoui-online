import type { GameMode } from "./types";

// Territory colors. Kept clear of the amber UI accent so a team color never
// reads as a button or highlight.
const TEAM_HEX = ["#3b82f6", "#ef4444"]; // 青, 赤
const FFA_HEX = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#ec4899"]; // 赤, 青, 緑, 紫, 桃

export function colorHex(mode: GameMode, color: number): string {
  return (mode === "teams" ? TEAM_HEX : FFA_HEX)[color] ?? "#9ca3af";
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
