"use client";

import { Landmark, Sparkles, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AIPanel } from "@/components/ai/AIPanel";
import { ChartCanvas } from "@/components/charts/ChartCanvas";
import { DrawToolbar } from "@/components/charts/ChartControls";
import { readTerminalQuery } from "@/components/terminal/model";
import { usePaperBottomPanel } from "@/components/terminal/PaperBottomPanel";
import { PriceLevelChooser } from "@/components/terminal/PriceLevelChooser";
import { TerminalLayout, useTerminalLayout } from "@/components/terminal/TerminalLayout";
import { TerminalTopBar } from "@/components/terminal/TerminalTopBar";
import { usePaperTerminal } from "@/components/terminal/usePaperTerminal";
import { useTerminalHotkeys } from "@/components/terminal/useTerminalHotkeys";
import { AccountBlock } from "@/components/trading/AccountBlock";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { useLocalState } from "@/lib/hooks";
import { useSession } from "@/lib/session";

type Section = "order" | "account" | "ai";
const SECTIONS = [
  { key: "order", label: "Order", icon: Wallet },
  { key: "account", label: "Account", icon: Landmark },
  { key: "ai", label: "AI", icon: Sparkles },
];

/**
 * PAPER TRADING terminal: chart (drawings, indicators, positions / orders / draft levels, click-to-set
 * Entry / SL / TP) + right panel (paper account, order ticket with leverage, AI "Explain this setup" /
 * "WHY?") + bottom panel (positions, orders, history with AI review and journal, activity, replay).
 * Virtual money only — orders never leave the paper engine.
 */
export default function TradePage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-paper-symbol", "BTC/USDT");
  const [timeframe, setTimeframe] = useLocalState("ta-paper-tf", "15m");
  const [section, setSection] = useState<Section>("order");

  useEffect(() => {
    const q = readTerminalQuery(window.location.search);
    if (q.symbol) setSymbol(q.symbol);
    if (q.timeframe) setTimeframe(q.timeframe);
  }, [setSymbol, setTimeframe]);

  const layout = useTerminalLayout("trade", { right: { def: 360 } });
  const term = usePaperTerminal({ storageKey: "paper", symbol, timeframe, beginner });
  const { ws, ticket, view, instrument } = term;

  const { dispatch } = ticket;
  const onSide = useCallback((side: "buy" | "sell") => dispatch({ type: "side", side }), [dispatch]);
  useTerminalHotkeys({ onTimeframe: setTimeframe, onTool: ws.setTool, onSide, toggleRight: layout.toggleRight, toggleBottom: layout.toggleBottom });

  const bottom = usePaperBottomPanel({
    route: "trade",
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

  const orderPanel = (
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
      onSymbol={setSymbol}
      onPlaced={term.onPlaced}
      chartPick
    />
  );
  const aiBlock = (compactHeight: boolean) => (
    <div className={compactHeight ? "h-[480px]" : "h-full min-h-[420px]"}>
      <AIPanel symbol={symbol} timeframe={timeframe} draft={term.draft} compact defaultTab="explain" className="h-full" />
    </div>
  );

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
          paperBadge
        />
      }
      left={(orientation) => (
        <DrawToolbar tool={ws.tool} onTool={ws.setTool} color={ws.color} onColor={ws.setColor} onClear={ws.clearDrawings} orientation={orientation} />
      )}
      chart={
        <ChartCanvas ws={ws} beginner={beginner} onPriceClick={term.onPriceClick}>
          {term.pick && <PriceLevelChooser pick={term.pick} precision={term.precision} onChoose={term.chooseLevel} onClose={term.closePick} />}
        </ChartCanvas>
      }
      right={{
        tabs: SECTIONS,
        active: section,
        onActive: (k) => setSection(k as Section),
        stacked: true,
        title: "Paper trading",
        render: (tab) =>
          tab === null ? (
            <div className="space-y-4 p-3">
              <AccountBlock view={view} advanced={!beginner} />
              <div className="h-px bg-white/[0.06]" aria-hidden />
              {orderPanel}
              <div className="h-px bg-white/[0.06]" aria-hidden />
              <section aria-label="AI анализ" className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  <Sparkles size={13} className="text-accent2" aria-hidden /> AI analysis
                </h3>
                {aiBlock(true)}
              </section>
            </div>
          ) : tab === "account" ? (
            <div className="p-3">
              <AccountBlock view={view} advanced />
            </div>
          ) : tab === "ai" ? (
            <div className="h-full p-3">{aiBlock(false)}</div>
          ) : (
            <div className="p-3">{orderPanel}</div>
          ),
      }}
      bottom={bottom}
    />
  );
}
