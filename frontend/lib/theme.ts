/**
 * Chart palette for the "Crystal Terminal" theme. Canvas libraries (lightweight-charts) cannot read
 * CSS variables, so the values mirror the tokens in app/globals.css — keep both in sync.
 */
import { ColorType, CrosshairMode, LineStyle, type DeepPartial, type IChartApi, type ChartOptions } from "lightweight-charts";

export const PALETTE = {
  bg: "#060912",
  surface: "#0b111e",
  surface2: "#101828",
  text: "#e7ebf3",
  muted: "#94a0b8",
  faint: "#6f7b95",
  line: "rgba(148,163,184,0.13)",
  accent: "#3b82f6",
  accent2: "#8ab4ff",
  up: "#22c79e",
  down: "#f2555c",
  warn: "#f5b84a",
  info: "#56c2ff",
  violet: "#a78bfa",
  gold: "#f2c94c",
} as const;

export const CHART = {
  /** transparent so the glass panel behind the canvas shows through */
  bg: "transparent",
  /** opaque fallback (screenshots, exports) */
  surface: PALETTE.surface,
  text: "#8a94a8",
  textStrong: "#d6dce8",
  grid: "rgba(148,163,184,0.06)",
  border: "rgba(148,163,184,0.13)",
  crosshair: "rgba(148,163,184,0.42)",
  crosshairLabel: "#1a2335",
  separator: "rgba(148,163,184,0.12)",
  separatorHover: "rgba(59,130,246,0.32)",
  up: PALETTE.up,
  down: PALETTE.down,
  volUp: "rgba(34,199,158,0.30)",
  volDown: "rgba(242,85,92,0.30)",
  histUp: "rgba(34,199,158,0.55)",
  histDown: "rgba(242,85,92,0.55)",
  levelUp: "rgba(34,199,158,0.55)",
  levelDown: "rgba(242,85,92,0.55)",
  accent: PALETTE.accent,
  accent2: PALETTE.accent2,
  info: PALETTE.info,
  warn: PALETTE.warn,
  /** equity / area series */
  areaLine: PALETTE.accent,
  areaTop: "rgba(59,130,246,0.28)",
  areaBottom: "rgba(59,130,246,0.01)",
  baseline: "rgba(148,163,184,0.45)",
  /** SVG overlay (drawings, zones, measure box) */
  overlayLabelBg: "rgba(12,18,32,0.94)",
  overlayLabelInk: "#060912",
  fontFamily: '"Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 11,
} as const;

/** "#rrggbb" + alpha → "rgba(r,g,b,a)". Non-hex input is returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Shared createChart() options: transparent canvas, quiet grid, soft crosshair. */
export function baseChartOptions(extra?: { timeVisible?: boolean; hideTimeAxis?: boolean }): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: CHART.bg },
      textColor: CHART.text,
      fontSize: CHART.fontSize,
      fontFamily: CHART.fontFamily,
      attributionLogo: false,
      panes: { separatorColor: CHART.separator, separatorHoverColor: CHART.separatorHover, enableResize: true },
    },
    grid: { vertLines: { color: CHART.grid }, horzLines: { color: CHART.grid } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: CHART.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: CHART.crosshairLabel },
      horzLine: { color: CHART.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: CHART.crosshairLabel },
    },
    // explicit locale: some browsers report tags like "en-US@posix" that Intl rejects
    localization: { locale: "en-US" },
    rightPriceScale: { borderColor: CHART.border },
    timeScale: {
      borderColor: CHART.border,
      timeVisible: extra?.timeVisible ?? true,
      secondsVisible: false,
      visible: !extra?.hideTimeAxis,
    },
  };
}

/**
 * Canvas text is drawn with whatever font is ready at paint time. Once the web fonts finish
 * loading, re-apply the family so the axes repaint with Inter instead of the fallback.
 */
export function repaintWhenFontsReady(chart: IChartApi): void {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  document.fonts.ready
    .then(() => {
      try {
        chart.applyOptions({ layout: { fontFamily: CHART.fontFamily } });
      } catch {
        /* chart already removed */
      }
    })
    .catch(() => {});
}
