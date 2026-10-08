"use client";

import useSWR from "swr";

import { normSymbol } from "@/components/charts/chartMath";
import TradingChart from "@/components/charts/TradingChart";
import { Button, InfoTip, RegimeBadge } from "@/components/ui";
import { errorReason, fetcher } from "@/lib/api";
import { TF_LABEL } from "@/lib/format";
import { useCandles } from "@/lib/hooks";
import type { Candle } from "@/lib/types";

const NO_CANDLES: Candle[] = [];

export const COMPARE_TFS = ["5m", "1h", "4h", "1d"] as const;

const COMPARE_HELP: Record<string, string> = {
  "5m": "Lower timeframe = more noise. Подходящ за прецизен вход, не за посока.",
  "1h": "Средна картина — swing структура за дни.",
  "4h": "Higher timeframe = broader context.",
  "1d": "Higher timeframe = broader context. Основният тренд и ключови нива.",
};

function MiniChart({ symbol, tf }: { symbol: string; tf: string }) {
  const { data, error, isLoading } = useCandles(symbol, tf, [], 200, true, { refreshMs: 15_000 });
  const { data: regime } = useSWR<{ regime: string; trend: string }>(
    `/market/regime?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const candles = data && normSymbol(data.symbol) === normSymbol(symbol) && data.timeframe === tf ? data.candles : NO_CANDLES;
  // DATA_NOT_AVAILABLE → its reason; any other failure → the error text (never an empty grid)
  const unavailable = !candles.length && error ? errorReason(error) : null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-white/[0.06] bg-white/[0.015]">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
        <span className="flex items-center gap-1 font-semibold">
          {TF_LABEL[tf]} <InfoTip text={COMPARE_HELP[tf]} />
        </span>
        <RegimeBadge regime={regime?.regime} />
      </div>
      <div className="min-h-0 flex-1">
        <TradingChart
          candles={candles}
          precision={data?.precision ?? 2}
          height="fill"
          volume={false}
          fitKey={`${symbol}${tf}`}
          visibleBars={120}
          loading={!candles.length && (isLoading || !error) ? true : undefined}
          unavailable={unavailable}
          demo={data?.source?.status === "demo"}
        />
      </div>
    </div>
  );
}

/** Multi-timeframe view (5m · 1H · 4H · 1D) of one instrument — "← Single chart" returns to the terminal chart. */
export function CompareGrid({ symbol, onExit }: { symbol: string; onExit: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onExit}>
          ← Single chart
        </Button>
        <span className="text-sm font-semibold">{symbol} — multi-timeframe</span>
        <span className="text-xs text-muted">Lower timeframe = more noise · Higher timeframe = broader context</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2 md:grid-rows-2">
        {COMPARE_TFS.map((tf) => (
          <div key={tf} className="h-[260px] min-h-0 md:h-auto">
            <MiniChart symbol={symbol} tf={tf} />
          </div>
        ))}
      </div>
    </div>
  );
}
