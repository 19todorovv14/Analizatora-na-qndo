export type Tool = "cursor" | "crosshair" | "trend" | "hline" | "ray" | "rect" | "text" | "measure" | "fib" | "position";

export type DPoint = { time: number; price: number };

export type DrawingType = "trend" | "hline" | "ray" | "rect" | "text" | "fib" | "position";

/**
 * A chart drawing anchored to (time, price) points, so it survives timeframe changes.
 * - trend / ray / rect / fib: p1 → p2
 * - hline / text: p1 only
 * - position (long/short planning box): p1 = entry (time, price), p2 = (box end time, STOP price),
 *   p3 = target (defaults to 2R when absent). Side: stop below entry → LONG, above → SHORT.
 */
export type Drawing = {
  id: string;
  type: DrawingType;
  p1: DPoint;
  p2?: DPoint;
  p3?: DPoint;
  text?: string;
  color: string;
};

/**
 * Tool catalogue. The first 8 keep their labels: the toolbar buttons have `title="<label> — <help>"`
 * (the walkthrough selects `button[title^="Horizontal line"]` / `button[title^="Cursor"]`).
 */
export const TOOL_INFO: { key: Tool; label: string; icon: string; help: string }[] = [
  { key: "cursor", label: "Cursor", icon: "↖", help: "Местене и мащабиране на графиката. Кликни върху рисунка, за да я избереш (Delete я трие)." },
  { key: "crosshair", label: "Crosshair", icon: "✛", help: "Кръстче, което показва точната цена и време." },
  { key: "trend", label: "Trend line", icon: "╱", help: "Линия между две точки — свържи дъна в uptrend или върхове в downtrend." },
  { key: "hline", label: "Horizontal line", icon: "―", help: "Хоризонтално ниво — support или resistance." },
  { key: "ray", label: "Ray", icon: "↗", help: "Лъч от точка през втора точка, продължен надясно." },
  { key: "rect", label: "Rectangle", icon: "▭", help: "Зона — ценовите нива са зони, не точни линии." },
  { key: "text", label: "Text", icon: "T", help: "Бележка върху графиката." },
  { key: "measure", label: "Measure", icon: "⇕", help: "Измерва разлика в цена, %, брой свещи и време между две точки." },
  {
    key: "fib",
    label: "Fib retracement",
    icon: "≡",
    help: "Нива 23.6 / 38.2 / 50 / 61.8 / 78.6 % между два swing-а (от началото към края на движението) — зони за наблюдение, не гаранции.",
  },
  {
    key: "position",
    label: "Long / Short position",
    icon: "⇅",
    help: "Плъзни от входа към stop loss-а: под входа = LONG, над входа = SHORT. Целта е 2R по подразбиране — премести я с дръжката. Само план, не пуска поръчка.",
  },
];

export const TOOL_BY_KEY: Record<Tool, (typeof TOOL_INFO)[number]> = Object.fromEntries(TOOL_INFO.map((t) => [t.key, t])) as Record<
  Tool,
  (typeof TOOL_INFO)[number]
>;

/** Single-key shortcuts of the chart terminal (Esc → cursor is handled separately). */
export const TOOL_HOTKEYS: Partial<Record<Tool, string>> = { hline: "h", trend: "t", rect: "r", measure: "m" };

export const DRAW_COLORS = ["#f5c542", "#42a5f5", "#ef5350", "#26a69a", "#ab47bc", "#d1d4dc"];

/** Tools that need two points (drag, or click + click). */
export const TWO_POINT_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["trend", "ray", "rect", "measure", "fib", "position"]);

/** Tools that capture pointer input on the chart (everything except cursor / crosshair). */
export const isDrawingTool = (t: Tool) => t !== "cursor" && t !== "crosshair";

/* ─────────────────────────────────────────────────────────── geometry */

/** Fibonacci retracement ratios drawn by the fib tool. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/**
 * Price of every retracement level for a fib drawn from p1 (start of the move) to p2 (end of the move):
 * level 0 sits at p2, level 1 at p1 (the retracement is measured back from the end of the move).
 */
export function fibLevels(p1: DPoint, p2: DPoint): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({ level, price: p2.price + (p1.price - p2.price) * level }));
}

export type PositionPlan = {
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  /** reward ÷ risk */
  rr: number;
  riskPct: number;
  rewardPct: number;
};

/** Default reward multiple of a fresh position drawing. */
export const DEFAULT_POSITION_R = 2;

/** Entry / stop / target / R:R of a position drawing (null when entry == stop). */
export function positionPlan(d: Pick<Drawing, "p1" | "p2" | "p3">): PositionPlan | null {
  if (!d.p2) return null;
  const entry = d.p1.price;
  const stop = d.p2.price;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || !(entry > 0)) return null;
  const side = stop < entry ? "long" : "short";
  const dir = side === "long" ? 1 : -1;
  let target = d.p3?.price ?? entry + dir * risk * DEFAULT_POSITION_R;
  // a target dragged through the entry is clamped to the winning side
  if ((target - entry) * dir <= 0) target = entry + dir * risk * 0.1;
  const reward = Math.abs(target - entry);
  return { side, entry, stop, target, rr: reward / risk, riskPct: (risk / entry) * 100, rewardPct: (reward / entry) * 100 };
}

/* ────────────────────────────────────────────────────────── persistence */

const DRAWING_TYPES: ReadonlySet<string> = new Set<DrawingType>(["trend", "hline", "ray", "rect", "text", "fib", "position"]);

function asPoint(v: unknown): DPoint | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { time, price } = v as { time?: unknown; price?: unknown };
  if (typeof time !== "number" || typeof price !== "number" || !Number.isFinite(time) || !Number.isFinite(price)) return undefined;
  return { time, price };
}

/**
 * Validates stored drawings (localStorage is user-editable and older versions stored fewer types):
 * unknown types, malformed points and two-point drawings without p2 are dropped.
 */
export function sanitizeDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.type !== "string" || !DRAWING_TYPES.has(r.type)) continue;
    const p1 = asPoint(r.p1);
    if (!p1) continue;
    const p2 = asPoint(r.p2);
    const type = r.type as DrawingType;
    if (type !== "hline" && type !== "text" && !p2) continue;
    let id = typeof r.id === "string" && r.id ? r.id : Math.random().toString(36).slice(2, 10);
    if (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    const d: Drawing = { id, type, p1, color: typeof r.color === "string" && r.color ? r.color : DRAW_COLORS[0] };
    if (p2) d.p2 = p2;
    const p3 = asPoint(r.p3);
    if (p3 && type === "position") d.p3 = p3;
    if (typeof r.text === "string") d.text = r.text.slice(0, 80);
    if (type === "text" && !d.text) continue;
    out.push(d);
  }
  return out;
}

const KEY = (symbol: string) => `ta-drawings:${symbol}`;

export function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(KEY(symbol));
    return raw ? sanitizeDrawings(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    if (drawings.length) window.localStorage.setItem(KEY(symbol), JSON.stringify(drawings));
    else window.localStorage.removeItem(KEY(symbol));
  } catch {
    /* storage unavailable — drawings stay in memory only */
  }
}

export const newDrawingId = () => Math.random().toString(36).slice(2, 10);

/** Point of a drawing moved by one of its edit handles (pure — used while dragging and on commit). */
export function moveHandle(d: Drawing, handle: "p1" | "p2" | "p3", pt: DPoint): Drawing {
  if (d.type === "hline") return { ...d, p1: { time: d.p1.time, price: pt.price } };
  if (d.type === "position") {
    if (handle === "p1") return { ...d, p1: pt };
    if (handle === "p2") return { ...d, p2: pt };
    // target: price only; it stays at the end of the box
    return { ...d, p3: { time: d.p2?.time ?? pt.time, price: pt.price } };
  }
  if (handle === "p1") return { ...d, p1: pt };
  if (handle === "p2" && d.p2) return { ...d, p2: pt };
  return d;
}
