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

function opaqueCopy(shot: HTMLCanvasElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
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
  return { canvas, ctx };
}

/**
 * Snapshot of a chart as a data URL. Charts render on a transparent canvas (so the glass panel
 * shows through), which would turn black in a JPEG — so the screenshot is composited over the
 * opaque surface colour first. Returns null when the chart cannot be captured.
 * (Synchronous: canvas content only. Use captureChartWithOverlay to include the drawings.)
 */
export function captureChart(api: IChartApi, mime = "image/jpeg", quality = 0.85): string | null {
  try {
    const out = opaqueCopy(api.takeScreenshot());
    return out ? out.canvas.toDataURL(mime, quality) : null;
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("overlay image failed to load"));
    img.src = src;
  });
}

/** Serialise the drawing overlay (without edit handles) to an SVG data URL. */
export function overlayToDataUrl(svg: SVGSVGElement): string | null {
  const w = svg.width.baseVal.value;
  const h = svg.height.baseVal.value;
  if (!w || !h || !svg.childNodes.length) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.querySelectorAll("[data-handle]").forEach((n) => n.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

/**
 * Chart screenshot INCLUDING the SVG drawing layer (trend lines, levels, fib, position boxes, zones):
 * the overlay is rasterised and composited onto the canvas snapshot at the price pane's origin.
 * Falls back to the canvas-only snapshot when the overlay cannot be rasterised.
 */
export async function captureChartWithOverlay(
  api: IChartApi,
  overlay: SVGSVGElement | null | undefined,
  mime = "image/jpeg",
  quality = 0.85,
): Promise<string | null> {
  let base: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
  try {
    base = opaqueCopy(api.takeScreenshot());
  } catch {
    return null;
  }
  if (!base) return null;
  const { canvas, ctx } = base;
  if (overlay) {
    try {
      const src = overlayToDataUrl(overlay);
      if (src) {
        const img = await loadImage(src);
        const cssWidth = api.chartElement()?.clientWidth || canvas.width;
        const ratio = cssWidth > 0 ? canvas.width / cssWidth : 1;
        ctx.drawImage(img, 0, 0, overlay.width.baseVal.value * ratio, overlay.height.baseVal.value * ratio);
      }
    } catch {
      /* drawings could not be rasterised — keep the canvas snapshot */
    }
  }
  try {
    return canvas.toDataURL(mime, quality);
  } catch {
    return null;
  }
}

/** Save a data URL as a file (Screenshot button). */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
