/*
 * Position-sizing and order-ticket maths shared by the paper terminal (/trade, /charts), the replay
 * decision card and any other order form. Pure functions — no React, no I/O — so they are unit-tested.
 *
 * Money is in the ACCOUNT currency (USD); prices are in the instrument's QUOTE currency. The quote → USD
 * rate comes from GET /paper/instrument (`conversion`): identity (USD, USDT, USDC…), inverse (USD/XXX:
 * 1 / price), cross / fixed (the rate the backend reports). The backend preview (`sizing.qty_for_risk_capped`)
 * stays the authority; these functions give the same answer instantly while the preview is in flight.
 */

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";

/** Conversion info as returned by the backend (subset). */
export type FxConversion = { method?: string | null; rate?: number | null; available?: boolean | null } | null | undefined;

const finitePos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Number of decimals of a quantity step: 0.0001 → 4, 100 → 0, 0.5 → 1. */
export function stepDecimals(step: number): number {
  if (!finitePos(step)) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]) || 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Floor a quantity to the instrument's step (same rule as the backend AssetSpec.round_qty). */
export function floorToStep(qty: number, step: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!finitePos(step)) return qty;
  const steps = Math.floor(qty / step + 1e-9);
  return Number((steps * step).toFixed(Math.min(10, stepDecimals(step) + 2)));
}

/** Round a price to the instrument precision. */
export function roundPrice(v: number, precision: number): number {
  if (!Number.isFinite(v)) return v;
  const p = Math.max(0, Math.min(12, Math.round(precision)));
  return Number(v.toFixed(p));
}

/** Parse a user-typed number ("1 234,5" / "1,234.5" / " 98.1 ") → number | null. */
export function parseNum(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  // "1,5" → "1.5"; "1,234.5" → "1234.5"
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Quote → USD rate at `price` (inverse instruments: 1 / price). null when no rate is known. */
export function fxRateAt(conversion: FxConversion, price?: number | null): number | null {
  if (!conversion) return 1;
  if (conversion.available === false) return null;
  const method = conversion.method ?? "identity";
  if (method === "identity") return 1;
  if (method === "inverse" && finitePos(price)) return 1 / price;
  return finitePos(conversion.rate) ? conversion.rate : null;
}

/** USD amount a `riskPct` % of `equity` represents. */
export function riskAmount(equity: number, riskPct: number): number {
  if (!finitePos(equity) || !finitePos(riskPct)) return 0;
  return (equity * riskPct) / 100;
}

/** True when the stop is on the LOSING side of the entry (below for a buy, above for a sell). */
export function stopOnLosingSide(side: OrderSide, entry: number, stop: number): boolean {
  if (!finitePos(entry) || !finitePos(stop)) return false;
  return side === "buy" ? stop < entry : stop > entry;
}

/** True when the target is on the WINNING side of the entry. */
export function targetOnWinningSide(side: OrderSide, entry: number, target: number): boolean {
  if (!finitePos(entry) || !finitePos(target)) return false;
  return side === "buy" ? target > entry : target < entry;
}

/**
 * USD lost per unit when an entry at `entry` exits at `stop`: price distance × quote→USD rate (at the
 * stop for inverse instruments) + taker fees on both legs. null when the stop is on the wrong side or
 * no conversion rate exists.
 */
export function perUnitRisk(opts: {
  side: OrderSide;
  entry: number;
  stop: number;
  conversion?: FxConversion;
  feeRate?: number;
}): number | null {
  const { side, entry, stop, conversion, feeRate = 0 } = opts;
  if (!stopOnLosingSide(side, entry, stop)) return null;
  const stopRate = fxRateAt(conversion, stop);
  const entryRate = fxRateAt(conversion, entry);
  if (stopRate === null || entryRate === null) return null;
  let loss = Math.abs(entry - stop) * stopRate;
  if (feeRate > 0) loss += entry * entryRate * feeRate + stop * stopRate * feeRate;
  return loss;
}

/** Largest quantity the free margin can open at `entry` with `leverage` (fees included). */
export function maxQtyForMargin(opts: {
  freeMargin: number;
  entry: number;
  leverage: number;
  qtyStep: number;
  conversion?: FxConversion;
  feeRate?: number;
}): number {
  const { freeMargin, entry, leverage, qtyStep, conversion, feeRate = 0 } = opts;
  const rate = fxRateAt(conversion, entry);
  if (!finitePos(freeMargin) || !finitePos(entry) || !finitePos(leverage) || rate === null) return 0;
  const perUnit = entry * rate * (1 / leverage + Math.max(0, feeRate));
  return perUnit > 0 ? floorToStep(freeMargin / perUnit, qtyStep) : 0;
}

export type RiskSizing = {
  /** final quantity (floored to the step, capped by margin when `freeMargin` is given) */
  qty: number;
  /** unrounded risk-based quantity */
  rawQty: number;
  /** USD at risk for `riskPct` */
  riskAmount: number;
  /** USD lost per unit at the stop (null: stop on the wrong side / no FX rate) */
  perUnit: number | null;
  /** the risk-based quantity is below the instrument minimum (cannot be traded) */
  belowMin: boolean;
  /** the free margin capped the quantity */
  cappedByMargin: boolean;
};

/**
 * Quantity whose loss at the stop (fees included) stays within `riskPct` % of `equity` — mirrors the
 * backend PaperBroker.qty_for_risk. With `freeMargin` + `leverage` the result is also capped by margin.
 */
export function qtyForRisk(opts: {
  side: OrderSide;
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  qtyStep: number;
  minQty?: number;
  conversion?: FxConversion;
  feeRate?: number;
  freeMargin?: number;
  leverage?: number;
}): RiskSizing {
  const amount = riskAmount(opts.equity, opts.riskPct);
  const perUnit = perUnitRisk(opts);
  if (!amount || !perUnit) return { qty: 0, rawQty: 0, riskAmount: amount, perUnit, belowMin: false, cappedByMargin: false };
  const rawQty = amount / perUnit;
  let qty = floorToStep(rawQty, opts.qtyStep);
  let cappedByMargin = false;
  if (opts.freeMargin !== undefined && opts.leverage) {
    const cap = maxQtyForMargin({
      freeMargin: opts.freeMargin,
      entry: opts.entry,
      leverage: opts.leverage,
      qtyStep: opts.qtyStep,
      conversion: opts.conversion,
      feeRate: opts.feeRate,
    });
    if (cap < qty) {
      qty = cap;
      cappedByMargin = true;
    }
  }
  const belowMin = !!opts.minQty && qty < opts.minQty;
  return { qty: belowMin ? 0 : qty, rawQty, riskAmount: amount, perUnit, belowMin, cappedByMargin };
}

/** Stop `pct` (fraction: 0.01 = 1 %) away from the entry on the losing side. */
export function stopFromPct(entry: number, side: OrderSide, pct: number, precision: number): number | null {
  if (!finitePos(entry) || !finitePos(pct)) return null;
  const d = entry * pct;
  return roundPrice(side === "buy" ? entry - d : entry + d, precision);
}

/** Target at `r` × the entry→stop distance on the winning side. */
export function targetFromR(entry: number, stop: number, side: OrderSide, r: number, precision: number): number | null {
  if (!stopOnLosingSide(side, entry, stop) || !finitePos(r)) return null;
  const d = Math.abs(entry - stop) * r;
  return roundPrice(side === "buy" ? entry + d : entry - d, precision);
}

/** Reward ÷ risk of a plan (null unless stop and target are on their correct sides). */
export function rewardRisk(side: OrderSide, entry: number, stop: number, target: number): number | null {
  if (!stopOnLosingSide(side, entry, stop) || !targetOnWinningSide(side, entry, target)) return null;
  return Math.abs(target - entry) / Math.abs(entry - stop);
}

/** Notional in USD. */
export function notionalUsd(qty: number, price: number, conversion?: FxConversion): number | null {
  const rate = fxRateAt(conversion, price);
  if (!finitePos(qty) || !finitePos(price) || rate === null) return null;
  return qty * price * rate;
}

/** Initial margin for a notional at `leverage` (margin = notional / leverage). */
export function marginFor(notional: number | null, leverage: number): number | null {
  if (notional === null || !finitePos(notional) || !finitePos(leverage)) return null;
  return notional / leverage;
}

const LEVERAGE_STEPS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100];

/**
 * Leverage choices for an instrument: the standard steps up to `max` plus `max` itself. Purely the
 * allowed range — the UI never marks any of them as recommended.
 */
export function leverageChoices(max: number): number[] {
  const cap = finitePos(max) ? Math.min(100, max) : 1;
  const out = LEVERAGE_STEPS.filter((l) => l <= cap);
  if (!out.includes(cap) && cap >= 1) out.push(Number(cap.toFixed(2)));
  return out.length ? out : [1];
}

/**
 * Order type for an entry level picked on the chart: a BUY below the market (or a SELL above it) waits
 * for a better price → LIMIT; a BUY above / SELL below needs the market to get there first → STOP.
 */
export function entryTypeForLevel(side: OrderSide, level: number, market: number | null): "limit" | "stop" {
  if (!finitePos(market) || !finitePos(level)) return "limit";
  if (side === "buy") return level <= market ? "limit" : "stop";
  return level >= market ? "limit" : "stop";
}

/** Live market entry for a side: ASK for buys, BID for sells (fallback: last price). */
export function marketEntry(side: OrderSide, bid: number | null | undefined, ask: number | null | undefined, last: number | null | undefined): number | null {
  const v = side === "buy" ? ask : bid;
  if (finitePos(v)) return v;
  return finitePos(last) ? last : null;
}

/** Display string for a quantity at its step precision ("0.0150", "1,000"). */
export function fmtQty(qty: number | null | undefined, step?: number): string {
  if (qty === null || qty === undefined || !Number.isFinite(qty) || qty <= 0) return "";
  const d = step ? stepDecimals(step) : qty >= 100 ? 0 : 4;
  return Number(qty.toFixed(Math.min(10, d))).toString();
}
