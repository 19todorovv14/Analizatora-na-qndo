"use client";

/*
 * Lesson visuals — `visual.type` from the academy content (backend/app/academy/content/*) selects an
 * interactive component. Implementations live in components/academy/visuals/*; this file is the
 * stable entry point (LessonVisual, Visual, ScenarioChart, VISUAL_META) used by the lesson page and
 * other packages. Unknown types and unknown config keys are ignored.
 */
import {
  Activity,
  BookOpenText,
  Calculator,
  ChartCandlestick,
  ChartLine,
  Clapperboard,
  Coins,
  Layers,
  ListChecks,
  ListOrdered,
  NotebookPen,
  Scale,
  Sigma,
  Sparkles,
  Table2,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

import { CandleVisual } from "@/components/academy/visuals/candle";
import { IndicatorVisual, LiveChart, ScenarioChart, TimeframesVisual } from "@/components/academy/visuals/charts";
import { Reflection, StrategyFlow } from "@/components/academy/visuals/flow";
import { LeverageVisual } from "@/components/academy/visuals/leverage";
import { AssetTable, FeesCalc, OrderBook, OrderTypes } from "@/components/academy/visuals/market";
import { DrawdownVisual, ExpectancySim, RiskCalcVisual } from "@/components/academy/visuals/risk";

export { ScenarioChart };
export { CandleAnatomy, CandleVisual, CLICK_CAPTION } from "@/components/academy/visuals/candle";
export type { CandleAnatomyProps, CandleItem, CandlePart } from "@/components/academy/visuals/candle";
export { CandleDrilldown } from "@/components/academy/visuals/drilldown";

export type Visual = { type: string; [k: string]: unknown };

/** Icon + Bulgarian label per visual type (lesson lists, visual card header). */
export const VISUAL_META: Record<string, { icon: LucideIcon; label: string }> = {
  candle: { icon: ChartCandlestick, label: "Интерактивна свещ" },
  live_chart: { icon: ChartLine, label: "Графика с пазарни данни" },
  timeframes: { icon: Layers, label: "Сравнение на timeframes" },
  scenario: { icon: Clapperboard, label: "Анимиран сценарий" },
  indicator: { icon: Activity, label: "Индикатор на графика" },
  leverage: { icon: Scale, label: "Leverage симулатор" },
  risk_calc: { icon: Calculator, label: "Калкулатор на риска" },
  drawdown: { icon: TrendingDown, label: "Drawdown визуализация" },
  expectancy: { icon: Sigma, label: "Expectancy симулация" },
  strategy_flow: { icon: ListChecks, label: "Схема на процеса" },
  reflection: { icon: NotebookPen, label: "Въпроси за размисъл" },
  orderbook: { icon: BookOpenText, label: "Order book" },
  asset_table: { icon: Table2, label: "Класове активи" },
  order_types: { icon: ListOrdered, label: "Видове поръчки" },
  fees: { icon: Coins, label: "Калкулатор на разходите" },
};

export function visualMeta(type: string | null | undefined): { icon: LucideIcon; label: string } {
  return (type && VISUAL_META[type]) || { icon: Sparkles, label: "Интерактивен пример" };
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function LessonVisual({ visual }: { visual: Visual }) {
  switch (visual.type) {
    case "orderbook":
      return <OrderBook mode={str(visual.mode, "bid_ask")} />;
    case "asset_table":
      return <AssetTable />;
    case "order_types":
      return <OrderTypes highlight={str(visual.highlight, "market")} />;
    case "leverage":
      return <LeverageVisual account={num(visual.account)} focus={str(visual.focus)} variant={str(visual.variant) || undefined} />;
    case "fees":
      return <FeesCalc focus={str(visual.focus)} />;
    case "candle":
      return <CandleVisual visual={visual} />;
    case "live_chart":
      return <LiveChart symbol={str(visual.symbol, "BTC/USDT")} tf={str(visual.timeframe, "1h")} showRegime={!!visual.show_regime} />;
    case "timeframes":
      return (
        <TimeframesVisual
          symbol={str(visual.symbol, "BTC/USDT")}
          tfs={Array.isArray(visual.timeframes) ? (visual.timeframes as unknown[]).map((t) => String(t)) : ["5m", "1h", "1d"]}
        />
      );
    case "scenario":
      return <ScenarioChart scenario={str(visual.scenario)} />;
    case "indicator":
      return <IndicatorVisual indicator={str(visual.indicator)} symbol={str(visual.symbol, "BTC/USDT")} tf={str(visual.timeframe, "1h")} />;
    case "risk_calc":
      return <RiskCalcVisual focus={str(visual.focus)} />;
    case "drawdown":
      return <DrawdownVisual focus={str(visual.focus)} />;
    case "expectancy":
      return <ExpectancySim focus={str(visual.focus)} />;
    case "reflection":
      return <Reflection prompts={Array.isArray(visual.prompts) ? (visual.prompts as unknown[]).map((p) => String(p)) : []} />;
    case "strategy_flow":
      return <StrategyFlow focus={str(visual.focus)} variant={str(visual.variant) || undefined} />;
    default:
      return null;
  }
}
