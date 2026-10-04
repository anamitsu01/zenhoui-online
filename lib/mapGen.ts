import type { Terrain } from "./types";

/**
 * Terrain that reads like a real map:
 * - mountains: a few ranges (ridges that wander and sometimes thicken) plus lone peaks
 * - rivers: one cell wide and unbroken, rising beside a mountain and flowing to the
 *   board edge (or into another river)
 * - forests: compact patches, smoothed so there are no stray single trees or holes
 * - glaciers: only along the board's outer band, never in the middle
 * Starting areas (radius 2 around each base) stay open plain.
 *
 * Returns null when this attempt painted itself into a corner; the caller retries.
 */
export function generateTerrain(size: number, bases: number[]): Terrain[] | null {
  const n = size * size;
  const t: Terrain[] = Array(n).fill("plain");
  const X = (i: number) => i % size;
  const Y = (i: number) => Math.floor(i / size);
  const at = (x: number, y: number) => y * size + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
  const rand = (k: number) => Math.floor(Math.random() * k);
  const baseDist = (i: number) => Math.min(...bases.map((b) => Math.max(Math.abs(X(b) - X(i)), Math.abs(Y(b) - Y(i)))));
  const edgeDist = (i: number) => Math.min(X(i), Y(i), size - 1 - X(i), size - 1 - Y(i));
  const nb4 = (i: number) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .filter(([dx, dy]) => inside(X(i) + dx, Y(i) + dy))
      .map(([dx, dy]) => at(X(i) + dx, Y(i) + dy));
  const nb8 = (i: number) => {
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inside(X(i) + dx, Y(i) + dy)) out.push(at(X(i) + dx, Y(i) + dy));
    return out;
  };
  const weighted = <T,>(items: [T, number][]): T | undefined => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return undefined;
    let r = Math.random() * total;
    for (const [v, w] of items) if ((r -= w) < 0) return v;
    return items[items.length - 1][0];
  };
  // Keep terrain out of the starting areas (and a margin for rivers).
  const open = (i: number, margin: number) => baseDist(i) > margin;

  // --- Mountains -----------------------------------------------------------
  const DIRS8: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const ranges = Math.max(2, Math.round(size / 8));
  for (let r = 0; r < ranges; r++) {
    let x = 0,
      y = 0;
    for (let tries = 0; tries < 50; tries++) {
      x = rand(size);
      y = rand(size);
      if (open(at(x, y), 4)) break;
    }
    let d = rand(8);
    const length = Math.round(size * 0.22) + rand(Math.round(size * 0.2));
    for (let s = 0; s < length && inside(x, y); s++) {
      const i = at(x, y);
      if (open(i, 3)) {
        t[i] = "mountain";
        // Ridges thicken here and there.
        if (Math.random() < 0.3) {
          const side = nb4(i).filter((c) => open(c, 3));
          if (side.length) t[side[rand(side.length)]] = "mountain";
        }
      }
      if (Math.random() < 0.3) d = (d + (Math.random() < 0.5 ? 1 : 7)) % 8; // gentle bends
      x += DIRS8[d][0];
      y += DIRS8[d][1];
    }
  }
  const peaks = Math.round(size / 5);
  for (let p = 0; p < peaks; p++) {
    const i = rand(n);
    if (open(i, 3) && t[i] === "plain") t[i] = "mountain";
  }

  // --- Rivers --------------------------------------------------------------
  const isRiver = (i: number) => t[i] === "river";
  function carveRiver(): boolean {
    // Spring: a plain cell next to a mountain, away from the starting areas.
    const springs = [];
    for (let i = 0; i < n; i++) {
      if (t[i] === "plain" && open(i, 4) && edgeDist(i) >= Math.round(size * 0.25) && nb4(i).some((c) => t[c] === "mountain")) springs.push(i);
    }
    if (!springs.length) return false;
    const start = springs[rand(springs.length)];
    // Flow toward the nearest edge, with some freedom to wander.
    const toEdge: [number, number][] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const distTo = [X(start), size - 1 - X(start), Y(start), size - 1 - Y(start)];
    const order = [0, 1, 2, 3].sort((a, b) => distTo[a] - distTo[b]);
    const main = toEdge[Math.random() < 0.75 ? order[0] : order[1]];

    const path = [start];
    const onPath = new Set(path);
    let last: [number, number] = main;
    // Drift to one side, switching only now and then, so the river winds
    // instead of zig-zagging back and forth.
    let drift: [number, number] = main[0] === 0 ? [Math.random() < 0.5 ? 1 : -1, 0] : [0, Math.random() < 0.5 ? 1 : -1];
    for (let step = 0; step < size * 3; step++) {
      const cur = path[path.length - 1];
      if (edgeDist(cur) === 0) break;
      if (Math.random() < 0.08) drift = [-drift[0], -drift[1]];
      const options: [number, number][] = [];
      for (const [dx, dy] of toEdge) {
        if (dx === -main[0] && dy === -main[1]) continue; // never flow back uphill
        const nx = X(cur) + dx;
        const ny = Y(cur) + dy;
        if (!inside(nx, ny)) continue;
        const c = at(nx, ny);
        if (onPath.has(c) || t[c] === "mountain" || !open(c, 3)) continue;
        // Stay one cell wide: the new cell may touch only the current cell (or join another river).
        const touches = nb4(c).filter((o) => o !== cur && (onPath.has(o) || isRiver(o)));
        if (touches.length && !isRiver(c)) continue;
        let w = dx === main[0] && dy === main[1] ? 5 : dx === drift[0] && dy === drift[1] ? 2.5 : 0.15;
        if (dx === last[0] && dy === last[1] && w > 1) w += 1.5; // momentum makes smooth bends
        if (isRiver(c)) w += 20; // a confluence
        options.push([c, w]);
      }
      const next = weighted(options.map(([c, w]) => [c, w] as [number, number]));
      if (next === undefined) return false;
      last = [X(next) - X(cur), Y(next) - Y(cur)];
      if (isRiver(next)) break; // joined another river
      path.push(next);
      onPath.add(next);
    }
    if (edgeDist(path[path.length - 1]) !== 0 && !nb4(path[path.length - 1]).some(isRiver)) return false;
    if (path.length < Math.round(size * 0.35)) return false;
    for (const c of path) t[c] = "river";
    return true;
  }
  const riverCount = size >= 25 ? 2 : 1;
  let rivers = 0;
  for (let tries = 0; tries < 60 && rivers < riverCount; tries++) if (carveRiver()) rivers++;
  if (rivers === 0) return null;

  // --- Forests -------------------------------------------------------------
  const forestGoal = Math.round(n * 0.14);
  let forest = 0;
  for (let guard = 0; forest < forestGoal && guard < 600; guard++) {
    const seed = rand(n);
    // New patches start apart from existing ones so they don't merge into one mass.
    if (t[seed] !== "plain" || !open(seed, 2) || nb8(seed).some((c) => t[c] === "forest")) continue;
    const target = 5 + rand(10);
    const patch = new Set([seed]);
    t[seed] = "forest";
    forest++;
    while (patch.size < target) {
      // Grow where the patch is densest, which keeps it compact and round-ish.
      const frontier = new Map<number, number>();
      for (const p of patch)
        for (const c of nb4(p)) {
          if (t[c] !== "plain" || !open(c, 2)) continue;
          if (nb8(c).some((o) => t[o] === "forest" && !patch.has(o))) continue; // keep a gap to other patches
          frontier.set(c, nb8(c).filter((o) => t[o] === "forest").length);
        }
      const next = weighted([...frontier].map(([c, k]) => [c, k * k + 0.5] as [number, number]));
      if (next === undefined) break;
      t[next] = "forest";
      patch.add(next);
      forest++;
    }
  }
  // Smooth: fill clearings that are almost surrounded, drop stray lone trees.
  const snapshot = t.slice();
  for (let i = 0; i < n; i++) {
    const around = nb8(i).filter((c) => snapshot[c] === "forest").length;
    if (snapshot[i] === "plain" && around >= 7 && open(i, 2)) t[i] = "forest";
    if (snapshot[i] === "forest" && nb4(i).every((c) => snapshot[c] !== "forest")) t[i] = "plain";
  }

  // --- Glaciers (outer band only) -------------------------------------------
  const band = Math.max(2, Math.round(size * 0.12));
  const glacierGoal = Math.round(n * 0.04);
  let glacier = 0;
  for (let guard = 0; glacier < glacierGoal && guard < 100; guard++) {
    // Seed on the very edge, most often near the corners.
    const edgeCells: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (edgeDist(i) !== 0 || t[i] !== "plain" || !open(i, 4)) continue;
      const corner = Math.min(X(i), size - 1 - X(i)) + Math.min(Y(i), size - 1 - Y(i));
      edgeCells.push([i, 1 + 6 / (1 + corner)]);
    }
    const seed = weighted(edgeCells);
    if (seed === undefined) break;
    const target = 4 + rand(8);
    const sheet = new Set([seed]);
    t[seed] = "glacier";
    glacier++;
    while (sheet.size < target) {
      const frontier: [number, number][] = [];
      for (const p of sheet)
        for (const c of nb4(p)) {
          if (t[c] !== "plain" || !open(c, 4) || edgeDist(c) > band) continue;
          const packed = nb8(c).filter((o) => sheet.has(o)).length;
          frontier.push([c, (band + 1 - edgeDist(c)) * (1 + packed * packed)]); // hug the edge, stay compact
        }
      const next = weighted(frontier);
      if (next === undefined) break;
      t[next] = "glacier";
      sheet.add(next);
      glacier++;
    }
  }

  return t;
}
