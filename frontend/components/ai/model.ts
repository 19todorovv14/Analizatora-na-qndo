/*
 * Pure logic of the AI Trading Teacher UI (no React) — request building, query parsing, answer-line
 * parsing, chart overlay derivation, quiz state and strategy-view formatting. Unit-tested in
 * components/ai/__tests__/model.test.ts.
 */
import { TIMEFRAMES, TF_LABEL } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";
import type { Analysis } from "@/lib/types";

import type {
  AskRequest,
  ChartOverlay,
  ConditionCheck,
  ContextItem,
  DraftOrder,
  ExamplesSummary,
  FollowUp,
  ModeInfo,
  OverlaySetup,
  QuizQuestion,
  StrategyViewData,
  Swing,
  TeacherAnswerData,
  TeacherMode,
} from "@/components/ai/types";

/** Exact strategy-view disclaimer (the backend sends the same text in `disclaimer`). */
export const SETUP_DISCLAIMER = "This is a rule-based hypothetical setup, not a guarantee of future price movement.";

/* ───────────────────────────────────────────────────────────── modes */

export const MODE_ORDER: TeacherMode[] = ["explain", "analyze", "teach", "review_trade", "review_strategy", "quiz", "why", "compare"];

/** Built-in copy of GET /teacher/modes so the picker renders before (or without) the request. */
export const DEFAULT_MODES: ModeInfo[] = [
  {
    key: "explain",
    label: "EXPLAIN",
    icon: "MessageSquareText",
    description: "Обяснява setup-а на графиката (или твоята чернова на поръчка): правила, invalidation и риск.",
  },
  {
    key: "analyze",
    label: "ANALYZE",
    icon: "ScanSearch",
    description: "Пълен анализ: факти, правила, сценарий, invalidation, риск, алтернатива и исторически примери.",
  },
  { key: "teach", label: "TEACH ME", icon: "GraduationCap", description: "Урок по концепция с текущата графика като пример." },
  { key: "review_trade", label: "REVIEW TRADE", icon: "ClipboardCheck", description: "Разбор на затворена paper сделка: какво стана, добро, грешки, урок." },
  {
    key: "review_strategy",
    label: "REVIEW STRATEGY",
    icon: "FlaskConical",
    description: "Силни и слаби страни на стратегията, риск от overfitting и следващ тест.",
  },
  { key: "quiz", label: "QUIZ ME", icon: "ListChecks", description: "Кратък quiz според слабите ти зони + въпроси от текущата графика." },
  { key: "why", label: "WHY?", icon: "HelpCircle", description: "Защо engine-ът и стратегията стигат до това решение — стъпка по стъпка." },
  { key: "compare", label: "COMPARE", icon: "Columns2", description: "Сравнява два актива или два timeframe-а: разлики, не прогноза." },
];

export function isTeacherMode(v: unknown): v is TeacherMode {
  return typeof v === "string" && (MODE_ORDER as string[]).includes(v);
}

/** Server modes (if any) merged over the built-in list, always in MODE_ORDER and always all 8. */
export function mergeModes(remote?: ModeInfo[] | null): ModeInfo[] {
  const byKey = new Map<string, ModeInfo>();
  for (const m of remote ?? []) if (m && isTeacherMode(m.key)) byKey.set(m.key, m);
  return DEFAULT_MODES.map((d) => {
    const r = byKey.get(d.key);
    return r ? { ...d, ...r, icon: r.icon || d.icon, description: r.description || d.description, label: r.label || d.label } : d;
  });
}

/** Modes whose answer is about the current chart (symbol + timeframe). */
export function modeUsesChart(mode: TeacherMode): boolean {
  return mode !== "review_trade" && mode !== "review_strategy";
}

/** Backend default of COMPARE without a second symbol/timeframe (next higher timeframe). */
const NEXT_TF: Record<string, string> = { "1m": "15m", "5m": "1h", "15m": "1h", "30m": "4h", "1h": "4h", "4h": "1d", "1d": "1w", "1w": "1d" };
export function defaultCompareTimeframe(tf: string): string {
  return NEXT_TF[tf] ?? "4h";
}

export function tfLabel(tf: string | null | undefined): string {
  if (!tf) return "";
  return TF_LABEL[tf] ?? tf.toUpperCase();
}

export function normalizeTimeframe(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  return (TIMEFRAMES as readonly string[]).includes(t) ? t : undefined;
}

/* ─────────────────────────────────────────────────────── ask request */

export type AskParams = {
  symbol: string;
  timeframe: string;
  indicators?: string[];
  strategyId?: number | null;
  positionId?: string | null;
  backtestId?: number | null;
  compareKind?: "timeframe" | "symbol";
  compareSymbol?: string | null;
  compareTimeframe?: string | null;
  question?: string | null;
  topic?: string | null;
  draft?: DraftOrder | null;
  sessionId?: number | null;
};

const finitePos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** A draft order the backend accepts (entry > 0; stop/target/qty only when > 0), else undefined. */
export function normalizeDraft(d?: DraftOrder | null): AskRequest["draft"] | undefined {
  if (!d || !finitePos(d.entry)) return undefined;
  const side = d.side === "buy" ? "long" : d.side === "sell" ? "short" : d.side;
  if (side !== "long" && side !== "short") return undefined;
  const out: NonNullable<AskRequest["draft"]> = { side, entry: d.entry };
  if (finitePos(d.stop)) out.stop = d.stop;
  if (finitePos(d.target)) out.target = d.target;
  if (finitePos(d.qty)) out.qty = d.qty;
  return out;
}

/** Reward:risk of a draft (null when the stop/target is missing or on the wrong side of the entry). */
export function draftRR(d?: DraftOrder | null): number | null {
  const n = normalizeDraft(d);
  if (!n || n.stop === undefined || n.target === undefined) return null;
  const long = n.side === "long";
  const risk = long ? n.entry - n.stop : n.stop - n.entry;
  const reward = long ? n.target - n.entry : n.entry - n.target;
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

/** Draft form strings ("106,500.5" / "106500.5") → DraftOrder (null without a valid entry). */
export function parseDraftInputs(f: { side: "long" | "short"; entry: string; stop: string; target: string }): DraftOrder | null {
  const num = (s: string) => {
    const t = s.replace(/[\s,]/g, "");
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const entry = num(f.entry);
  if (entry === null) return null;
  return { side: f.side, entry, stop: num(f.stop), target: num(f.target) };
}

/** Closed trades → one row per position (partial closes share a position), newest first. */
export function uniquePositions<T extends { position_id: string; closed_ts: number }>(trades: T[] | undefined): T[] {
  const seen = new Set<string>();
  return [...(trades ?? [])]
    .sort((a, b) => b.closed_ts - a.closed_ts)
    .filter((t) => {
      if (seen.has(t.position_id)) return false;
      seen.add(t.position_id);
      return true;
    });
}

/** Stable identity of a draft (to tell when an explanation became stale). */
export function draftKey(d?: DraftOrder | null): string {
  const n = normalizeDraft(d);
  return n ? [n.side, n.entry, n.stop ?? "", n.target ?? ""].join("|") : "";
}

/** POST /teacher/ask body for a mode + the current page state (only the fields that mode uses). */
/** Modes that take a free-text question (GET /teacher/modes `optional`). */
export const QUESTION_MODES: TeacherMode[] = ["explain", "analyze", "teach", "why"];

export function buildAskBody(mode: TeacherMode, p: AskParams): AskRequest {
  const body: AskRequest = { mode };
  const question = p.question?.trim();
  if (question && QUESTION_MODES.includes(mode)) body.question = question.slice(0, 2000);
  if (p.sessionId) body.session_id = p.sessionId;

  if (mode === "review_trade") {
    if (p.positionId) body.position_id = p.positionId;
    return body;
  }
  if (mode === "review_strategy") {
    // reviewed on the strategy's own market (backend default) — only the strategy + optional backtest
    if (p.strategyId) body.strategy_id = p.strategyId;
    if (p.backtestId) body.backtest_id = p.backtestId;
    return body;
  }

  body.symbol = p.symbol;
  body.timeframe = p.timeframe;
  if (p.indicators?.length) body.indicators = p.indicators.slice(0, 20);
  if (p.strategyId) body.strategy_id = p.strategyId;
  if (mode === "teach" && p.topic) body.topic = p.topic;
  if (mode === "explain") {
    const draft = normalizeDraft(p.draft);
    if (draft) body.draft = draft;
  }
  if (mode === "compare") {
    if (p.compareKind === "symbol") {
      if (p.compareSymbol && p.compareSymbol !== p.symbol) body.compare_symbol = p.compareSymbol;
      else body.compare_timeframe = defaultCompareTimeframe(p.timeframe);
    } else {
      const tf = normalizeTimeframe(p.compareTimeframe);
      body.compare_timeframe = tf && tf !== p.timeframe ? tf : defaultCompareTimeframe(p.timeframe);
    }
  }
  return body;
}

const STR_KEYS = ["symbol", "timeframe", "topic", "compare_symbol", "compare_timeframe", "position_id", "question"] as const;
const NUM_KEYS = ["strategy_id", "backtest_id"] as const;

/** Request of a follow-up button: its mode + the known payload fields (+ strategy fallback). */
export function followUpRequest(f: FollowUp, base: { strategyId?: number | null; indicators?: string[] } = {}): AskRequest {
  const body: AskRequest = { mode: f.mode };
  const payload = f.payload ?? {};
  for (const k of STR_KEYS) {
    const v = payload[k];
    if (typeof v === "string" && v) (body as Record<string, unknown>)[k] = v;
  }
  for (const k of NUM_KEYS) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) (body as Record<string, unknown>)[k] = v;
  }
  if (body.strategy_id === undefined && base.strategyId && modeUsesChart(f.mode)) body.strategy_id = base.strategyId;
  if (base.indicators?.length && modeUsesChart(f.mode)) body.indicators = base.indicators.slice(0, 20);
  return body;
}

/* ───────────────────────────────────────────────── /ai query string */

export type TeacherQuery = {
  mode?: TeacherMode;
  symbol?: string;
  timeframe?: string;
  topic?: string;
  question?: string;
  strategyId?: number;
  positionId?: string;
  backtestId?: number;
  compareSymbol?: string;
  compareTimeframe?: string;
};

const posInt = (v: string | null): number | undefined => {
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 && Number.isSafeInteger(n) ? n : undefined;
};
const clean = (v: string | null, max = 80): string | undefined => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** Reads /ai?mode=&symbol=&tf=&topic=&q=&strategy_id=&position_id=&backtest_id=&compare_symbol=&compare_tf= */
export function parseTeacherQuery(search: string): TeacherQuery {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: TeacherQuery = {};
  const mode = p.get("mode")?.trim().toLowerCase().replace(/-/g, "_");
  if (isTeacherMode(mode)) out.mode = mode;
  const symbol = clean(p.get("symbol"), 40);
  if (symbol) out.symbol = symbol;
  const tf = normalizeTimeframe(p.get("tf") ?? p.get("timeframe"));
  if (tf) out.timeframe = tf;
  const topic = clean(p.get("topic"));
  if (topic && /^[a-z0-9_-]+$/i.test(topic)) out.topic = topic.toLowerCase();
  const q = clean(p.get("q"), 2000);
  if (q) out.question = q;
  const sid = posInt(p.get("strategy_id"));
  if (sid) out.strategyId = sid;
  const pos = clean(p.get("position_id"), 32);
  if (pos && /^[\w-]+$/.test(pos)) out.positionId = pos;
  const bt = posInt(p.get("backtest_id"));
  if (bt) out.backtestId = bt;
  const cs = clean(p.get("compare_symbol"), 40);
  if (cs) out.compareSymbol = cs;
  const ctf = normalizeTimeframe(p.get("compare_tf") ?? p.get("compare_timeframe"));
  if (ctf) out.compareTimeframe = ctf;
  return out;
}

/** Link to the full AI Teacher page that re-runs a request (follow-ups outside /ai). */
export function teacherHref(req: Partial<AskRequest> & { mode: TeacherMode }): string {
  const p = new URLSearchParams({ mode: req.mode });
  if (req.symbol) p.set("symbol", req.symbol);
  if (req.timeframe) p.set("tf", req.timeframe);
  if (req.topic) p.set("topic", req.topic);
  if (req.strategy_id) p.set("strategy_id", String(req.strategy_id));
  if (req.position_id) p.set("position_id", req.position_id);
  if (req.backtest_id) p.set("backtest_id", String(req.backtest_id));
  if (req.compare_symbol) p.set("compare_symbol", req.compare_symbol);
  if (req.compare_timeframe) p.set("compare_tf", req.compare_timeframe);
  if (req.question) p.set("q", req.question);
  return `/ai?${p.toString()}`;
}

/* ───────────────────────────────────────────────── answer rendering */

export type LinePart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };
export type LineMark = "pass" | "fail" | "warn" | null;
export type ParsedLine = { mark: LineMark; parts: LinePart[] };

const INTERNAL_ROUTES =
  "learn|backtesting|strategies|bots|trade|charts|replay|journal|academy|markets|ai|risk|paper|stats|performance|simulator|challenges|watchlist|dashboard|settings";
const LINK_RE = new RegExp(`(^|\\s)(\\/(?:${INTERNAL_ROUTES})(?:[/?][^\\s,;)]*)?)`, "g");

/** Splits an answer line into an optional ✓/✗ marker + text with in-app links ("→ /learn/rsi"). */
export function parseLine(line: string): ParsedLine {
  let text = line;
  let mark: LineMark = null;
  const m = /^\s*([✓✔✗✘✕⚠])️?\s*/u.exec(text);
  if (m) {
    mark = m[1] === "✓" || m[1] === "✔" ? "pass" : m[1] === "⚠" ? "warn" : "fail";
    text = text.slice(m[0].length);
  }
  const parts: LinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    let href = match[2];
    const trail = /[.:!]+$/.exec(href);
    if (trail) href = href.slice(0, -trail[0].length);
    const start = (match.index ?? 0) + match[1].length;
    // "Урок → /learn/rsi": the link chip carries its own arrow, so the textual one is dropped
    const before = text.slice(last, start).replace(/\s*→\s*$/u, " ");
    if (before.trim()) parts.push({ kind: "text", text: before });
    parts.push({ kind: "link", text: linkLabel(href), href });
    last = start + href.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return { mark, parts: parts.length ? parts : [{ kind: "text", text }] };
}

/** Human label of an in-app link inside an answer line. */
export function linkLabel(href: string): string {
  const path = href.split("?")[0];
  if (path.startsWith("/learn/") || path.startsWith("/academy/")) return "Отвори урока";
  const page: Record<string, string> = {
    "/backtesting": "Backtesting",
    "/bots": "Bot Lab",
    "/strategies": "Strategy Builder",
    "/trade": "Paper Trading",
    "/paper": "Paper Trading",
    "/replay": "Market Replay",
    "/journal": "Journal",
    "/charts": "Charts",
    "/markets": "Markets",
    "/learn": "Academy",
    "/ai": "AI Teacher",
    "/risk": "Risk",
    "/challenges": "Challenges",
  };
  const root = `/${path.split("/")[1] ?? ""}`;
  return page[path] ? `Отвори ${page[path]}` : page[root] ? `Отвори ${page[root]}` : "Отвори";
}

/** Engine pipeline stages of a WHY answer ("Market data: …" → stage + detail). */
const PIPELINE_STAGES = ["Market data", "Indicators", "Market structure", "Strategy rules", "Risk engine", "Signal"];
export function splitStage(line: string): { stage: string; detail: string } | null {
  const i = line.indexOf(":");
  if (i <= 0) return null;
  const stage = line.slice(0, i).trim();
  return PIPELINE_STAGES.includes(stage) ? { stage, detail: line.slice(i + 1).trim() } : null;
}

/**
 * WHY body → the leading run of pipeline stages (each stage once, empty "—" details made readable)
 * + the remaining reasoning lines.
 */
export function splitPipeline(lines: string[]): { steps: { stage: string; detail: string }[]; rest: string[] } {
  const steps: { stage: string; detail: string }[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (; i < lines.length; i++) {
    const st = splitStage(lines[i]);
    if (!st || seen.has(st.stage)) break;
    seen.add(st.stage);
    steps.push({ stage: st.stage, detail: st.detail && st.detail !== "—" && st.detail !== "-" ? st.detail : "няма setup за оценка" });
  }
  return { steps, rest: lines.slice(i) };
}

/** Splits text into plain runs and price/percent-like numbers (rendered tabular + emphasised). */
const NUM_RE = /[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[+\-−]?\d+\.\d+%?|[+\-−]?\d+%/g;
export function splitNumbers(text: string): { text: string; num: boolean }[] {
  const out: { text: string; num: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM_RE)) {
    const i = m.index ?? 0;
    // skip digits glued to letters/brackets (EMA(20), ATR(14), 1H) — those are names, not values
    const prev = text[i - 1];
    if (prev && /[A-Za-zА-Яа-я(]/.test(prev)) continue;
    if (i > last) out.push({ text: text.slice(last, i), num: false });
    out.push({ text: m[0], num: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), num: false });
  return out;
}

export type Accent = "info" | "violet" | "accent" | "warn" | "down" | "gold" | "up" | "neutral";

/** Subtle accent per section key — the six standard sections each have their own. */
export const SECTION_ACCENT: Record<string, Accent> = {
  observation: "info",
  rules: "violet",
  scenario: "accent",
  invalidation: "warn",
  risk: "down",
  alternative: "gold",
  why: "accent",
  examples: "violet",
  draft: "accent",
  comparison: "info",
  conclusion: "gold",
  lesson: "accent",
  example: "info",
  next_lesson: "up",
  what_happened: "info",
  did_well: "up",
  did_poorly: "down",
  main_lesson: "gold",
  strengths: "up",
  weaknesses: "down",
  overfitting: "warn",
  next_test: "accent",
  quiz: "violet",
};

export function sectionAccent(key: string): Accent {
  return SECTION_ACCENT[key] ?? "neutral";
}

/** The six sections every chart answer (explain/analyze/why/compare) must contain, in order. */
export const STANDARD_SECTIONS = [
  { key: "observation", title: "OBSERVATION" },
  { key: "rules", title: "RULES" },
  { key: "scenario", title: "SCENARIO" },
  { key: "invalidation", title: "INVALIDATION" },
  { key: "risk", title: "RISK" },
  { key: "alternative", title: "ALTERNATIVE SCENARIO" },
] as const;

export type ProviderInfo = { label: string; tone: "neutral" | "violet"; title: string };

export function providerInfo(a: Pick<TeacherAnswerData, "provider" | "provider_label" | "fallback">): ProviderInfo {
  const llm = a.provider && a.provider !== "offline";
  const label = a.provider_label || (llm ? (a.provider === "anthropic" ? "Claude" : a.provider) : "OFFLINE");
  if (llm) return { label, tone: "violet", title: "Отговорът е редактиран от езиков модел и проверен срещу числата на engine-а и safety филтъра." };
  if (a.fallback)
    return {
      label: "OFFLINE",
      tone: "neutral",
      title: "Външният AI не отговори коректно — показан е детерминистичният offline отговор (същите правила и числа).",
    };
  return { label: "OFFLINE", tone: "neutral", title: "Детерминистичен offline учител: правила и числа от engine-а, без външен AI." };
}

/** Values of a context chip as [label, value] rows (empty when the section is not available). */
export function contextRows(item: ContextItem): [string, string][] {
  if (!item.values) return [];
  return Object.entries(item.values).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "") as [string, string][];
}

/** "N от M" summary of the teacher's context. */
export function contextCoverage(items: ContextItem[] | undefined): { available: number; total: number } {
  const list = items ?? [];
  return { available: list.filter((i) => i.available).length, total: list.length };
}

/** Plus-first / minus-first / neither split of the historical examples (sums to 100) or null. */
export function examplesSplit(e?: ExamplesSummary | null): { plus: number; minus: number; neither: number } | null {
  if (!e || !e.available || !e.count) return null;
  const plus = Math.max(0, e.plus_first_pct ?? 0);
  const minus = Math.max(0, e.minus_first_pct ?? 0);
  const neither = Math.max(0, e.neither_pct ?? Math.max(0, 100 - plus - minus));
  const sum = plus + minus + neither;
  if (sum <= 0) return null;
  const k = 100 / sum;
  return { plus: Math.round(plus * k), minus: Math.round(minus * k), neither: Math.max(0, 100 - Math.round(plus * k) - Math.round(minus * k)) };
}

/* ───────────────────────────────────────────────────── quiz state */

export type QuizState = { index: number; answers: (number | null)[]; finished: boolean };
export type QuizAction = { type: "answer"; choice: number } | { type: "next" } | { type: "prev" } | { type: "goto"; index: number } | { type: "restart" };

export function quizInit(count: number): QuizState {
  return { index: 0, answers: Array.from({ length: Math.max(0, count) }, () => null), finished: count === 0 };
}

/** Answers lock after the first pick (select → reveal explanation); "next" on the last one finishes. */
export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  const n = state.answers.length;
  switch (action.type) {
    case "answer": {
      if (state.finished || state.answers[state.index] !== null || action.choice < 0) return state;
      const answers = state.answers.slice();
      answers[state.index] = action.choice;
      return { ...state, answers };
    }
    case "next":
      if (state.answers[state.index] === null) return state;
      return state.index >= n - 1 ? { ...state, finished: true } : { ...state, index: state.index + 1 };
    case "prev":
      return state.finished ? { ...state, finished: false } : { ...state, index: Math.max(0, state.index - 1) };
    case "goto":
      return action.index >= 0 && action.index < n ? { ...state, index: action.index, finished: false } : state;
    case "restart":
      return quizInit(n);
  }
}

export function quizScore(questions: QuizQuestion[], answers: (number | null)[], passScore = 0.7) {
  let correct = 0;
  let answered = 0;
  questions.forEach((q, i) => {
    const a = answers[i];
    if (a === null || a === undefined) return;
    answered += 1;
    if (a === q.answer_index) correct += 1;
  });
  const total = questions.length;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  return { correct, answered, total, pct, passed: total > 0 && correct / total >= passScore };
}

/** A quiz the UI can render safely (answer index inside the options). */
export function validQuestions(questions: QuizQuestion[] | undefined): QuizQuestion[] {
  return (questions ?? []).filter(
    (q) => q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < q.options.length,
  );
}

/* ─────────────────────────────────────────── chart overlay (lines + labels) */

export type NormalizedOverlay = {
  source: "answer" | "view" | "analysis";
  support: number[];
  resistance: number[];
  swings: Swing[];
  setup: OverlaySetup | null;
};

const nums = (xs: unknown[] | undefined): number[] => (xs ?? []).filter((x): x is number => typeof x === "number" && Number.isFinite(x));

export function overlayFromAnswer(a?: TeacherAnswerData | null, symbol?: string, timeframe?: string): NormalizedOverlay | null {
  const o: ChartOverlay | null | undefined = a?.overlay;
  if (!a || !o) return null;
  if (symbol && a.symbol && a.symbol !== symbol) return null;
  if (timeframe && a.timeframe && a.timeframe !== timeframe) return null;
  return { source: "answer", support: nums(o.support), resistance: nums(o.resistance), swings: o.swings ?? [], setup: o.setup ?? null };
}

export function overlayFromView(v?: StrategyViewData | null, symbol?: string, timeframe?: string): NormalizedOverlay | null {
  if (!v || !v.available) return null;
  if (symbol && v.symbol !== symbol) return null;
  if (timeframe && v.timeframe !== timeframe) return null;
  const rp = v.risk_plan;
  return {
    source: "view",
    support: nums((v.support ?? []).map((l) => l.price)),
    resistance: nums((v.resistance ?? []).map((l) => l.price)),
    swings: v.structure?.swings ?? [],
    setup: rp ? { side: rp.side, entry: rp.entry, stop: rp.stop, target: rp.target, source: "strategy" } : null,
  };
}

export function overlayFromAnalysis(a?: Analysis | null, symbol?: string, timeframe?: string): NormalizedOverlay | null {
  if (!a) return null;
  if (symbol && a.market && a.market !== symbol) return null;
  if (timeframe && a.timeframe && a.timeframe !== timeframe) return null;
  return {
    source: "analysis",
    support: nums(a.support.map((l) => l.price)),
    resistance: nums(a.resistance.map((l) => l.price)),
    swings: (a.structure?.swings ?? []).map((s) => ({ ...s, kind: s.kind })),
    setup: a.setup ? { side: a.setup.side, entry: a.setup.entry, stop: a.setup.invalidation, target: a.setup.target, source: "engine" } : null,
  };
}

export type OverlayLayers = { levels: boolean; setup: boolean; structure: boolean };
export type OverlayLine = { id: string; price: number; color: string; title: string; dashed?: boolean };
export type OverlayMarker = { time: number; position: "aboveBar" | "belowBar"; shape: "circle"; color: string; text: string };

export const OVERLAY_COLORS = {
  support: withAlpha(PALETTE.up, 0.85),
  resistance: withAlpha(PALETTE.down, 0.85),
  invalidation: PALETTE.warn,
  target: PALETTE.info,
  bullish: PALETTE.up,
  bearish: PALETTE.down,
  neutral: PALETTE.muted,
} as const;

/** Price lines of an overlay: ≤2 supports, ≤2 resistances, Invalidation (stop) and Target. */
export function overlayLines(o: NormalizedOverlay | null, layers: OverlayLayers = { levels: true, setup: true, structure: true }): OverlayLine[] {
  if (!o) return [];
  const out: OverlayLine[] = [];
  if (layers.levels) {
    o.support.slice(0, 2).forEach((p, i) => out.push({ id: `sup${i}`, price: p, color: OVERLAY_COLORS.support, title: "Support", dashed: true }));
    o.resistance.slice(0, 2).forEach((p, i) => out.push({ id: `res${i}`, price: p, color: OVERLAY_COLORS.resistance, title: "Resistance", dashed: true }));
  }
  if (layers.setup && o.setup) {
    if (finitePos(o.setup.stop)) out.push({ id: "inv", price: o.setup.stop, color: OVERLAY_COLORS.invalidation, title: "Invalidation" });
    if (finitePos(o.setup.target)) out.push({ id: "tgt", price: o.setup.target, color: OVERLAY_COLORS.target, title: "Target" });
  }
  return out;
}

/** HH / HL / LH / LL labels of the last `limit` swings (only at candle times when `times` is given). */
export function swingMarkers(swings: Swing[] | undefined, limit = 8, times?: Set<number>): OverlayMarker[] {
  const seen = new Set<string>();
  const list = (swings ?? [])
    .filter((s) => s && Number.isFinite(s.time) && (!times || times.has(s.time)))
    .filter((s) => {
      const k = `${s.time}:${s.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.time - b.time)
    .slice(-limit);
  return list.map((s) => {
    const label = s.label ?? (s.kind === "high" ? "SH" : "SL");
    const bullish = label === "HH" || label === "HL";
    const bearish = label === "LH" || label === "LL";
    return {
      time: s.time,
      position: s.kind === "high" ? "aboveBar" : "belowBar",
      shape: "circle",
      color: bullish ? OVERLAY_COLORS.bullish : bearish ? OVERLAY_COLORS.bearish : OVERLAY_COLORS.neutral,
      text: label,
    };
  });
}

/* ─────────────────────────────────────────────────── strategy view */

export function resultTone(result: string | null | undefined): "up" | "down" | "neutral" {
  if (result === "POSSIBLE LONG SETUP") return "up";
  if (result === "POSSIBLE SHORT SETUP") return "down";
  return "neutral";
}

export function logicLabel(logic: string | undefined): string {
  return logic === "any" ? "поне едно условие (OR)" : "всички условия (AND)";
}

export function conditionCounts(list: ConditionCheck[] | undefined): { passed: number; total: number } {
  const l = list ?? [];
  return { passed: l.filter((c) => c.passed).length, total: l.length };
}

/** Number for a rule value / level: grouped, 2 decimals ≥ 1, more for small prices (forex, alts). */
export function fmtValue(v: number | null | undefined, precision?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  let digits: number;
  if (precision !== undefined) digits = precision;
  else {
    const a = Math.abs(v);
    digits = a >= 1 || a === 0 ? 2 : a >= 0.01 ? 4 : 6;
  }
  return v.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
}

export function regimeFilterText(rf: StrategyViewData["regime_filter"] | undefined): string {
  if (!rf) return "—";
  const req = rf.required?.length ? rf.required.join(" / ") : "всеки режим";
  return `${req} · текущ: ${rf.actual ?? "—"}`;
}

/* ───────────────────────────────────────────────────────── errors */

/** True for the 503 DATA_NOT_AVAILABLE response (lib/api ApiError keeps only status + message). */
export function isDataNotAvailableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: unknown }).status;
  const msg = String((e as { message?: unknown }).message ?? "");
  return status === 503 || /DATA[ _]NOT[ _]AVAILABLE/i.test(msg);
}
