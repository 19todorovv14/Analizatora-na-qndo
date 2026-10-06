import type { LineDef, PaneDef } from "@/components/charts/TradingChart";
import { CHART, PALETTE } from "@/lib/theme";
import type { CandlesResponse } from "@/lib/types";

export type IndicatorDef = {
  key: string;
  name: string;
  params: number[];
  label: string;
  pane: "price" | "separate";
  color: string;
  help: string;
};

export const INDICATORS: IndicatorDef[] = [
  { key: "ema20", name: "ema", params: [20], label: "EMA 20", pane: "price", color: PALETTE.gold, help: "Бърза EMA — краткосрочна посока." },
  { key: "ema50", name: "ema", params: [50], label: "EMA 50", pane: "price", color: PALETTE.info, help: "Средносрочна посока." },
  { key: "ema200", name: "ema", params: [200], label: "EMA 200", pane: "price", color: PALETTE.violet, help: "Дългосрочен контекст (цена над/под)." },
  { key: "sma20", name: "sma", params: [20], label: "SMA 20", pane: "price", color: "#fb923c", help: "Проста средна на 20 свещи." },
  { key: "bb", name: "bb", params: [20, 2], label: "Bollinger Bands", pane: "price", color: "#9fb3d9", help: "Ленти на волатилността." },
  { key: "vwap", name: "vwap", params: [], label: "VWAP", pane: "price", color: "#f472b6", help: "Средна цена за деня, претеглена с обема." },
  { key: "rsi", name: "rsi", params: [14], label: "RSI 14", pane: "separate", color: "#c4b5fd", help: "Momentum 0–100. Висок RSI ≠ задължителен спад." },
  { key: "macd", name: "macd", params: [12, 26, 9], label: "MACD", pane: "separate", color: PALETTE.info, help: "Ускоряване/забавяне на momentum." },
  { key: "atr", name: "atr", params: [14], label: "ATR 14", pane: "separate", color: PALETTE.warn, help: "Среден размер на движение — за стопове." },
];

export const INDICATOR_BY_KEY = Object.fromEntries(INDICATORS.map((i) => [i.key, i]));

export function responseKey(def: IndicatorDef): string {
  return def.params.length ? `${def.name}_${def.params.join("_")}` : def.name;
}

export function indicatorQuery(keys: string[]): string {
  return keys
    .map((k) => INDICATOR_BY_KEY[k])
    .filter(Boolean)
    .map((d) => [d.name, ...d.params].join(":"))
    .join(",");
}

/** Turns the API indicator payload into chart overlays (price pane) and separate panes. */
export function buildIndicatorSeries(data: CandlesResponse | undefined, keys: string[]): { overlays: LineDef[]; panes: PaneDef[] } {
  const overlays: LineDef[] = [];
  const panes: PaneDef[] = [];
  if (!data) return { overlays, panes };
  for (const key of keys) {
    const def = INDICATOR_BY_KEY[key];
    if (!def) continue;
    const payload = data.indicators[responseKey(def)];
    if (!payload) continue;
    const s = payload.series;
    if (def.name === "bb") {
      overlays.push({ id: "bb_u", data: s.upper ?? [], color: def.color, width: 1 });
      overlays.push({ id: "bb_m", data: s.middle ?? [], color: def.color, width: 1, dashed: true });
      overlays.push({ id: "bb_l", data: s.lower ?? [], color: def.color, width: 1 });
    } else if (def.pane === "price") {
      overlays.push({ id: key, data: s.value ?? [], color: def.color, width: key === "ema200" ? 2 : 1 });
    } else if (def.name === "rsi") {
      panes.push({
        id: "rsi",
        lines: [{ id: "rsi", data: s.value ?? [], color: def.color }],
        levels: [
          { price: 70, color: CHART.levelDown },
          { price: 30, color: CHART.levelUp },
        ],
      });
    } else if (def.name === "macd") {
      panes.push({
        id: "macd",
        hist: [
          {
            id: "hist",
            color: PALETTE.faint,
            data: (s.hist ?? []).map((p) => ({ ...p, color: p.value >= 0 ? CHART.histUp : CHART.histDown })),
          },
        ],
        lines: [
          { id: "macd", data: s.macd ?? [], color: PALETTE.info, width: 1 },
          { id: "signal", data: s.signal ?? [], color: "#fb923c", width: 1 },
        ],
      });
    } else {
      panes.push({ id: key, lines: [{ id: key, data: s.value ?? [], color: def.color }] });
    }
  }
  return { overlays, panes };
}

export function lastValue(data: CandlesResponse | undefined, def: IndicatorDef, output = "value"): number | null {
  const s = data?.indicators[responseKey(def)]?.series[output];
  return s && s.length ? s[s.length - 1].value : null;
}
