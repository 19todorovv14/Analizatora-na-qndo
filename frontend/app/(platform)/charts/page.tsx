"use client";

import { Sparkles, Star, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AIPanel } from "@/components/ai/AIPanel";
import { ChartCanvas } from "@/components/charts/ChartCanvas";
import { DrawToolbar } from "@/components/charts/ChartControls";
import { WatchlistPanel } from "@/components/market/WatchlistPanel";
import { CompareGrid } from "@/components/terminal/CompareGrid";
import { readTerminalQuery, termKey } from "@/components/terminal/model";
import { usePaperBottomPanel } from "@/components/terminal/PaperBottomPanel";
import { PriceLevelChooser } from "@/components/terminal/PriceLevelChooser";
import { TerminalLayout, useTerminalLayout } from "@/components/terminal/TerminalLayout";
import { TerminalTopBar } from "@/components/terminal/TerminalTopBar";
import { usePaperTerminal } from "@/components/terminal/usePaperTerminal";
import { useTerminalHotkeys } from "@/components/terminal/useTerminalHotkeys";
import { AccountBlock } from "@/components/trading/AccountBlock";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { useStoredState } from "@/components/ui";
import { useLocalState } from "@/lib/hooks";
import { useSession } from "@/lib/session";

type RightTab = "ai" | "watchlist" | "trade";
const RIGHT_TABS = [
  { key: "ai", label: "AI", icon: Sparkles },
  { key: "watchlist", label: "Watchlist", icon: Star },
  { key: "trade", label: "Trade", icon: Wallet },
];
const asRightTab = (v: unknown) => (v === "ai" || v === "watchlist" || v === "trade" ? (v as RightTab) : undefined);

/**
 * PRO chart terminal: top bar (instrument search + quote, timeframes, indicators, chart type, compare,
 * replay, screenshot, layout), left drawing tools, chart with volume / indicator panes, bottom panel
 * (positions, orders, history, activity, replay + session clock), right panel (AI | Watchlist | Trade).
 * Hotkeys: Alt+1…8 timeframes, H T R M tools, Esc cursor, B / S order side, "]" / "\" panels.
 */
export default function ChartsPage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-chart-symbol", "BTC/USDT");
  const [timeframe, setTimeframe] = useLocalState("ta-chart-tf", "1h");
  const [compare, setCompare] = useState(false);
  const [rightTab, setRightTab] = useStoredState<RightTab>(termKey("charts", "right-tab"), "ai", { validate: asRightTab });

  useEffect(() => {
    const q = readTerminalQuery(window.location.search);
    if (q.symbol) setSymbol(q.symbol);
    if (q.timeframe) setTimeframe(q.timeframe);
  }, [setSymbol, setTimeframe]);

  const layout = useTerminalLayout("charts", { right: { def: 340 }, bottom: { def: 200 }, bottomOpen: false });
  const term = usePaperTerminal({ storageKey: "charts", symbol, timeframe, beginner });
  const { ws, ticket, view, instrument } = term;

  const { dispatch } = ticket;
  const { openRight } = layout;
  const onSide = useCallback(
    (side: "buy" | "sell") => {
      dispatch({ type: "side", side });
      setRightTab("trade");
      openRight();
    },
    [dispatch, setRightTab, openRight],
  );
  useTerminalHotkeys({ onTimeframe: setTimeframe, onTool: ws.setTool, onSide, toggleRight: layout.toggleRight, toggleBottom: layout.toggleBottom });

  const bottom = usePaperBottomPanel({
    route: "charts",
    view,
    viewError: term.account.error,
    trades: term.trades.data?.trades,
    beginner,
    symbol,
    timeframe,
    marketStatus: instrument?.market_status,
    onChanged: term.refresh,
    onSelectSymbol: setSymbol,
    capture: term.captureTrade,
  });

  // click-to-set levels only while the order ticket is on screen
  const tradeVisible = rightTab === "trade" && (layout.desktop ? layout.rightOpen : layout.sheetOpen);

  return (
    <TerminalLayout
      layout={layout}
      top={
        <TerminalTopBar
          layout={layout}
          ws={ws}
          symbol={symbol}
          onSymbol={setSymbol}
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          instrument={instrument}
          precision={term.precision}
          beginner={beginner}
          onScreenshot={term.screenshot}
          compare={{ on: compare, toggle: () => setCompare((c) => !c) }}
        />
      }
      left={
        compare
          ? undefined
          : (orientation) => (
              <DrawToolbar tool={ws.tool} onTool={ws.setTool} color={ws.color} onColor={ws.setColor} onClear={ws.clearDrawings} orientation={orientation} />
            )
      }
      chart={
        compare ? (
          <CompareGrid symbol={symbol} onExit={() => setCompare(false)} />
        ) : (
          <ChartCanvas ws={ws} beginner={beginner} onPriceClick={tradeVisible ? term.onPriceClick : undefined}>
            {tradeVisible && term.pick && <PriceLevelChooser pick={term.pick} precision={term.precision} onChoose={term.chooseLevel} onClose={term.closePick} />}
          </ChartCanvas>
        )
      }
      right={{
        tabs: RIGHT_TABS,
        active: rightTab,
        onActive: (k) => setRightTab(asRightTab(k) ?? "ai"),
        render: (tab) =>
          tab === "watchlist" ? (
            <WatchlistPanel activeSymbol={symbol} onSelect={setSymbol} compact className="h-full" />
          ) : tab === "trade" ? (
            <div className="space-y-4 p-3">
              <AccountBlock view={view} advanced={!beginner} />
              <div className="h-px bg-white/[0.06]" aria-hidden />
              <OrderPanel
                symbol={symbol}
                price={ws.lastPrice}
                precision={term.precision}
                equity={view?.equity ?? 0}
                timeframe={timeframe}
                beginner={beginner}
                ticket={ticket}
                account={view}
                instrument={instrument}
                onPlaced={term.onPlaced}
                chartPick
              />
            </div>
          ) : (
            <div className="h-full p-3">
              <AIPanel symbol={symbol} timeframe={timeframe} draft={term.draft} compact className="h-full" />
            </div>
          ),
      }}
      bottom={bottom}
    />
  );
}
