/*
 * Order-ticket model of the paper terminal (/trade, /charts → Trade). Pure — no React, no I/O — so it is
 * unit-tested and shared by OrderPanel, the chart (draft price lines, click-to-set levels) and the AI panel
 * (draft order). Money is in the ACCOUNT currency (USD); prices in the instrument's QUOTE currency.
 * The backend preview (POST /paper/orders/preview) stays the authority for the displayed plan; these
 * functions give the instant client-side answer (quantity, side checks, margin) while it is in flight.
 */
import {
  entryTypeForLevel,
  fmtQty,
  leverageChoices,
  marginFor,
  marketEntry,
  notionalUsd,
  parseNum,
  perUnitRisk,
  qtyForRisk,
  rewardRisk,
  stopFromPct,
  stopOnLosingSide,
  targetFromR,
  targetOnWinningSide,
  fxRateAt,
  type FxConversion,
  type OrderSide,
  type OrderType,
} from "@/lib/sizing";

export const SETUPS = ["breakout", "pullback", "range", "reversal", "momentum", "retest", "other"] as const;
/** quick stop distances (fraction of the entry) — rendered BEFORE the risk-% buttons (walkthrough: first "1%") */
export const STOP_PCTS = [0.005, 0.01, 0.02] as const;
/** quick targets (multiples of the entry → stop distance) */
export const TARGET_RS = [1.5, 2, 3] as const;
/** quick risk per trade (% of equity) */
export const RISK_PCTS = [0.5, 1, 2] as const;

export type SizingMode = "risk" | "manual";
export type LevelKind = "entry" | "stop" | "target";

export type TicketState = {
  side: OrderSide;
  type: OrderType;
  /** limit price / stop trigger as typed (ignored for market orders) */
  entry: string;
  stop: string;
  target: string;
  sizing: SizingMode;
  /** % of equity at risk (risk sizing) */
  riskPct: string;
  /** units (manual sizing) */
  manualQty: string;
  /** null = the account default leverage (min(account leverage, instrument max)) */
  leverage: number | null;
  setup: string;
};

export const INITIAL_TICKET: TicketState = {
  side: "buy",
  type: "market",
  entry: "",
  stop: "",
  target: "",
  sizing: "risk",
  riskPct: "1",
  manualQty: "",
  leverage: null,
  setup: "pullback",
};

export type TicketField = "entry" | "stop" | "target" | "riskPct" | "manualQty" | "setup";

/**
 * Order levels handed to the terminal by a link (`/trade?symbol=…&side=buy|sell&entry=&stop=&target=&leverage=`,
 * e.g. the Trade Simulator's "Отвори в Paper Trading"); `null` = not in the link. Prices in the quote currency.
 */
export type TicketPrefill = {
  side: OrderSide | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  leverage: number | null;
};

export type TicketAction =
  | { type: "side"; side: OrderSide }
  | { type: "orderType"; orderType: OrderType }
  | { type: "set"; field: TicketField; value: string }
  | { type: "sizing"; sizing: SizingMode }
  | { type: "leverage"; leverage: number | null }
  /** a price picked on the chart ("set as Entry / SL / TP") */
  | { type: "level"; kind: LevelKind; price: number; market: number | null; precision: number }
  /** new instrument: drop the price levels, quantity and leverage (keep side / sizing / risk / setup) */
  | { type: "instrument" }
  /** after a placed order: drop the price levels and the manual quantity */
  | { type: "placed" }
  /** levels from a link (Trade Simulator → /trade?side=&entry=&stop=&target=&leverage=): fills the draft, never places an order */
  | { type: "prefill"; prefill: TicketPrefill; market: number | null; precision: number; maxLeverage?: number | null }
  | { type: "reset" };

/** Price as the text a field shows (fixed decimals of the instrument). */
export function priceText(v: number, precision: number): string {
  if (!Number.isFinite(v)) return "";
  const p = Math.max(0, Math.min(12, Math.round(precision)));
  return v.toFixed(p);
}

export function ticketReducer(s: TicketState, a: TicketAction): TicketState {
  switch (a.type) {
    case "side":
      return s.side === a.side ? s : { ...s, side: a.side };
    case "orderType":
      return s.type === a.orderType ? s : { ...s, type: a.orderType };
    case "set":
      return s[a.field] === a.value ? s : { ...s, [a.field]: a.value };
    case "sizing":
      return s.sizing === a.sizing ? s : { ...s, sizing: a.sizing };
    case "leverage":
      return s.leverage === a.leverage ? s : { ...s, leverage: a.leverage };
    case "level": {
      if (!Number.isFinite(a.price) || a.price <= 0) return s;
      const v = priceText(a.price, a.precision);
      if (a.kind === "entry") return { ...s, entry: v, type: entryTypeForLevel(s.side, a.price, a.market) };
      if (a.kind === "stop") return { ...s, stop: v };
      return { ...s, target: v };
    }
    case "instrument":
      return { ...s, entry: "", stop: "", target: "", manualQty: "", leverage: null };
    case "placed":
      return { ...s, entry: "", stop: "", target: "", manualQty: "" };
    case "prefill":
      return applyPrefill(s, a.prefill, a.market, a.precision, a.maxLeverage);
    case "reset":
      return INITIAL_TICKET;
  }
}

/** The instrument parameters the ticket needs (a subset of GET /paper/instrument). */
export type TicketInstrument = {
  qty_step: number;
  min_qty: number;
  taker_fee: number;
  max_leverage: number;
  default_leverage: number;
  price_precision?: number;
  bid: number | null;
  ask: number | null;
  conversion?: FxConversion;
  available?: boolean;
};

export type TicketContext = {
  instrument?: TicketInstrument | null;
  /** last price of the chart (fallback for bid / ask) */
  last: number | null;
  precision: number;
  /** account equity (USD) — base of risk % */
  equity: number;
  /** available (free) margin (USD); omitted → the quantity is not capped by margin */
  freeMargin?: number | null;
};

export type TicketCalc = {
  /** entry of the plan: ASK (buy) / BID (sell) for market orders, the typed price for limit / stop */
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** leverage the order will use */
  leverage: number;
  leverageSource: "order" | "account";
  maxLeverage: number;
  /** allowed leverage steps (never "recommended") */
  leverageSteps: number[];
  /** final quantity (0 = nothing to submit) */
  qty: number;
  qtyText: string;
  /** client estimates in USD (the preview replaces them when it arrives) */
  riskUsd: number | null;
  riskPct: number | null;
  rewardUsd: number | null;
  rr: number | null;
  notional: number | null;
  margin: number | null;
  belowMin: boolean;
  cappedByMargin: boolean;
  stopWrongSide: boolean;
  targetWrongSide: boolean;
  /** risk sizing without a stop loss */
  needsStop: boolean;
  /** limit / stop order without its price */
  needsEntry: boolean;
  /** no market price yet (market order) */
  noPrice: boolean;
  canSubmit: boolean;
};

const pos = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function effectiveLeverage(t: Pick<TicketState, "leverage">, inst?: Pick<TicketInstrument, "max_leverage" | "default_leverage"> | null): {
  leverage: number;
  source: "order" | "account";
  max: number;
} {
  const maxRaw = inst?.max_leverage;
  const defRaw = inst?.default_leverage;
  const max = pos(maxRaw) ? Math.max(1, maxRaw) : 1;
  const def = pos(defRaw) ? Math.min(defRaw, max) : 1;
  if (t.leverage !== null && pos(t.leverage)) return { leverage: Math.min(Math.max(1, t.leverage), max), source: "order", max };
  return { leverage: Math.max(1, def), source: "account", max };
}

/** A linked level as field text: the instrument's decimals, unless that would move it by more than 0.01 %. */
function linkedLevelText(v: number, precision: number): string {
  const t = priceText(v, precision);
  const back = Number(t);
  return back > 0 && Math.abs(back - v) <= v * 1e-4 ? t : String(Number(v.toPrecision(10)));
}

/**
 * Applies a link prefill to the draft: the side first, then the entry with the same rule as the chart's
 * "set as Entry" (LIMIT / STOP against the live market — no entry keeps the order type), stop loss, take
 * profit and the per-order leverage capped at the instrument maximum (below 1x ignored). Sizing stays as
 * it is (by risk % → the quantity follows from the stop). Only fills the ticket — the user's submit places it.
 */
export function applyPrefill(s: TicketState, p: TicketPrefill, market: number | null, precision: number, maxLeverage?: number | null): TicketState {
  let next: TicketState = p.side === "buy" || p.side === "sell" ? { ...s, side: p.side } : s;
  if (pos(p.entry)) next = { ...next, entry: linkedLevelText(p.entry, precision), type: entryTypeForLevel(next.side, p.entry, market) };
  if (pos(p.stop)) next = { ...next, stop: linkedLevelText(p.stop, precision) };
  if (pos(p.target)) next = { ...next, target: linkedLevelText(p.target, precision) };
  // below 1x is not a leverage (ignored → account default); above the instrument max → the max
  if (pos(p.leverage) && p.leverage >= 1) {
    const cap = pos(maxLeverage) ? Math.max(1, Math.min(100, maxLeverage)) : 100;
    next = { ...next, leverage: Math.min(p.leverage, cap) };
  }
  return next;
}

export function computeTicket(t: TicketState, ctx: TicketContext): TicketCalc {
  const inst = ctx.instrument ?? null;
  const market = marketEntry(t.side, inst?.bid, inst?.ask, ctx.last);
  const typed = parseNum(t.entry);
  const entry = t.type === "market" ? market : pos(typed) ? typed : null;
  const stopRaw = parseNum(t.stop);
  const targetRaw = parseNum(t.target);
  const stop = pos(stopRaw) ? stopRaw : null;
  const target = pos(targetRaw) ? targetRaw : null;
  const lev = effectiveLeverage(t, inst);
  const stepRaw = inst?.qty_step;
  const minRaw = inst?.min_qty;
  const feeRaw = inst?.taker_fee;
  const step = pos(stepRaw) ? stepRaw : 0;
  const minQty = pos(minRaw) ? minRaw : 0;
  const fee = pos(feeRaw) ? feeRaw : 0;
  const conversion = inst?.conversion;

  const stopWrongSide = !!(entry && stop && !stopOnLosingSide(t.side, entry, stop));
  const targetWrongSide = !!(entry && target && !targetOnWinningSide(t.side, entry, target));

  let qty = 0;
  let belowMin = false;
  let cappedByMargin = false;
  if (t.sizing === "manual") {
    const q = parseNum(t.manualQty);
    qty = pos(q) ? q : 0;
    belowMin = qty > 0 && minQty > 0 && qty < minQty;
  } else if (entry && stop && !stopWrongSide && step) {
    const r = qtyForRisk({
      side: t.side,
      equity: ctx.equity,
      riskPct: parseNum(t.riskPct) ?? 0,
      entry,
      stop,
      qtyStep: step,
      minQty,
      conversion,
      feeRate: fee,
      ...(ctx.freeMargin !== undefined && ctx.freeMargin !== null ? { freeMargin: Math.max(0, ctx.freeMargin), leverage: lev.leverage } : {}),
    });
    qty = r.qty;
    belowMin = r.belowMin;
    cappedByMargin = r.cappedByMargin;
  }

  const perUnit = entry && stop && !stopWrongSide ? perUnitRisk({ side: t.side, entry, stop, conversion, feeRate: fee }) : null;
  const riskUsd = perUnit !== null && qty > 0 ? perUnit * qty : null;
  const rateAtTarget = target ? fxRateAt(conversion, target) : null;
  const rewardUsd = entry && target && !targetWrongSide && qty > 0 && rateAtTarget !== null ? Math.abs(target - entry) * rateAtTarget * qty : null;
  const rr = entry && stop && target ? rewardRisk(t.side, entry, stop, target) : null;
  const notional = entry && qty > 0 ? notionalUsd(qty, entry, conversion) : null;
  const margin = marginFor(notional, lev.leverage);

  const needsStop = t.sizing === "risk" && !stop;
  const needsEntry = t.type !== "market" && !entry;
  const noPrice = t.type === "market" && !market;
  const canSubmit = qty > 0 && !belowMin && !needsEntry && !noPrice && !stopWrongSide && !targetWrongSide && inst?.available !== false;

  return {
    entry,
    stop,
    target,
    leverage: lev.leverage,
    leverageSource: lev.source,
    maxLeverage: lev.max,
    leverageSteps: leverageChoices(lev.max),
    qty,
    qtyText: fmtQty(qty, step || undefined),
    riskUsd,
    riskPct: riskUsd !== null && ctx.equity > 0 ? (riskUsd / ctx.equity) * 100 : null,
    rewardUsd,
    rr,
    notional,
    margin,
    belowMin,
    cappedByMargin,
    stopWrongSide,
    targetWrongSide,
    needsStop,
    needsEntry,
    noPrice,
    canSubmit,
  };
}

/** Body of POST /paper/orders and /paper/orders/preview. */
export type OrderRequest = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price?: number;
  stop_loss?: number;
  take_profit?: number;
  timeframe: string;
  setup: string;
  leverage?: number;
  risk_pct?: number;
};

/** The request for the current ticket, or null while nothing valid can be sent. */
export function orderRequest(symbol: string, timeframe: string, t: TicketState, c: TicketCalc): OrderRequest | null {
  if (!symbol || !(c.qty > 0) || c.needsEntry || c.noPrice || c.stopWrongSide || c.targetWrongSide) return null;
  const req: OrderRequest = { symbol, side: t.side, type: t.type, qty: c.qty, timeframe, setup: t.setup };
  if (t.type !== "market" && c.entry) req.price = c.entry;
  if (c.stop) req.stop_loss = c.stop;
  if (c.target) req.take_profit = c.target;
  if (c.leverageSource === "order") req.leverage = c.leverage;
  const risk = parseNum(t.riskPct);
  if (t.sizing === "risk" && risk !== null && risk > 0 && risk <= 100) req.risk_pct = risk;
  return req;
}

/** Stable identity of a request (preview de-duplication / staleness checks). */
export function requestKey(r: OrderRequest | null): string {
  if (!r) return "";
  return [r.symbol, r.side, r.type, r.qty, r.price ?? "", r.stop_loss ?? "", r.take_profit ?? "", r.leverage ?? "", r.risk_pct ?? "", r.setup, r.timeframe].join("|");
}

/** Quick stop: `pct` (0.01 = 1 %) from the plan's entry on the losing side, as field text. */
export function quickStopText(c: Pick<TicketCalc, "entry">, side: OrderSide, pct: number, precision: number): string | null {
  if (!c.entry) return null;
  const v = stopFromPct(c.entry, side, pct, precision);
  return v === null ? null : priceText(v, precision);
}

/** Quick target: `r` × the entry → stop distance on the winning side, as field text. */
export function quickTargetText(c: Pick<TicketCalc, "entry" | "stop">, side: OrderSide, r: number, precision: number): string | null {
  if (!c.entry || !c.stop) return null;
  const v = targetFromR(c.entry, c.stop, side, r, precision);
  return v === null ? null : priceText(v, precision);
}

/** Submit label — the walkthrough matches /BUY \/ LONG .* virtual/. */
export function submitLabel(side: OrderSide, qtyText: string): string {
  return `${side === "buy" ? "BUY / LONG" : "SELL / SHORT"} ${qtyText} · virtual`;
}

/** Draft order for the AI panel ("Explain this setup") — null while there is no entry. */
export function aiDraft(t: TicketState, c: TicketCalc): { side: OrderSide; entry: number | null; stop: number | null; target: number | null; qty: number | null } | null {
  if (!c.entry) return null;
  return { side: t.side, entry: c.entry, stop: c.stop, target: c.target, qty: c.qty > 0 ? c.qty : null };
}

/** Client-side hints shown under the size block (never blocking — except impossible orders). */
export function ticketHints(c: TicketCalc, t: TicketState, minQty?: number): { tone: "warn" | "info"; text: string }[] {
  const out: { tone: "warn" | "info"; text: string }[] = [];
  if (c.needsEntry) out.push({ tone: "info", text: t.type === "limit" ? "Въведи limit цена (или я избери от графиката)." : "Въведи stop цена за активиране." });
  if (c.stopWrongSide) out.push({ tone: "warn", text: t.side === "buy" ? "Stop loss-ът трябва да е ПОД входа при LONG." : "Stop loss-ът трябва да е НАД входа при SHORT." });
  if (c.targetWrongSide) out.push({ tone: "warn", text: t.side === "buy" ? "Take profit-ът трябва да е НАД входа при LONG." : "Take profit-ът трябва да е ПОД входа при SHORT." });
  if (c.needsStop && !c.needsEntry) out.push({ tone: "info", text: "Задай stop loss, за да изчисля размера." });
  if (c.belowMin) out.push({ tone: "warn", text: `Размерът е под минималното количество${minQty ? ` (${minQty})` : ""} — увеличи риска или премести стопа.` });
  if (c.cappedByMargin) out.push({ tone: "info", text: "Размерът е ограничен от свободния margin." });
  return out;
}

export type DraftLevel = { id: string; kind: LevelKind; price: number; title: string };

/**
 * Price levels of the draft to draw on the chart: the limit / stop entry (market orders have none),
 * the stop loss and the take profit — only valid numbers.
 */
export function draftLevels(t: TicketState): DraftLevel[] {
  const out: DraftLevel[] = [];
  const entry = t.type === "market" ? null : parseNum(t.entry);
  const stop = parseNum(t.stop);
  const target = parseNum(t.target);
  if (entry !== null && entry > 0) out.push({ id: "draft-entry", kind: "entry", price: entry, title: `${t.type.toUpperCase()} ${t.side === "buy" ? "BUY" : "SELL"}` });
  if (stop !== null && stop > 0) out.push({ id: "draft-sl", kind: "stop", price: stop, title: "SL (draft)" });
  if (target !== null && target > 0) out.push({ id: "draft-tp", kind: "target", price: target, title: "TP (draft)" });
  return out;
}
