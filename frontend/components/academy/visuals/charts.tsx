"use client";

/*
 * Chart-based lesson visuals: live (demo / live provider) chart with optional regime, timeframe
 * comparison, animated teaching scenarios (/academy/scenarios/{key}) and indicator panes. Data comes
 * from the market API with its source badge; a provider without data → <DataNotAvailable/>.
 */
import { ArrowUpRight, CirclePause, CirclePlay, RotateCcw, StepForward } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import TradingChart, { type MarkerDef, type PriceLineDef, type ZoneDef } from "@/components/charts/TradingChart";
import { Badge, Button, ChartSkeleton, DataNotAvailable, RegimeBadge, SourceBadge, Term, type SourceLike } from "@/components/ui";
import { ApiError, fetcher } from "@/lib/api";
import { TF_LABEL } from "@/lib/format";
import { useCandles } from "@/lib/hooks";
import { INDICATORS, buildIndicatorSeries, lastValue } from "@/lib/indicators";
import { PALETTE } from "@/lib/theme";
import type { Candle } from "@/lib/types";

function ChartHead({ symbol, tf, source, children }: { symbol: string; tf: string; source?: SourceLike | null; children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="num font-semibold text-text">
        {symbol} · {TF_LABEL[tf] ?? tf}
      </span>
      <SourceBadge source={source ?? null} />
      {children}
      <Link href={`/charts?symbol=${encodeURIComponent(symbol)}`} className="ml-auto inline-flex items-center gap-0.5 font-medium text-accent2 hover:text-text">
        Отвори в Charts <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}

function MarketDataError({ error, symbol }: { error: unknown; symbol: string }) {
  const reason = error instanceof ApiError ? error.message : "Данните не можаха да се заредят.";
  return <DataNotAvailable reason={reason} provider={symbol} />;
}

export function LiveChart({ symbol, tf, showRegime }: { symbol: string; tf: string; showRegime?: boolean }) {
  const { data, error } = useCandles(symbol, tf, [], 200, false);
  const { data: regime } = useSWR<{ regime: string; reasons: string[] }>(
    showRegime ? `/market/regime?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  if (error && !data) return <MarketDataError error={error} symbol={symbol} />;
  return (
    <div className="min-w-0">
      <ChartHead symbol={symbol} tf={tf} source={data?.source as SourceLike | undefined}>
        {regime && (
          <>
            <Term k="regime">
              <span className="text-muted">Режим:</span>
            </Term>
            <RegimeBadge regime={regime.regime} />
          </>
        )}
      </ChartHead>
      {data ? (
        <TradingChart candles={data.candles ?? []} precision={data.precision ?? 2} height={300} fitKey={symbol + tf} visibleBars={100} />
      ) : (
        <ChartSkeleton height={300} />
      )}
      {regime && regime.reasons.length > 0 && <p className="mt-2 text-xs leading-relaxed text-muted">{regime.reasons.join(" ")}</p>}
    </div>
  );
}

export function TimeframesVisual({ symbol, tfs }: { symbol: string; tfs: string[] }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        {tfs.map((tf) => (
          <TfMini key={tf} symbol={symbol} tf={tf} />
        ))}
      </div>
      <p className="text-xs text-muted">
        Един и същ пазар. Lower <Term k="timeframe">timeframe</Term> = more noise. Higher timeframe = broader context.
      </p>
    </div>
  );
}

function TfMini({ symbol, tf }: { symbol: string; tf: string }) {
  const { data, error } = useCandles(symbol, tf, [], 120, false);
  return (
    <div className="glass-inset min-w-0 p-1.5">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="num text-xs font-semibold text-text">{TF_LABEL[tf] ?? tf}</span>
        <SourceBadge source={(data?.source as SourceLike | undefined) ?? null} />
      </div>
      {error && !data ? (
        <DataNotAvailable compact reason={error instanceof ApiError ? error.message : undefined} />
      ) : data ? (
        <TradingChart candles={data.candles ?? []} precision={data.precision ?? 2} height={200} volume={false} fitKey={tf} visibleBars={120} />
      ) : (
        <ChartSkeleton height={200} />
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────── scenario chart */

type Scenario = {
  key: string;
  title: string;
  candles: Candle[];
  annotations: { type: string; index?: number; time?: number; text?: string; position?: string; color?: string; price?: number; label?: string; low?: number; high?: number; style?: string }[];
  steps: { at: number; text: string }[];
};

const SCENARIO_SOURCE: SourceLike = { id: "scenario", status: "demo", disclaimer: "Синтетичен учебен сценарий — не са реални пазарни цени." };

export function ScenarioChart({ scenario, height = 320 }: { scenario: string; height?: number }) {
  const { data } = useSWR<Scenario>(`/academy/scenarios/${scenario}`, fetcher, { revalidateOnFocus: false });
  const [n, setN] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = data?.candles.length ?? 0;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start each scenario fully revealed
    if (data) setN(data.candles.length);
  }, [data]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setN((x) => {
        if (x >= total) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, 220);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, total]);

  const shown = useMemo(() => data?.candles.slice(0, Math.max(n, 2)) ?? [], [data, n]);
  const range = useMemo(() => (total ? { from: -1, to: total + 2 } : undefined), [total]);
  const lastIdx = shown.length;
  const markers: MarkerDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "marker" && (a.index ?? 0) <= lastIdx)
    .map((a) => ({
      time: a.time!,
      position: a.position === "below" ? "belowBar" : "aboveBar",
      shape: a.position === "below" ? "arrowUp" : "arrowDown",
      color: a.color ?? PALETTE.text,
      text: a.text,
    }));
  const lines: PriceLineDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "line")
    .map((a, i) => ({ id: `l${i}`, price: a.price!, color: a.color ?? PALETTE.info, title: a.label, dashed: true }));
  const zones: ZoneDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "zone")
    .map((a, i) => ({ id: `z${i}`, low: a.low!, high: a.high!, color: a.color ?? "rgba(86,194,255,0.12)", label: a.label }));
  const steps = (data?.steps ?? []).filter((s) => s.at <= lastIdx);
  const done = n >= total;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">{data?.title}</span>
        <Badge tone="violet">animated scenario</Badge>
        <SourceBadge source={SCENARIO_SOURCE} />
      </div>
      {data ? (
        <TradingChart candles={shown} precision={2} height={height} markers={markers} priceLines={lines} zones={zones} fitKey={scenario} logicalRange={range} hideTimeAxis />
      ) : (
        <ChartSkeleton height={height} />
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          type="button"
          disabled={!data}
          onClick={() => {
            if (done) setN(8);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <CirclePause size={13} strokeWidth={2} aria-hidden /> : done ? <RotateCcw size={13} strokeWidth={2} aria-hidden /> : <CirclePlay size={13} strokeWidth={2} aria-hidden />}
          {playing ? "Pause" : done ? "Replay animation" : "Play"}
        </Button>
        <Button size="sm" variant="outline" type="button" disabled={!data || done} onClick={() => setN((x) => Math.min(total, x + 1))}>
          <StepForward size={13} strokeWidth={2} aria-hidden /> Next candle
        </Button>
        <span className="num text-xs text-muted">
          {Math.min(n, total)}/{total}
        </span>
        <span className="ml-auto h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
          <span className="block h-full rounded-full bg-accent2" style={{ width: `${total ? (Math.min(n, total) / total) * 100 : 0}%` }} />
        </span>
      </div>
      {steps.length > 0 && (
        <ol className="mt-2.5 space-y-1.5">
          {steps.map((s, i) => (
            <li key={s.at} className="fade-in flex gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-sm leading-relaxed text-text/90">
              <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold text-accent2">{i + 1}</span>
              <span className="min-w-0">{s.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────── indicators */

export function IndicatorVisual({ indicator, symbol, tf }: { indicator: string; symbol: string; tf: string }) {
  const map: Record<string, string> = { sma: "sma20", ema: "ema50", rsi: "rsi", macd: "macd", bb: "bb", atr: "atr", vwap: "vwap", volume_sma: "" };
  const key = map[indicator] ?? "";
  const keys = useMemo(() => (key ? (indicator === "ema" ? ["ema20", "ema50", "ema200"] : [key]) : []), [key, indicator]);
  const { data, error } = useCandles(symbol, tf, keys, 300, false);
  const { overlays, panes } = useMemo(() => buildIndicatorSeries(data, keys), [data, keys]);
  const def = INDICATORS.find((d) => d.key === key);
  const v = def ? lastValue(data, def, def.name === "macd" ? "hist" : "value") : null;
  if (error && !data) return <MarketDataError error={error} symbol={symbol} />;
  return (
    <div className="min-w-0">
      <ChartHead symbol={symbol} tf={tf} source={data?.source as SourceLike | undefined}>
        {def && v !== null && (
          <span className="text-muted">
            {def.label} сега: <span className="num text-text">{v.toFixed(2)}</span>
          </span>
        )}
      </ChartHead>
      {data ? (
        <TradingChart candles={data.candles ?? []} precision={data.precision ?? 2} height={360} overlays={overlays} panes={panes} fitKey={symbol + tf + key} visibleBars={140} />
      ) : (
        <ChartSkeleton height={360} />
      )}
      {indicator === "rsi" && v !== null && v > 70 && (
        <p className="mt-2 text-xs text-warn">RSI is currently high. This does NOT automatically mean price must fall.</p>
      )}
      {indicator === "volume_sma" && <p className="mt-2 text-xs text-muted">Стълбчетата долу са обемът — сравни движенията с голям и малък обем.</p>}
    </div>
  );
}
