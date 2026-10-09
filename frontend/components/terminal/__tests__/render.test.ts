/*
 * Server-render tests of the paper terminal components (react-dom/server + SWR fallback data shaped like
 * the real /api/paper responses). They pin the walkthrough anchors ("Order panel", first "1%" = stop,
 * "2R", "Manual size", "SL/TP", "Close", "History", "AI review", "📓"), DATA NOT AVAILABLE handling, the
 * leverage sentence, and the terminal frame (grid areas, panels, rail, tabs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { History as HistoryIcon, Layers, Sparkles, Wallet } from "lucide-react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";

import { ChartWorkspace } from "@/components/charts/ChartWorkspace";
import { CompareGrid } from "@/components/terminal/CompareGrid";
import { ReplayCard } from "@/components/terminal/PaperBottomPanel";
import { PriceLevelChooser } from "@/components/terminal/PriceLevelChooser";
import { SessionInfo } from "@/components/terminal/SessionInfo";
import { TerminalLayout, useTerminalLayout } from "@/components/terminal/TerminalLayout";
import { InstrumentHeader } from "@/components/terminal/TerminalTopBar";
import { AccountBlock, marginLevelPct } from "@/components/trading/AccountBlock";
import { ActivityList, eventTone } from "@/components/trading/ActivityList";
import { LEVERAGE_WARNING, LeverageControl, stepIndex } from "@/components/trading/LeverageControl";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { OrdersTable, PositionsTable, TradesTable, isWideningStop } from "@/components/trading/Tables";
import type { AccountView, Order, PaperEvent, PaperInstrument, Position, Trade } from "@/lib/types";

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {}, hmrRefresh() {} };
function render(el: ReactElement, fallback: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router as never }, h(SWRConfig, { value: { fallback, provider: () => new Map() } }, el)),
  );
}
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
/** accessible names of the <button>s in document order (text content; aria-label when set) */
const buttons = (markup: string) =>
  Array.from(markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)).map((m) => {
    const aria = /aria-label="([^"]*)"/.exec(m[1]);
    return aria ? aria[1] : text(m[2]).trim();
  });
const FORBIDDEN = [/BUY NOW/i, /SELL NOW/i, /guaranteed/i, /risk[- ]free/i, /easy money/i, /100% win/i, /recommended leverage/i, /препоръч/i];
const assertSafe = (s: string) => FORBIDDEN.forEach((re) => assert.doesNotMatch(s, re));

const demoSource = { id: "demo", name: "Demo data (synthetic)", is_live: false, disclaimer: "Synthetic", status: "demo" as const };
const btc: PaperInstrument = {
  symbol: "BTC/USDT",
  name: "Bitcoin / Tether",
  asset_class: "crypto",
  price_precision: 2,
  qty_step: 0.0001,
  min_qty: 0.0001,
  maker_fee: 0.0004,
  taker_fee: 0.0006,
  spread_bps: 2,
  max_leverage: 2,
  default_leverage: 2,
  account_leverage: 2,
  margin_mode: "cross",
  stop_out_level: 0.5,
  currency: "USD",
  quote_currency: "USDT",
  daily_vol: 0.04,
  daily_vol_source: "instrument",
  leverage_warning: LEVERAGE_WARNING,
  execution: {},
  available: true,
  unavailable_reason: null,
  code: null,
  bid: 104795.11,
  ask: 104805.59,
  mid: 104800.35,
  spread: 10.48,
  source: demoSource,
  conversion: { quote_currency: "USDT", account_currency: "USD", method: "identity", route: null, rate: 1, available: true, reason: null },
  market_status: { status: "open", label: "Отворен 24/7", session: "crypto", session_name: "24/7", timezone: "UTC", next_change_ts: null, note: null },
};
const position: Position = {
  id: "p1",
  symbol: "BTC/USDT",
  side: "long",
  qty: 0.0852,
  initial_qty: 0.0852,
  entry_price: 104809.73,
  mark_price: 104799.21,
  stop_loss: 103758.44,
  take_profit: 106902.65,
  initial_stop: 103758.44,
  leverage: 2,
  margin: 4464.89,
  unrealized_pnl: -1.34,
  unrealized_r: -0.01,
  realized_pnl: 0,
  liquidation_price: 52990.1,
  opened_ts: 1791382892,
  precision: 2,
  setup: "pullback",
  timeframe: "15m",
  risk_pct: 1,
  mark_available: true,
  liquidation_distance_pct: 49.4,
};
const order: Order = {
  id: "o1",
  symbol: "ETH/USDT",
  side: "buy",
  type: "limit",
  qty: 0.5,
  filled_qty: 0,
  price: 1300,
  avg_fill_price: null,
  stop_loss: 1250,
  take_profit: 1400,
  status: "open",
  fees: 0,
  slippage_cost: 0,
  reject_reason: null,
  created_ts: 1791382000,
  leverage: null,
  effective_leverage: 2,
};
const trade: Trade = {
  id: "t1",
  position_id: "p0",
  symbol: "BTC/USDT",
  side: "long",
  qty: 0.0426,
  entry_price: 104822.12,
  exit_price: 104802.04,
  stop_price: 103770,
  target_price: 106900,
  gross_pnl: -0.86,
  fees: 5.35,
  net_pnl: -6.21,
  risk_amount: 50,
  r_multiple: -0.14,
  exit_reason: "partial_close",
  opened_ts: 1791382000,
  closed_ts: 1791382600,
  meta: { setup: "pullback", leverage: 2 },
};
const view = (over: Partial<AccountView> = {}): AccountView => ({
  account: { id: 1, name: "Main paper account", kind: "manual", initial_balance: 10000, leverage: 2, execution: {} },
  currency: "USD",
  balance: 9994.64,
  equity: 9993.3,
  unrealized_pnl: -1.34,
  realized_pnl: -6.21,
  fees_paid: 5.36,
  used_margin: 4464.89,
  free_margin: 5528.4,
  available_margin: 5528.4,
  margin_level: 2.238,
  margin_level_pct: 223.8,
  stop_out_level: 0.5,
  exposure: 8929.78,
  day_pnl: -7.55,
  max_drawdown_pct: 0.07,
  metrics: {} as AccountView["metrics"],
  positions: [position],
  orders: [order],
  virtual_funds_notice: "PAPER TRADING — всички средства и сделки са виртуални.",
  ...over,
});

describe("OrderPanel", () => {
  const panel = (inst: PaperInstrument, extra: Record<string, unknown> = {}) =>
    render(h(OrderPanel, { symbol: "BTC/USDT", price: 104800, precision: 2, equity: 10000, timeframe: "15m", instrument: inst, ...extra }));

  test("walkthrough anchors and button order (stop 1% before risk 1%)", () => {
    const m = panel(btc, { account: view() });
    const t = text(m);
    assert.match(t, /Order panel/);
    const b = buttons(m);
    for (const name of ["BUY / LONG", "SELL / SHORT", "Manual size", "By risk %", "2R", "1.5R", "3R"]) assert.ok(b.includes(name), `missing button ${name}`);
    assert.equal(b.filter((x) => x === "SELL / SHORT").length, 1, "exactly one SELL / SHORT button");
    const firstOnePct = b.indexOf("1%");
    assert.ok(firstOnePct > b.indexOf("0.5%") && firstOnePct < b.indexOf("1.5R"), "the first '1%' is the stop-distance button");
    assert.equal(b.filter((x) => x === "1%").length, 2, "stop 1% + risk 1%");
    assert.ok(b.some((x) => /^BUY \/ LONG .* virtual$/.test(x)), "submit label");
    assert.match(m, /<button[^>]*disabled=""[^>]*>BUY \/ LONG\s+· virtual<\/button>/, "nothing to submit without a stop");
    assert.match(t, /Задай stop loss, за да изчисля размера/);
    assert.match(t, /Виртуална поръчка/);
    assertSafe(t);
  });
  test("leverage block: capped steps, account default, the fixed risk sentence", () => {
    const t = text(panel(btc));
    assert.match(t, /Leverage/);
    assert.match(t, /max 2x/);
    assert.match(t, /Higher leverage magnifies exposure and liquidation risk\./);
    assert.match(t, /Account leverage/);
  });
  test("market data: bid / ask / session; Asset search when onSymbol is given", () => {
    const m = panel(btc, { onSymbol: () => {} });
    assert.match(text(m), /Bid 104,795\.11 · Ask 104,805\.59/);
    assert.match(text(m), /Отворен 24\/7/);
    assert.match(m, /aria-label="Asset"/);
  });
  test("DATA NOT AVAILABLE instrument and closed market", () => {
    const na = text(panel({ ...btc, available: false, code: "DATA_NOT_AVAILABLE", unavailable_reason: "No provider serves BTC/USDT", bid: null, ask: null, mid: null }));
    assert.match(na, /DATA NOT AVAILABLE/);
    assert.match(na, /No provider serves BTC\/USDT/);
    const closed = text(panel({ ...btc, market_status: { status: "closed", label: "Затворен" } }));
    assert.match(closed, /Пазарът е затворен/);
  });
});

describe("AccountBlock / LeverageControl", () => {
  test("paper account metrics (Term-wrapped labels) and margin level", () => {
    const t = text(render(h(AccountBlock, { view: view() })));
    for (const l of ["Paper account", "Balance", "Equity", "Available margin", "Used margin", "Unrealized P/L", "Margin level"]) assert.match(t, new RegExp(l));
    assert.match(t, /\$5,528\.40/);
    assert.match(t, /224%/);
    assert.doesNotMatch(t, /Realized P\/L/, "advanced-only tiles hidden");
    assert.match(text(render(h(AccountBlock, { view: view(), advanced: true }))), /Realized P\/L.*Exposure/);
  });
  test("flat account → margin level '—'; loading → skeleton", () => {
    const flat = view({ positions: [], used_margin: 0, margin_level: null, margin_level_pct: null });
    assert.equal(marginLevelPct(flat), null);
    assert.match(text(render(h(AccountBlock, { view: flat }))), /Margin level —/);
    assert.equal(marginLevelPct({ margin_level: 1.5, margin_level_pct: undefined }), 150);
    assert.match(render(h(AccountBlock, { view: null })), /aria-busy/);
  });
  test("leverage slider", () => {
    const m = render(
      h(LeverageControl, { value: 5, effective: 5, accountDefault: 2, max: 30, steps: [1, 2, 3, 5, 10, 20, 25, 30], onChange: () => {}, liquidation: 77.6642, liquidationDistancePct: 49.36, precision: 3 }),
    );
    const t = text(m);
    assert.match(t, /5x max 30x/);
    assert.match(t, /Account \(2x\)/);
    assert.match(t, /≈ 77\.664 \(49\.4%\)/);
    assert.match(m, /type="range"[^>]*max="7"/);
    assert.equal(stepIndex([1, 2, 3, 5], 4), 2);
    assert.equal(stepIndex([], 4), 0);
    assertSafe(t);
  });
});

describe("tables", () => {
  test("positions: SL/TP + Close per row, advanced columns, sticky actions", () => {
    const beginner = render(h(PositionsTable, { positions: [position], onChanged: () => {}, beginner: true }));
    const b = buttons(beginner);
    assert.deepEqual(b, ["SL/TP", "Close"]);
    assert.doesNotMatch(text(beginner), /Liq\. price/);
    const adv = text(render(h(PositionsTable, { positions: [position], onChanged: () => {}, beginner: false })));
    assert.match(adv, /Lev\. Margin Liq\. price/);
    assert.match(adv, /52,990\.10 \(49\.4%\)/);
  });
  test("a position without a market price shows DATA NOT AVAILABLE instead of P/L", () => {
    const t = text(render(h(PositionsTable, { positions: [{ ...position, mark_available: false, stop_loss: null }], onChanged: () => {}, beginner: true })));
    assert.match(t, /N\/A/);
    assert.match(t, /DATA NOT AVAILABLE/);
    assert.match(t, /няма!/);
    assert.doesNotMatch(t, /-\$1\.34/);
  });
  test("orders: Cancel and effective leverage; trades: AI review + 📓; empty states", () => {
    const o = render(h(OrdersTable, { orders: [order], onChanged: () => {} }));
    assert.deepEqual(buttons(o), ["Cancel"]);
    assert.match(text(o), /2x/);
    const tr = render(h(TradesTable, { trades: [trade] }));
    assert.deepEqual(buttons(tr), ["AI review", "📓"]);
    assert.match(text(tr), /partial close/);
    assert.match(text(render(h(PositionsTable, { positions: [], onChanged: () => {}, beginner: true }))), /Няма отворени позиции/);
    assert.match(text(render(h(OrdersTable, { orders: [], onChanged: () => {} }))), /Няма чакащи поръчки/);
  });
  test("stop widening detection", () => {
    assert.ok(isWideningStop("long", 100, 99));
    assert.ok(!isWideningStop("long", 100, 101));
    assert.ok(isWideningStop("short", 100, 101));
    assert.ok(!isWideningStop("short", null, 101));
  });
  test("activity list", () => {
    const events: PaperEvent[] = [
      { id: 2, ts: 1791382600, type: "stop_loss", message: "Stop loss задейства" },
      { id: 1, ts: 1791382000, type: "order_filled", message: "Поръчката е изпълнена" },
    ];
    const t = text(render(h(ActivityList, { events })));
    assert.match(t, /stop loss Stop loss задейства/);
    assert.equal(eventTone("liquidation"), "down");
    assert.equal(eventTone("take_profit"), "up");
    assert.equal(eventTone("order_filled"), "info");
    assert.equal(eventTone("note"), "neutral");
    assert.match(text(render(h(ActivityList, { events: [] }))), /Още няма активност/);
  });
});

describe("terminal frame", () => {
  const Frame = ({ rightOpen = true, bottomOpen = true, stacked = false }: { rightOpen?: boolean; bottomOpen?: boolean; stacked?: boolean }) => {
    const layout = useTerminalLayout("test", { rightOpen, bottomOpen });
    return h(TerminalLayout, {
      layout,
      top: h("div", null, "TOP"),
      left: (o: string) => h("div", null, `TOOLS-${o}`),
      chart: h("div", null, "CHART"),
      right: {
        tabs: [
          { key: "ai", label: "AI", icon: Sparkles },
          { key: "trade", label: "Trade", icon: Wallet },
        ],
        active: "trade",
        onActive: () => {},
        stacked,
        title: "Paper trading",
        render: (tab: string | null) => h("div", null, `RIGHT-${tab ?? "ALL"}`),
      },
      bottom: {
        tabs: [
          { key: "positions", label: "Positions", icon: Layers, badge: 1 },
          { key: "history", label: "History", icon: HistoryIcon, badge: 2 },
        ],
        active: "positions",
        onActive: () => {},
        render: (tab: string) => h("div", null, `BOTTOM-${tab}`),
        extra: h("span", null, "CLOCK"),
      },
    });
  };
  test("desktop grid: areas, resize handles, tabs, vertical tools", () => {
    const m = render(h(Frame));
    assert.match(m, /grid-template-areas:&quot;top top top top&quot; &quot;left chart rh right&quot;/);
    assert.match(m, /grid-template-columns:auto minmax\(0,1fr\) 6px 340px/);
    assert.equal((m.match(/role="separator"/g) ?? []).length, 2);
    const t = text(m);
    for (const s of ["TOP", "TOOLS-vertical", "CHART", "RIGHT-trade", "BOTTOM-positions", "CLOCK"]) assert.match(t, new RegExp(s));
    const b = buttons(m);
    assert.ok(b.includes("History 2") && b.includes("Positions 1"));
    assert.equal(b.filter((x) => /History/.test(x)).length, 1, "one History button");
    assert.ok(b.includes("Свий десния панел") && b.includes("Скрий долния панел"));
    assert.ok(!b.includes("Close"), "no button named exactly Close in the frame");
  });
  test("collapsed panels: right rail with tab icons, bottom header only; stacked right panel", () => {
    const m = render(h(Frame, { rightOpen: false, bottomOpen: false }));
    const t = text(m);
    assert.doesNotMatch(t, /RIGHT-|BOTTOM-/);
    assert.match(m, /grid-template-columns:auto minmax\(0,1fr\) 0px 44px/);
    const b = buttons(m);
    assert.ok(b.includes("Разгъни десния панел") && b.includes("AI") && b.includes("Trade") && b.includes("Покажи долния панел"));
    assert.equal((m.match(/role="separator"/g) ?? []).length, 0);
    const st = text(render(h(Frame, { stacked: true })));
    assert.match(st, /Paper trading/);
    assert.match(st, /RIGHT-ALL/);
  });
});

describe("terminal pieces", () => {
  test("price-level chooser", () => {
    const m = render(h(PriceLevelChooser, { pick: { price: 104000.5, x: 100, y: 40 }, precision: 2, onChoose: () => {}, onClose: () => {} }));
    assert.deepEqual(buttons(m), ["Entry", "SL", "TP", "Затвори"]);
    assert.match(text(m), /Set as 104,000\.50/);
    assert.match(m, /left:110px;top:24px/);
  });
  test("replay card links the current instrument / timeframe", () => {
    const m = render(h(ReplayCard, { symbol: "BTC/USDT", timeframe: "1h" }));
    assert.match(m, /href="\/replay\?symbol=BTC%2FUSDT&amp;tf=1h"/);
    assert.match(text(m), /Replay BTC\/USDT · 1H/);
  });
  test("session info (SSR: clock not started yet)", () => {
    const t = text(render(h(SessionInfo, { timeframe: "4h", marketStatus: btc.market_status })));
    assert.match(t, /--:--:-- UTC/);
    assert.match(t, /4H close —/);
  });
  test("instrument header: combobox, price, 24h change, DEMO source", () => {
    const quotes = { quotes: { "BTC/USDT": { symbol: "BTC/USDT", available: true, status: "ok", price: 104800, change_24h_pct: -1.88, source: demoSource } } };
    const m = render(h(InstrumentHeader, { symbol: "BTC/USDT", onSymbol: () => {}, name: "Bitcoin / Tether", price: 104800.35, precision: 2, source: demoSource, marketStatus: btc.market_status }), {
      "/markets/quotes?symbols=BTC%2FUSDT": quotes,
    });
    const t = text(m);
    assert.match(t, /104,800\.35/);
    assert.match(t, /1\.88%/);
    assert.match(t, /Bitcoin \/ Tether/);
    assert.match(t, /DEMO/i);
  });
  test("compare grid keeps '← Single chart' and the 4 timeframes", () => {
    const t = text(render(h(CompareGrid, { symbol: "BTC/USDT", onExit: () => {} })));
    assert.match(t, /← Single chart/);
    assert.match(t, /5m .*1H .*4H .*1D/);
  });
  test("classic ChartWorkspace wrapper keeps the walkthrough controls", () => {
    const m = render(h(ChartWorkspace, { symbol: "BTC/USDT", onSymbol: () => {}, timeframe: "1h", onTimeframe: () => {}, height: 400 }));
    assert.match(m, /title="Horizontal line — /);
    assert.match(m, /title="Cursor — /);
    const b = buttons(m);
    assert.ok(b.includes("4H") && b.includes("1H"));
    assert.equal(b.filter((x) => /Indicators/.test(x)).length, 1, "exactly one Indicators button");
  });
});
