"use client";

import { useCallback, useMemo, useState } from "react";

import { downloadDataUrl } from "@/components/charts/capture";
import { normSymbol } from "@/components/charts/chartMath";
import type { PriceLineDef } from "@/components/charts/TradingChart";
import { useChartWorkspace } from "@/components/charts/useChartWorkspace";
import { screenshotName } from "@/components/terminal/model";
import type { PricePick } from "@/components/terminal/PriceLevelChooser";
import type { TradeCapture } from "@/components/trading/Tables";
import { aiDraft, computeTicket, draftLevels, type LevelKind } from "@/components/trading/ticket";
import { useOrderTicket } from "@/components/trading/useOrderTicket";
import { marketEntry } from "@/lib/sizing";
import { useAccount, usePaperInstrument, usePaperTrades } from "@/lib/hooks";
import { CHART } from "@/lib/theme";
import type { AccountView, Order } from "@/lib/types";

const LEVEL_COLOR: Record<LevelKind, string> = { entry: CHART.accent2, stop: CHART.down, target: CHART.up };

/**
 * Everything a paper terminal page shares: account / trades / instrument data, the order ticket (shared by
 * the order panel, the chart's draft lines + click-to-set and the AI draft), the chart workspace and the
 * screenshot / journal capture. Polling: account 5 s, trades 15 s, candles 5 s, instrument 10 s.
 */
export function usePaperTerminal({ storageKey, symbol, timeframe, beginner }: { storageKey: string; symbol: string; timeframe: string; beginner: boolean }) {
  const account = useAccount(5000);
  const trades = usePaperTrades(200, 15_000);
  const instrument = usePaperInstrument(symbol);
  const inst = instrument.data && normSymbol(instrument.data.symbol) === normSymbol(symbol) ? instrument.data : null;
  const ticket = useOrderTicket(symbol);
  const view: AccountView | undefined = account.data;

  // draft levels of the ticket → dashed price lines on the chart
  const levels = useMemo(() => draftLevels(ticket.state), [ticket.state]);
  const draftLines = useMemo<PriceLineDef[]>(
    () => levels.map((l) => ({ id: l.id, price: l.price, color: LEVEL_COLOR[l.kind], title: l.title, dashed: true })),
    [levels],
  );

  const ws = useChartWorkspace({
    symbol,
    timeframe,
    storageKey,
    positions: view?.positions,
    orders: view?.orders,
    trades: trades.data?.trades,
    extraPriceLines: draftLines,
    showLiquidation: !beginner,
  });

  const precision = inst?.price_precision ?? ws.precision;
  const freeMargin = view ? (view.available_margin ?? view.free_margin) : undefined;
  const calc = useMemo(
    () => computeTicket(ticket.state, { instrument: inst, last: ws.lastPrice, precision, equity: view?.equity ?? 0, freeMargin }),
    [ticket.state, inst, ws.lastPrice, precision, view?.equity, freeMargin],
  );
  const draft = useMemo(() => aiDraft(ticket.state, calc), [ticket.state, calc]);

  const { mutate: mutateAccount } = account;
  const { mutate: mutateTrades } = trades;
  const refresh = useCallback(() => {
    void mutateAccount();
    void mutateTrades();
  }, [mutateAccount, mutateTrades]);
  const onPlaced = useCallback(
    (res: { order: Order; view: AccountView }) => {
      void mutateAccount(res.view, { revalidate: false });
      void mutateTrades();
    },
    [mutateAccount, mutateTrades],
  );

  const { captureRef } = ws;
  /** journal screenshot: the chart scrolled to the trade (only when the trade is on the charted instrument) */
  const captureTrade: TradeCapture = useCallback(
    async (t) => {
      const cap = captureRef.current;
      if (!cap || normSymbol(t.symbol) !== normSymbol(symbol)) return null;
      return cap({ focus: { from: t.opened_ts, to: t.closed_ts }, mime: "image/jpeg", quality: 0.82 });
    },
    [captureRef, symbol],
  );
  /** chart screenshot (PNG incl. drawings) → download; false when the chart is not ready */
  const screenshot = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return false;
    const url = await cap({ mime: "image/png" });
    if (!url) return false;
    downloadDataUrl(url, screenshotName(symbol, timeframe, Date.now() / 1000));
    return true;
  }, [captureRef, symbol, timeframe]);

  // click-to-set (chart → "set as Entry / SL / TP")
  const [pick, setPick] = useState<PricePick | null>(null);
  const onPriceClick = useCallback((price: number, at?: { x: number; y: number }) => {
    if (at && Number.isFinite(price) && price > 0) setPick({ price, x: at.x, y: at.y });
  }, []);
  const closePick = useCallback(() => setPick(null), []);
  const { dispatch } = ticket;
  const side = ticket.state.side;
  const market = marketEntry(side, inst?.bid, inst?.ask, ws.lastPrice);
  const chooseLevel = useCallback(
    (kind: LevelKind, price: number) => {
      dispatch({ type: "level", kind, price, market, precision });
      setPick(null);
    },
    [dispatch, market, precision],
  );

  return {
    account,
    view,
    trades,
    instrument: inst,
    instrumentError: instrument.error,
    ticket,
    calc,
    draft,
    ws,
    precision,
    refresh,
    onPlaced,
    captureTrade,
    screenshot,
    pick: pick && ws.tool === "cursor" ? pick : null,
    onPriceClick,
    closePick,
    chooseLevel,
  };
}

export type PaperTerminal = ReturnType<typeof usePaperTerminal>;
