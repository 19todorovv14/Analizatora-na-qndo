/*
 * Squarified treemap (Bruls, Huizing & van Wijk 2000) + the heatmap's diverging colour scale.
 * Pure functions — unit-tested in __tests__/treemap.test.ts.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Placed<T> = Rect & { item: T };

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number): number {
  if (!row.length || side <= 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of row) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/**
 * Lays `items` into `rect` with areas proportional to `value(item)`. Items with a non-positive or
 * non-finite value are skipped. Input order is kept for equal values; the largest item goes first
 * (top-left). Returns rectangles that exactly tile `rect` (up to floating point).
 */
export function squarify<T>(items: T[], rect: Rect, value: (item: T) => number): Placed<T>[] {
  const valid = items
    .map((item, i) => ({ item, v: value(item), i }))
    .filter((x) => Number.isFinite(x.v) && x.v > 0)
    .sort((a, b) => b.v - a.v || a.i - b.i);
  if (!valid.length || rect.w <= 0 || rect.h <= 0) return [];
  const total = valid.reduce((s, x) => s + x.v, 0);
  const scale = (rect.w * rect.h) / total;
  const nodes = valid.map((x) => ({ item: x.item, area: x.v * scale }));

  const out: Placed<T>[] = [];
  let free: Rect = { ...rect };
  let row: typeof nodes = [];

  const layoutRow = (r: typeof nodes, area: Rect): Rect => {
    const sum = r.reduce((s, n) => s + n.area, 0);
    if (area.w >= area.h) {
      // vertical strip on the left
      const stripW = area.h > 0 ? sum / area.h : 0;
      let y = area.y;
      r.forEach((n, i) => {
        const h = i === r.length - 1 ? area.y + area.h - y : stripW > 0 ? n.area / stripW : 0;
        out.push({ item: n.item, x: area.x, y, w: stripW, h });
        y += h;
      });
      return { x: area.x + stripW, y: area.y, w: Math.max(0, area.w - stripW), h: area.h };
    }
    // horizontal strip on top
    const stripH = area.w > 0 ? sum / area.w : 0;
    let x = area.x;
    r.forEach((n, i) => {
      const w = i === r.length - 1 ? area.x + area.w - x : stripH > 0 ? n.area / stripH : 0;
      out.push({ item: n.item, x, y: area.y, w, h: stripH });
      x += w;
    });
    return { x: area.x, y: area.y + stripH, w: area.w, h: Math.max(0, area.h - stripH) };
  };

  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(free.w, free.h);
    const n = nodes[i];
    const withN = [...row.map((r) => r.area), n.area];
    if (!row.length || worst(withN, side) <= worst(row.map((r) => r.area), side)) {
      row.push(n);
      i++;
    } else {
      free = layoutRow(row, free);
      row = [];
    }
  }
  if (row.length) layoutRow(row, free);
  return out;
}

/* ─────────────────────────────────────────────────────── grouped layout */

export type GroupBox<T> = Rect & { key: string; label: string; total: number; tiles: Placed<T>[]; header: number };

/**
 * Two-level treemap: groups (e.g. sectors) are squarified first, then the tiles inside each group.
 * A group big enough gets a `headerH` label strip; tiles get `gap` px of inner spacing.
 */
export function layoutGroups<T>(
  items: T[],
  rect: Rect,
  opts: { value: (item: T) => number; group: (item: T) => string; headerH?: number; gap?: number; minHeaderW?: number; minHeaderH?: number },
): GroupBox<T>[] {
  const headerH = opts.headerH ?? 18;
  const gap = opts.gap ?? 2;
  const minHeaderW = opts.minHeaderW ?? 90;
  const minHeaderH = opts.minHeaderH ?? 70;
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const v = opts.value(it);
    if (!Number.isFinite(v) || v <= 0) continue;
    const k = opts.group(it) || "Other";
    const list = groups.get(k);
    if (list) list.push(it);
    else groups.set(k, [it]);
  }
  const gs = Array.from(groups.entries()).map(([key, list]) => ({ key, list, total: list.reduce((s, it) => s + opts.value(it), 0) }));
  const boxes = squarify(gs, rect, (g) => g.total);
  return boxes.map((b) => {
    const showHeader = gs.length > 1 && b.w >= minHeaderW && b.h >= minHeaderH;
    const header = showHeader ? headerH : 0;
    const inner: Rect = { x: b.x + gap / 2, y: b.y + header + gap / 2, w: Math.max(0, b.w - gap), h: Math.max(0, b.h - header - gap) };
    const tiles = squarify(b.item.list, inner, opts.value).map((t) => ({
      ...t,
      x: t.x + gap / 2,
      y: t.y + gap / 2,
      w: Math.max(0, t.w - gap),
      h: Math.max(0, t.h - gap),
    }));
    return { key: b.item.key, label: b.item.key, total: b.item.total, x: b.x, y: b.y, w: b.w, h: b.h, tiles, header };
  });
}

/* ──────────────────────────────────────────────────────── colour scale */

// Mirrors the design tokens (app/globals.css): --color-down #f2555c, --color-up #22c79e, a neutral slate.
const DOWN = [242, 85, 92];
const UP = [34, 199, 158];
const NEUTRAL = [44, 54, 74];

/**
 * Symmetric scale limit for the colour of ±change: the 85th percentile of |change|, clamped to
 * [minLimit, maxLimit] so a single outlier does not wash out every other tile.
 */
export function colorLimit(changes: (number | null | undefined)[], minLimit = 1, maxLimit = 10): number {
  const abs = changes.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map((v) => Math.abs(v));
  if (!abs.length) return minLimit;
  abs.sort((a, b) => a - b);
  const p = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.85))];
  return Math.max(minLimit, Math.min(maxLimit, p));
}

/** Diverging colour for a % change: red ← slate → green, saturating at ±limit. Null → muted slate. */
export function heatColor(change: number | null | undefined, limit: number): string {
  if (typeof change !== "number" || !Number.isFinite(change)) return "rgb(36,42,56)";
  const t = Math.max(-1, Math.min(1, change / (limit > 0 ? limit : 1)));
  const target = t >= 0 ? UP : DOWN;
  // ease-out so small moves are already visibly tinted
  const k = Math.sqrt(Math.abs(t)) * 0.82;
  const mix = NEUTRAL.map((c, i) => Math.round(c + (target[i] - c) * k));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

/** Legend stops (left → right) for a given limit. */
export function legendStops(limit: number, steps = 7): { value: number; color: string }[] {
  const n = Math.max(3, steps);
  return Array.from({ length: n }, (_, i) => {
    const value = -limit + (2 * limit * i) / (n - 1);
    return { value, color: heatColor(value, limit) };
  });
}
