"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";

import { ChartWorkspace } from "@/components/charts/ChartWorkspace";
import TradingChart from "@/components/charts/TradingChart";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { Button, Card, InfoTip, RegimeBadge } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TF_LABEL } from "@/lib/format";
import { useAccount, useCandles, useLocalState } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { CandlesResponse, Trade } from "@/lib/types";

const COMPARE_HELP: Record<string, string> = {
  "5m": "Lower timeframe = more noise. Подходящ за прецизен вход, не за посока.",
  "1h": "Средна картина — swing структура за дни.",
  "4h": "Higher timeframe = broader context.",
  "1d": "Higher timeframe = broader context. Основният тренд и ключови нива.",
};

function MiniChart({ symbol, tf }: { symbol: string; tf: string }) {
  const { data } = useCandles(symbol, tf, [], 200);
  const { data: regime } = useSWR<{ regime: string; trend: string }>(
    `/market/regime?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  return (
    <div className="rounded-md border border-line bg-panel p-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-semibold">
          {TF_LABEL[tf]} <InfoTip text={COMPARE_HELP[tf]} />
        </span>
        <RegimeBadge regime={regime?.regime} />
      </div>
      <TradingChart candles={data?.candles ?? []} precision={data?.precision ?? 2} height={230} volume={false} fitKey={`${symbol}${tf}`} visibleBars={120} />
    </div>
  );
}

export default function ChartsPage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-chart-symbol", "BTC/USDT");
  const [timeframe, setTimeframe] = useLocalState("ta-chart-tf", "1h");
  const [compare, setCompare] = useState(false);
  const [trade, setTrade] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [precision, setPrecision] = useState(2);
  const { data: account, mutate } = useAccount(10000);
  const { data: trades } = useSWR<{ trades: Trade[] }>("/paper/trades?limit=100", fetcher, { refreshInterval: 15000 });

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("symbol");
    if (s) setSymbol(s);
  }, [setSymbol]);

  const onData = useCallback((d: CandlesResponse) => {
    if (d.candles.length) setPrice(d.candles[d.candles.length - 1].close);
    setPrecision(d.precision);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          {compare ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setCompare(false)}>
                  ← Single chart
                </Button>
                <span className="text-sm font-semibold">{symbol} — multi-timeframe</span>
                <span className="text-xs text-muted">Lower timeframe = more noise · Higher timeframe = broader context</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {["5m", "1h", "4h", "1d"].map((tf) => (
                  <MiniChart key={tf} symbol={symbol} tf={tf} />
                ))}
              </div>
            </div>
          ) : (
            <ChartWorkspace
              symbol={symbol}
              onSymbol={setSymbol}
              timeframe={timeframe}
              onTimeframe={setTimeframe}
              positions={account?.positions}
              trades={trades?.trades}
              beginner={beginner}
              onData={onData}
              height={600}
              headerRight={
                <>
                  <Button size="sm" variant="outline" onClick={() => setCompare(true)}>
                    Compare TFs
                  </Button>
                  <Link href={`/replay?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}`}>
                    <Button size="sm" variant="outline">
                      ⏯ Replay
                    </Button>
                  </Link>
                  <Link href={`/ai?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}`}>
                    <Button size="sm" variant="outline">
                      🤖 Analyze
                    </Button>
                  </Link>
                  <Button size="sm" variant={trade ? "primary" : "up"} onClick={() => setTrade((t) => !t)}>
                    Paper Trade
                  </Button>
                </>
              }
            />
          )}
        </div>
        {trade && !compare && (
          <div className="w-80 shrink-0">
            <Card title="Order panel" right={<button className="text-muted" onClick={() => setTrade(false)}>✕</button>}>
              <OrderPanel
                key={symbol}
                symbol={symbol}
                price={price}
                precision={precision}
                equity={account?.equity ?? 10000}
                timeframe={timeframe}
                beginner={beginner}
                onPlaced={() => mutate()}
              />
            </Card>
          </div>
        )}
      </div>
      {beginner && !compare && (
        <Card title="Как да четеш графиката" bodyClass="text-sm text-muted space-y-1">
          <p>• Всяка свещ е един период ({TF_LABEL[timeframe]}). Зелена = затворила по-високо, червена = по-ниско. Задръж мишката за Open/High/Low/Close.</p>
          <p>• Стълбчетата долу са обемът. Линиите са индикатори (меню ƒx) — те описват миналото, не предсказват.</p>
          <p>• Инструментите вляво чертаят нива и зони. Пробвай Horizontal line върху очевиден support.</p>
        </Card>
      )}
    </div>
  );
}
