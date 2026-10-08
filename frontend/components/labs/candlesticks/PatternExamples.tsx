"use client";

/*
 * "Find it on a real chart": recent occurrences of a pattern on CLOSED candles of a real/demo instrument
 * (GET /learn/candlesticks/{key}/examples) — chart with markers, what happened over the next 5/10 candles
 * (median move in ATR, % up/down) and the honest "historical behaviour on this data, not a prediction" note.
 * A picked example can be opened from the inside with the S3a CandleDrilldown.
 */
import { History, Microscope, ScanSearch } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { IChartApi } from "lightweight-charts";

import { CandleDrilldown } from "@/components/academy/visuals/drilldown";
import { exampleMarkers, OUTCOME_TONE, rangeAround, signedPct } from "@/components/labs/model";
import type { PatternCard, PatternExamples as ExamplesPayload } from "@/components/labs/types";
import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { Badge, Button, ChartSkeleton, DataNotAvailable, Disclaimer, EmptyState, ErrorState, Notice, Segmented, SourceBadge, Term } from "@/components/ui";
import { ApiError, errorReason, fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

const TradingChart = dynamic(() => import("@/components/charts/TradingChart"), { ssr: false, loading: () => <ChartSkeleton height={280} /> });

export const EXAMPLE_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;

const TREND_BG: Record<string, string> = { up: "покачване", down: "спад", flat: "странично" };

export function examplesKey(key: string, symbol: string, timeframe: string): string {
  return `/learn/candlesticks/${encodeURIComponent(key)}/examples?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&bars=500`;
}

function when(ts: number, timeframe: string): string {
  const d = new Date(ts * 1000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (timeframe === "1d" || timeframe === "1w") return `${date}.${String(d.getUTCFullYear()).slice(2)}`;
  return `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function PatternExamples({ pattern, defaultSymbol = "BTC/USDT" }: { pattern: PatternCard; defaultSymbol?: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<string>("1h");
  const [picked, setPicked] = useState<{ key: string; time: number } | null>(null);
  const [inside, setInside] = useState(false);
  const apiRef = useRef<IChartApi | null>(null);
  const key = examplesKey(pattern.key, symbol, timeframe);
  const { data, error, mutate } = useSWR<ExamplesPayload>(key, fetcher, { revalidateOnFocus: false });

  // keepPreviousData keeps the last payload while another pattern / symbol loads — show it dimmed
  const current = !!data && data.key === pattern.key && data.symbol === symbol && data.timeframe === timeframe;
  const selected = picked && picked.key === key ? picked.time : null;
  const markers = useMemo(
    () => (data && data.available ? exampleMarkers(data.examples, data.bias, selected, data.name) : []),
    [data, selected],
  );

  const pick = (time: number, index: number) => {
    setPicked({ key, time });
    setInside(false);
    const n = data?.candles.length ?? 0;
    if (n) apiRef.current?.timeScale().setVisibleLogicalRange(rangeAround(index, n));
  };

  let body: React.ReactNode;
  if (error && !current) {
    body =
      error instanceof ApiError && (error.status === 503 || error.code === "DATA_NOT_AVAILABLE") ? (
        <DataNotAvailable reason={errorReason(error)} provider={symbol} />
      ) : (
        <ErrorState title="Примерите не се заредиха" description={errorReason(error)} onRetry={() => mutate()} />
      );
  } else if (!data || !current) {
    // keepPreviousData would show the previous pattern's markers — a skeleton is clearer
    body = <ChartSkeleton height={280} />;
  } else if (!data.available) {
    body = <DataNotAvailable reason={data.reason ?? undefined} provider={data.symbol} />;
  } else {
    const prec = data.precision ?? 2;
    body = (
      <div className="space-y-3">
        <div className="glass-inset overflow-hidden rounded-xl">
          <TradingChart
            candles={data.candles}
            precision={prec}
            height={280}
            volume={false}
            markers={markers}
            fitKey={`${data.key}:${data.symbol}:${data.timeframe}`}
            visibleBars={140}
            apiRef={apiRef}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <SourceBadge source={data.source} />
          <span>
            Намерени: <span className="num font-semibold text-text">{data.total_found}</span> в последните{" "}
            <span className="num text-text">{data.candles.length}</span> затворени свещи ({data.symbol} · {data.timeframe})
          </span>
        </div>
        {data.total_found === 0 ? (
          <EmptyState
            compact
            icon={ScanSearch}
            title={`Няма ${data.name} в този прозорец`}
            description="Моделите с ясни правила не се срещат на всяка графика. Опитай друг timeframe или инструмент."
          />
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.stats.map((s) => (
                <div key={s.bars} className="glass-inset min-w-0 rounded-lg px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    След {s.bars} свещи <span className="num font-normal normal-case tracking-normal text-faint">(n = {s.n})</span>
                  </div>
                  {s.n > 0 ? (
                    <div className="mt-1.5 space-y-1 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-muted">
                          Медиана (<Term k="atr">ATR</Term>)
                        </span>
                        <span className={cx("num font-semibold", (s.median_move_atr ?? 0) > 0 ? "text-up" : (s.median_move_atr ?? 0) < 0 ? "text-down" : "text-text")}>
                          {s.median_move_atr === null ? "—" : `${s.median_move_atr > 0 ? "+" : ""}${s.median_move_atr.toFixed(2)} ATR`}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-muted">Медиана (%)</span>
                        <span className="num text-text">{signedPct(s.median_move_pct)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-muted">Нагоре / надолу</span>
                        <span className="num text-text">
                          <span className="text-up">{s.pct_up ?? 0}%</span> / <span className="text-down">{s.pct_down ?? 0}%</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-xs text-faint">Още няма достатъчно следващи свещи.</p>
                  )}
                </div>
              ))}
            </div>
            {data.sample_note && (
              <Notice tone="warn" title="Малка извадка">
                {data.sample_note}
              </Notice>
            )}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                <History size={13} aria-hidden /> Последни случаи (най-новите първо)
              </div>
              <ul className="max-h-56 divide-y divide-white/[0.05] overflow-y-auto rounded-lg border border-white/[0.07]" aria-label="Намерени случаи">
                {data.examples.map((e) => {
                  const on = e.time === selected;
                  return (
                    <li key={e.time}>
                      <button
                        type="button"
                        onClick={() => pick(e.time, e.index)}
                        aria-pressed={on}
                        className={cx(
                          "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.04]",
                          on && "bg-accent/[0.08]",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="num text-text">{when(e.time, data.timeframe)}</span>
                          <span className="ml-2 text-faint">след {TREND_BG[e.prior_trend] ?? e.prior_trend}</span>
                        </span>
                        {e.next.map((o, i) => (
                          <span key={i} className={cx("num w-[86px] text-right", o ? OUTCOME_TONE[o.direction] : "text-faint")}>
                            {o ? `+${o.bars}: ${signedPct(o.move_pct)}` : `+${data.horizons[i]}: —`}
                          </span>
                        ))}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {selected !== null && (
              <div className="space-y-2">
                {inside ? (
                  <CandleDrilldown symbol={data.symbol} timeframe={data.timeframe} time={selected} onClose={() => setInside(false)} />
                ) : (
                  <Button size="sm" variant="outline" type="button" onClick={() => setInside(true)}>
                    <Microscope size={14} aria-hidden /> Виж последната свещ отвътре
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        <Disclaimer>{data.disclaimer}</Disclaimer>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AssetSearchCombobox value={symbol} onChange={(s) => s && setSymbol(s)} size="sm" className="w-48" ariaLabel="Инструмент за примерите" />
        <Segmented
          size="sm"
          options={EXAMPLE_TIMEFRAMES.map((t) => ({ value: t, label: t }))}
          value={timeframe as (typeof EXAMPLE_TIMEFRAMES)[number]}
          onChange={setTimeframe}
          ariaLabel="Timeframe"
        />
        {current && data?.available && data.total_found > 0 && <Badge tone="info">{data.total_found} случая</Badge>}
      </div>
      {body}
    </div>
  );
}
