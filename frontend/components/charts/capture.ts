import type { IChartApi } from "lightweight-charts";

import { CHART } from "@/lib/theme";

/** Opaque page surface colour (from the --color-surface token, with a static fallback). */
function surfaceColor(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim();
    return v || CHART.surface;
  } catch {
    return CHART.surface;
  }
}

/**
 * Snapshot of a chart as a data URL. Charts render on a transparent canvas (so the glass panel
 * shows through), which would turn black in a JPEG — so the screenshot is composited over the
 * opaque surface colour first. Returns null when the chart cannot be captured.
 */
export function captureChart(api: IChartApi, mime = "image/jpeg", quality = 0.85): string | null {
  try {
    const shot = api.takeScreenshot();
    const w = shot.width;
    const h = shot.height;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = surfaceColor();
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(shot, 0, 0);
    return canvas.toDataURL(mime, quality);
  } catch {
    return null;
  }
}
