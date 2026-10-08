/* Unit tests for the squarified treemap + heatmap colour scale (components/market/treemap.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { colorLimit, heatColor, layoutGroups, legendStops, squarify, type Rect } from "../treemap";
import type { HeatmapTile } from "../types";
import { cryptoHeatmap } from "./fixtures";

const EPS = 1e-6;
const area = (r: Rect) => r.w * r.h;

function assertTiling(rects: Rect[], bounds: Rect) {
  const total = rects.reduce((s, r) => s + area(r), 0);
  assert.ok(Math.abs(total - area(bounds)) < 1e-3 * area(bounds), `areas sum to the rect (${total} vs ${area(bounds)})`);
  for (const r of rects) {
    assert.ok(r.w >= -EPS && r.h >= -EPS);
    assert.ok(r.x >= bounds.x - EPS && r.y >= bounds.y - EPS, "inside (top-left)");
    assert.ok(r.x + r.w <= bounds.x + bounds.w + 1e-6 && r.y + r.h <= bounds.y + bounds.h + 1e-6, "inside (bottom-right)");
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(ox <= 1e-6 || oy <= 1e-6, `rects ${i} and ${j} do not overlap`);
    }
}

describe("squarify", () => {
  const bounds = { x: 0, y: 0, w: 600, h: 400 };

  test("tiles the rectangle exactly, areas proportional to values", () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const out = squarify(values, bounds, (v) => v);
    assert.equal(out.length, values.length);
    assertTiling(out, bounds);
    const total = values.reduce((a, b) => a + b, 0);
    for (const p of out) assert.ok(Math.abs(area(p) - (p.item / total) * area(bounds)) < 1e-6 * area(bounds));
  });

  test("the classic example keeps aspect ratios reasonable", () => {
    const out = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 6, h: 4 }, (v) => v);
    const worst = Math.max(...out.map((r) => Math.max(r.w / r.h, r.h / r.w)));
    assert.ok(worst < 3, `worst aspect ratio ${worst.toFixed(2)}`);
  });

  test("largest item first (top-left), zero / negative / NaN values skipped", () => {
    const out = squarify([1, 0, -5, Number.NaN, 10, 3], bounds, (v) => v);
    assert.deepEqual(out.map((p) => p.item), [10, 3, 1]);
    assert.equal(out[0].x, 0);
    assert.equal(out[0].y, 0);
    assertTiling(out, bounds);
  });

  test("edge cases", () => {
    assert.deepEqual(squarify([], bounds, (v: number) => v), []);
    assert.deepEqual(squarify([1, 2], { x: 0, y: 0, w: 0, h: 100 }, (v) => v), []);
    const one = squarify([5], { x: 10, y: 20, w: 50, h: 30 }, (v) => v);
    assert.deepEqual({ x: one[0].x, y: one[0].y, w: one[0].w, h: one[0].h }, { x: 10, y: 20, w: 50, h: 30 });
  });

  test("many tiny values next to a huge one still tile", () => {
    const vals = [1e9, ...Array.from({ length: 120 }, (_, i) => 1e5 + i)];
    const out = squarify(vals, bounds, (v) => v);
    assert.equal(out.length, vals.length);
    assertTiling(out, bounds);
  });
});

describe("layoutGroups (real heatmap payload)", () => {
  const tiles = cryptoHeatmap.tiles;
  const bounds = { x: 0, y: 0, w: 1100, h: 440 };
  const groups = layoutGroups<HeatmapTile>(tiles, bounds, { value: (t) => t.size, group: (t) => t.group || "Other" });

  test("one box per sector, every tile placed exactly once", () => {
    const sectors = new Set(tiles.map((t) => t.group || "Other"));
    assert.equal(groups.length, sectors.size);
    const placed = groups.flatMap((g) => g.tiles.map((t) => t.item.symbol)).sort();
    assert.deepEqual(placed, tiles.map((t) => t.symbol).sort());
    assertTiling(groups, bounds);
  });

  test("tiles stay inside their group (below the header strip)", () => {
    for (const g of groups) {
      for (const t of g.tiles) {
        assert.ok(t.x >= g.x - EPS && t.x + t.w <= g.x + g.w + EPS);
        assert.ok(t.y >= g.y + g.header - EPS && t.y + t.h <= g.y + g.h + EPS);
      }
    }
  });

  test("group area follows the summed size (volume basis)", () => {
    const total = tiles.reduce((s, t) => s + t.size, 0);
    for (const g of groups) {
      const share = g.total / total;
      assert.ok(Math.abs(area(g) / area(bounds) - share) < 1e-6);
    }
  });

  test("headers only for groups that are big enough", () => {
    const small = layoutGroups<HeatmapTile>(tiles, { x: 0, y: 0, w: 200, h: 120 }, { value: (t) => t.size, group: (t) => t.group || "Other", minHeaderW: 150, minHeaderH: 100 });
    assert.ok(small.every((g) => g.header === 0 || (g.w >= 150 && g.h >= 100)));
  });
});

describe("colour scale", () => {
  test("limit = 85th percentile of |change|, clamped", () => {
    assert.equal(colorLimit([]), 1);
    assert.equal(colorLimit([0.1, -0.2, null]), 1);
    assert.equal(colorLimit([50, -60, 70, 80]), 10);
    const l = colorLimit(cryptoHeatmap.tiles.map((t) => t.change_24h_pct));
    assert.ok(l >= 1 && l <= 10);
  });

  test("diverging: red for losses, green for gains, neutral near zero, saturates at the limit", () => {
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const [r1, g1] = rgb(heatColor(5, 5));
    const [r2, g2] = rgb(heatColor(-5, 5));
    const [r0, g0, b0] = rgb(heatColor(0, 5));
    assert.ok(g1 > r1, "gain is green");
    assert.ok(r2 > g2, "loss is red");
    assert.ok(Math.abs(r0 - g0) < 20 && b0 >= r0, "zero is slate");
    assert.equal(heatColor(50, 5), heatColor(5, 5), "saturates");
    assert.equal(heatColor(null, 5), "rgb(36,42,56)");
    assert.notEqual(heatColor(1, 5), heatColor(2, 5), "monotonic tint");
  });

  test("legend stops are symmetric", () => {
    const stops = legendStops(4, 5);
    assert.deepEqual(stops.map((s) => s.value), [-4, -2, 0, 2, 4]);
    assert.equal(stops[2].color, heatColor(0, 4));
  });
});
