/*
 * components/trading/ticket.ts — the paper order ticket (reducer, live sizing, request body, chart levels).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  INITIAL_TICKET,
  RISK_PCTS,
  STOP_PCTS,
  TARGET_RS,
  aiDraft,
  computeTicket,
  draftLevels,
  effectiveLeverage,
  orderRequest,
  priceText,
  quickStopText,
  quickTargetText,
  requestKey,
  submitLabel,
  ticketHints,
  ticketReducer,
  type TicketInstrument,
  type TicketState,
} from "@/components/trading/ticket";

const BTC: TicketInstrument = {
  qty_step: 0.0001,
  min_qty: 0.0001,
  taker_fee: 0,
  max_leverage: 2,
  default_leverage: 2,
  price_precision: 2,
  bid: 99990,
  ask: 100000,
  conversion: { method: "identity", rate: 1, available: true },
  available: true,
};
const USDJPY: TicketInstrument = {
  qty_step: 100,
  min_qty: 1000,
  taker_fee: 0.00003,
  max_leverage: 30,
  default_leverage: 2,
  price_precision: 3,
  bid: 153.357,
  ask: 153.371,
  conversion: { method: "inverse", rate: 0.00652, available: true },
  available: true,
};
const ctx = (instrument: TicketInstrument | null, extra: Partial<Parameters<typeof computeTicket>[1]> = {}) => ({
  instrument,
  last: 99995,
  precision: 2,
  equity: 10000,
  ...extra,
});
const with_ = (p: Partial<TicketState>): TicketState => ({ ...INITIAL_TICKET, ...p });

describe("ticket reducer", () => {
  test("defaults: BUY, market, risk sizing 1 %, account leverage", () => {
    assert.equal(INITIAL_TICKET.side, "buy");
    assert.equal(INITIAL_TICKET.type, "market");
    assert.equal(INITIAL_TICKET.sizing, "risk");
    assert.equal(INITIAL_TICKET.riskPct, "1");
    assert.equal(INITIAL_TICKET.leverage, null);
  });
  test("unchanged values keep the same object (no re-render)", () => {
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "side", side: "buy" }), INITIAL_TICKET);
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "set", field: "riskPct", value: "1" }), INITIAL_TICKET);
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "leverage", leverage: null }), INITIAL_TICKET);
  });
  test("field edits", () => {
    let s = ticketReducer(INITIAL_TICKET, { type: "side", side: "sell" });
    s = ticketReducer(s, { type: "orderType", orderType: "limit" });
    s = ticketReducer(s, { type: "set", field: "entry", value: "101" });
    s = ticketReducer(s, { type: "sizing", sizing: "manual" });
    s = ticketReducer(s, { type: "leverage", leverage: 5 });
    assert.deepEqual(
      { side: s.side, type: s.type, entry: s.entry, sizing: s.sizing, leverage: s.leverage },
      { side: "sell", type: "limit", entry: "101", sizing: "manual", leverage: 5 },
    );
  });
  test("a price picked on the chart: Entry decides LIMIT vs STOP, SL / TP set their fields", () => {
    const below = ticketReducer(INITIAL_TICKET, { type: "level", kind: "entry", price: 95.1234, market: 100, precision: 2 });
    assert.equal(below.type, "limit");
    assert.equal(below.entry, "95.12");
    const above = ticketReducer(INITIAL_TICKET, { type: "level", kind: "entry", price: 105, market: 100, precision: 2 });
    assert.equal(above.type, "stop");
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "level", kind: "stop", price: 98.5, market: 100, precision: 1 }).stop, "98.5");
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "level", kind: "target", price: 103, market: 100, precision: 2 }).target, "103.00");
    assert.equal(ticketReducer(INITIAL_TICKET, { type: "level", kind: "stop", price: -1, market: 100, precision: 2 }), INITIAL_TICKET);
  });
  test("new instrument drops levels, size and leverage but keeps side / sizing / risk / setup", () => {
    const s = with_({ side: "sell", entry: "1", stop: "2", target: "3", manualQty: "4", leverage: 10, riskPct: "0.5", sizing: "manual", setup: "breakout" });
    const r = ticketReducer(s, { type: "instrument" });
    assert.deepEqual(r, { ...s, entry: "", stop: "", target: "", manualQty: "", leverage: null });
  });
  test("placed / reset", () => {
    const s = with_({ stop: "99", target: "102", manualQty: "1", leverage: 2 });
    assert.deepEqual(ticketReducer(s, { type: "placed" }), { ...s, stop: "", target: "", manualQty: "", entry: "" });
    assert.equal(ticketReducer(s, { type: "reset" }), INITIAL_TICKET);
  });
});

describe("computeTicket", () => {
  test("market BUY uses the ASK; 1 % risk with a 1 % stop sizes ≈ $10k notional (capped by leverage)", () => {
    const c = computeTicket(with_({ stop: "99000" }), ctx(BTC));
    assert.equal(c.entry, 100000);
    assert.equal(c.stop, 99000);
    assert.equal(c.qty, 0.1);
    assert.equal(c.qtyText, "0.1");
    assert.equal(c.leverage, 2);
    assert.equal(c.leverageSource, "account");
    assert.equal(c.notional, 10000);
    assert.equal(c.margin, 5000);
    assert.equal(c.riskUsd, 100);
    assert.equal(c.riskPct, 1);
    assert.ok(c.canSubmit);
  });
  test("market SELL uses the BID", () => {
    const c = computeTicket(with_({ side: "sell", stop: "101000" }), ctx(BTC));
    assert.equal(c.entry, 99990);
  });
  test("free margin caps the quantity", () => {
    const c = computeTicket(with_({ stop: "99900", riskPct: "2" }), ctx(BTC, { freeMargin: 1000 }));
    assert.ok(c.cappedByMargin);
    assert.equal(c.qty, 0.02);
    assert.ok(ticketHints(c, with_({})).some((h) => h.text.includes("margin")));
  });
  test("per-order leverage is capped at the instrument max and used for the margin", () => {
    const c = computeTicket(with_({ stop: "152", leverage: 20 }), ctx(USDJPY, { last: 153.36, precision: 3 }));
    assert.equal(c.leverage, 20);
    assert.equal(c.leverageSource, "order");
    assert.deepEqual(c.leverageSteps, [1, 2, 3, 5, 10, 20, 25, 30]);
    assert.ok(c.margin !== null && Math.abs(c.margin - (c.notional as number) / 20) < 1e-9);
    assert.equal(effectiveLeverage({ leverage: 500 }, USDJPY).leverage, 30);
    assert.equal(effectiveLeverage({ leverage: null }, null).leverage, 1);
  });
  test("USD/JPY notional / risk are in USD", () => {
    const c = computeTicket(with_({ stop: "151.83" }), ctx(USDJPY, { last: 153.36, precision: 3 }));
    assert.equal(c.qty, 9700);
    assert.ok(c.notional !== null && Math.abs(c.notional - 9700) < 1e-6, `notional ${c.notional}`);
    assert.ok(c.riskUsd !== null && c.riskUsd > 95 && c.riskUsd <= 100.01, `risk ${c.riskUsd}`);
  });
  test("wrong-side stop / target block the order with a hint", () => {
    const c = computeTicket(with_({ stop: "101000" }), ctx(BTC));
    assert.ok(c.stopWrongSide);
    assert.equal(c.qty, 0);
    assert.ok(!c.canSubmit);
    assert.ok(ticketHints(c, with_({})).some((h) => h.tone === "warn" && h.text.includes("ПОД")));
    const t = computeTicket(with_({ sizing: "manual", manualQty: "0.01", target: "90000" }), ctx(BTC));
    assert.ok(t.targetWrongSide);
    assert.ok(!t.canSubmit);
  });
  test("risk sizing without a stop asks for one; manual size works without it", () => {
    const c = computeTicket(INITIAL_TICKET, ctx(BTC));
    assert.ok(c.needsStop);
    assert.equal(c.qty, 0);
    assert.ok(ticketHints(c, INITIAL_TICKET).some((h) => h.text.includes("stop loss")));
    const m = computeTicket(with_({ sizing: "manual", manualQty: "0,15" }), ctx(BTC));
    assert.equal(m.qty, 0.15);
    assert.equal(m.riskUsd, null);
    assert.ok(m.canSubmit);
  });
  test("limit orders need their price; below-minimum sizes cannot be sent", () => {
    const c = computeTicket(with_({ type: "limit", stop: "95" }), ctx(BTC));
    assert.ok(c.needsEntry);
    assert.ok(!c.canSubmit);
    const small = computeTicket(with_({ sizing: "manual", manualQty: "500" }), ctx(USDJPY, { last: 153.36 }));
    assert.ok(small.belowMin);
    assert.ok(!small.canSubmit);
  });
  test("no instrument data / unavailable instrument", () => {
    const none = computeTicket(with_({ stop: "99000" }), ctx(null));
    assert.equal(none.qty, 0, "no qty step → no risk sizing");
    const off = computeTicket(with_({ sizing: "manual", manualQty: "1" }), ctx({ ...BTC, available: false }));
    assert.ok(!off.canSubmit);
    const noPrice = computeTicket(with_({ sizing: "manual", manualQty: "1" }), ctx({ ...BTC, bid: null, ask: null }, { last: null }));
    assert.ok(noPrice.noPrice);
    assert.ok(!noPrice.canSubmit);
  });
  test("R:R and reward from stop / target", () => {
    const c = computeTicket(with_({ stop: "99000", target: "102000" }), ctx(BTC));
    assert.equal(c.rr, 2);
    assert.equal(c.rewardUsd, 200);
  });
});

describe("request body", () => {
  test("market order with SL / TP, risk %, account leverage (no leverage key)", () => {
    const t = with_({ stop: "99000", target: "102000" });
    const r = orderRequest("BTC/USDT", "15m", t, computeTicket(t, ctx(BTC)));
    assert.deepEqual(r, { symbol: "BTC/USDT", side: "buy", type: "market", qty: 0.1, timeframe: "15m", setup: "pullback", stop_loss: 99000, take_profit: 102000, risk_pct: 1 });
  });
  test("limit order sends its price and the chosen leverage", () => {
    const t = with_({ type: "limit", entry: "99500", stop: "98500", leverage: 1 });
    const r = orderRequest("BTC/USDT", "1h", t, computeTicket(t, ctx(BTC)));
    assert.equal(r?.price, 99500);
    assert.equal(r?.leverage, 1);
    assert.equal(r?.type, "limit");
  });
  test("nothing to send → null; keys identify requests", () => {
    assert.equal(orderRequest("BTC/USDT", "1h", INITIAL_TICKET, computeTicket(INITIAL_TICKET, ctx(BTC))), null);
    const t = with_({ sizing: "manual", manualQty: "0.2" });
    const r = orderRequest("BTC/USDT", "1h", t, computeTicket(t, ctx(BTC)));
    assert.equal(r?.risk_pct, undefined, "manual size sends no risk %");
    assert.equal(requestKey(null), "");
    assert.notEqual(requestKey(r), requestKey({ ...(r as NonNullable<typeof r>), qty: 0.3 }));
  });
});

describe("quick buttons, labels, chart levels, AI draft", () => {
  test("button sets: stop % before risk % (walkthrough clicks the first '1%')", () => {
    assert.deepEqual(STOP_PCTS.map((p) => `${p * 100}%`), ["0.5%", "1%", "2%"]);
    assert.deepEqual(TARGET_RS.map((r) => `${r}R`), ["1.5R", "2R", "3R"]);
    assert.deepEqual(RISK_PCTS.map((r) => `${r}%`), ["0.5%", "1%", "2%"]);
  });
  test("quick stop / target texts", () => {
    assert.equal(quickStopText({ entry: 100000 }, "buy", 0.01, 2), "99000.00");
    assert.equal(quickStopText({ entry: null }, "buy", 0.01, 2), null);
    assert.equal(quickTargetText({ entry: 100000, stop: 99000 }, "buy", 2, 2), "102000.00");
    assert.equal(quickTargetText({ entry: 100, stop: 101 }, "sell", 1.5, 3), "98.500");
    assert.equal(priceText(1.5, 3), "1.500");
  });
  test("submit label matches the walkthrough regex", () => {
    assert.match(submitLabel("buy", "0.1"), /BUY \/ LONG .* virtual/);
    assert.equal(submitLabel("sell", "0.15"), "SELL / SHORT 0.15 · virtual");
  });
  test("draft levels: entry only for limit / stop orders", () => {
    assert.deepEqual(draftLevels(with_({ entry: "99", stop: "98", target: "101" })).map((l) => l.id), ["draft-sl", "draft-tp"]);
    const lim = draftLevels(with_({ type: "limit", side: "sell", entry: "101", stop: "abc" }));
    assert.deepEqual(lim.map((l) => [l.id, l.price, l.title]), [["draft-entry", 101, "LIMIT SELL"]]);
  });
  test("AI draft", () => {
    const t = with_({ stop: "99000", target: "102000" });
    assert.deepEqual(aiDraft(t, computeTicket(t, ctx(BTC))), { side: "buy", entry: 100000, stop: 99000, target: 102000, qty: 0.1 });
    assert.equal(aiDraft(INITIAL_TICKET, computeTicket(INITIAL_TICKET, ctx(null, { last: null }))), null);
  });
});
