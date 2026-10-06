"use client";

import type { IChartApi } from "lightweight-charts";
import { useCallback, useRef, useState } from "react";
import useSWR from "swr";

import { ChartWorkspace } from "@/components/charts/ChartWorkspace";
import { captureChart } from "@/components/charts/capture";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { AccountMetrics, OrdersTable, PositionsTable, TradesTable } from "@/components/trading/Tables";
import { Badge, Card, Loading, Tabs } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useAccount, useLocalState } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { CandlesResponse, Trade } from "@/lib/types";

type Tab = "positions" | "orders" | "history" | "activity";

export default function PaperPage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-paper-symbol", "BTC/USDT");
  const [timeframe, setTimeframe] = useLocalState("ta-paper-tf", "15m");
  const [tab, setTab] = useState<Tab>("positions");
  const [price, setPrice] = useState<number | null>(null);
  const [precision, setPrecision] = useState(2);
  const chartApi = useRef<IChartApi | null>(null);
  const { data: view, mutate } = useAccount(5000);
  const { data: trades, mutate: mutateTrades } = useSWR<{ trades: Trade[] }>("/paper/trades?limit=200", fetcher, { refreshInterval: 10000 });
  const { data: events } = useSWR<{ events: { id: number; ts: number; type: string; message: string }[] }>("/paper/events", fetcher, {
    refreshInterval: 10000,
  });

  const onData = useCallback((d: CandlesResponse) => {
    if (d.candles.length) setPrice(d.candles[d.candles.length - 1].close);
    setPrecision(d.precision);
  }, []);

  const refresh = () => {
    mutate();
    mutateTrades();
  };

  const capture = () => (chartApi.current ? captureChart(chartApi.current, "image/jpeg", 0.8) : null);

  if (!view) return <Loading />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">Paper Trading</h1>
        <Badge tone="warn">virtual ${view.account.initial_balance.toLocaleString()}</Badge>
        <span className="text-xs text-muted">{view.virtual_funds_notice}</span>
      </div>
      <AccountMetrics view={view} beginner={beginner} />
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="min-w-0 flex-1">
          <ChartWorkspace
            symbol={symbol}
            onSymbol={setSymbol}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            positions={view.positions}
            trades={trades?.trades}
            beginner={beginner}
            onData={onData}
            apiRef={chartApi}
            height={600}
            storageKey="paper"
          />
        </div>
        <div className="w-full shrink-0 xl:w-80">
          <Card title="Order panel">
            <OrderPanel
              key={symbol}
              symbol={symbol}
              price={price}
              precision={precision}
              equity={view.equity}
              timeframe={timeframe}
              beginner={beginner}
              onPlaced={refresh}
            />
          </Card>
        </div>
      </div>
      <Card bodyClass="p-0">
        <Tabs
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "positions", label: `Positions (${view.positions.length})` },
            { key: "orders", label: `Orders (${view.orders.length})` },
            { key: "history", label: `History (${trades?.trades.length ?? 0})` },
            { key: "activity", label: "Activity" },
          ]}
        />
        <div className="p-3">
          {tab === "positions" && <PositionsTable positions={view.positions} onChanged={refresh} beginner={beginner} />}
          {tab === "orders" && <OrdersTable orders={view.orders} onChanged={refresh} />}
          {tab === "history" && <TradesTable trades={trades?.trades ?? []} captureScreenshot={capture} />}
          {tab === "activity" && (
            <ul className="space-y-1 text-sm">
              {(events?.events ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 border-b border-line py-1.5">
                  <span className="w-28 shrink-0 text-xs text-muted">{fmtTime(e.ts)}</span>
                  <Badge tone={e.type.includes("stop") || e.type.includes("liquid") || e.type.includes("reject") ? "down" : e.type.includes("take") ? "up" : "neutral"}>
                    {e.type}
                  </Badge>
                  <span className="text-text/90">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {beginner && (
        <Card title="Как работи симулацията?" bodyClass="text-sm text-muted space-y-1">
          <p>• BUY се изпълнява на ASK, SELL на BID — разликата (spread) е разход. Плащаш и такса (fee).</p>
          <p>• Market поръчките имат slippage и latency; големите поръчки могат да се изпълнят частично.</p>
          <p>• Stop loss/take profit/limit поръчките се проверяват на всяка затворена 1-минутна свещ — както при брокер.</p>
          <p>• При margin level под 50% позициите се ликвидират. Всички средства са виртуални.</p>
        </Card>
      )}
    </div>
  );
}
