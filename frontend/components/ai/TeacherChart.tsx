"use client";

import { useMemo, useState } from "react";

import { OVERLAY_COLORS, isDataNotAvailableError, overlayLines, swingMarkers, unavailableReason, type NormalizedOverlay, type OverlayLayers } from "@/components/ai/model";
import { ChartLegend } from "@/components/charts/ChartControls";
import TradingChart, { type MarkerDef, type PriceLineDef } from "@/components/charts/TradingChart";
import { ChartSkeleton, DataNotAvailable, SourceBadge } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import { useCandles } from "@/lib/hooks";
import { buildIndicatorSeries } from "@/lib/indicators";
import type { Candle } from "@/lib/types";

const SOURCE_LABEL: Record<NormalizedOverlay["source"], string> = {
  answer: "AI Teacher",
  view: "Strategy View",
  analysis: "Signal engine",
};

function LayerChip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-medium transition-colors",
        on ? "border-white/[0.12] bg-white/[0.06] text-text" : "border-white/[0.06] bg-transparent text-faint line-through decoration-white/20",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, opacity: on ? 1 : 0.35 }} aria-hidden />
      {children}
    </button>
  );
}

/**
 * Chart of the AI Teacher page: candles + selected indicators, the teacher's S/R levels, invalidation
 * and target lines and the HH / HL / LH / LL structure labels. Layers can be toggled.
 */
export function TeacherChart({
  symbol,
  timeframe,
  indicators,
  overlay,
  layers,
  onLayersChange,
  height = 400,
  beginner,
}: {
  symbol: string;
  timeframe: string;
  indicators: string[];
  overlay: NormalizedOverlay | null;
  layers: OverlayLayers;
  onLayersChange: (l: OverlayLayers) => void;
  height?: number;
  beginner?: boolean;
}) {
  const { data, error, isLoading } = useCandles(symbol, timeframe, indicators, 300);
  const [hover, setHover] = useState<Candle | null>(null);
  const candles = data && data.symbol === symbol && data.timeframe === timeframe ? data.candles : null;

  const { overlays, panes } = useMemo(() => buildIndicatorSeries(data, indicators), [data, indicators]);
  const times = useMemo(() => new Set((candles ?? []).map((c) => c.time)), [candles]);
  const lines = useMemo<PriceLineDef[]>(() => overlayLines(overlay, layers), [overlay, layers]);
  const markers = useMemo<MarkerDef[]>(() => (layers.structure && overlay ? swingMarkers(overlay.swings, 8, times) : []), [overlay, layers.structure, times]);

  const unavailable = !!error && isDataNotAvailableError(error);
  const hasSetup = !!overlay?.setup;

  return (
    <div className="min-w-0">
      <div className="flex min-h-7 flex-col gap-1.5 px-1 pb-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">{data && candles && <ChartLegend data={data} hover={hover} active={indicators} beginner={beginner} />}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {data?.source && <SourceBadge source={data.source} />}
          <LayerChip on={layers.levels} color={OVERLAY_COLORS.support} onClick={() => onLayersChange({ ...layers, levels: !layers.levels })}>
            S/R
          </LayerChip>
          <LayerChip on={layers.setup} color={OVERLAY_COLORS.invalidation} onClick={() => onLayersChange({ ...layers, setup: !layers.setup })}>
            Invalidation{hasSetup ? " / Target" : ""}
          </LayerChip>
          <LayerChip on={layers.structure} color={OVERLAY_COLORS.bullish} onClick={() => onLayersChange({ ...layers, structure: !layers.structure })}>
            HH/HL/LH/LL
          </LayerChip>
        </div>
      </div>
      {unavailable ? (
        <DataNotAvailable reason={`${symbol}: ${unavailableReason(error)}`} className="min-h-[320px]" />
      ) : error && !candles ? (
        <DataNotAvailable reason={`Графиката не се зареди: ${errorMessage(error)}`} className="min-h-[320px]" />
      ) : !candles && isLoading ? (
        <ChartSkeleton height={height} />
      ) : !candles || candles.length === 0 ? (
        <DataNotAvailable reason={`Няма свещи за ${symbol} ${timeframe.toUpperCase()}.`} className="min-h-[320px]" />
      ) : (
        <TradingChart
          candles={candles}
          precision={data?.precision ?? 2}
          height={height}
          overlays={overlays}
          panes={panes}
          priceLines={lines}
          markers={markers}
          fitKey={symbol + timeframe}
          onHover={setHover}
        />
      )}
      {overlay && (lines.length > 0 || markers.length > 0) && (
        <div className="px-1 pt-1.5 text-[10.5px] text-faint">
          Нива и структура от: <span className="text-muted">{SOURCE_LABEL[overlay.source]}</span> · само затворени свещи · не е прогноза
        </div>
      )}
    </div>
  );
}
