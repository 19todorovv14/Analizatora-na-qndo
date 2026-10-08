"use client";

import { Camera, Columns2, PanelBottom, PanelRight, Rewind } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartTypeMenu, IndicatorMenu, TimeframeBar } from "@/components/charts/ChartControls";
import type { ChartWorkspaceState } from "@/components/charts/useChartWorkspace";
import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { useQuotes } from "@/components/market/hooks";
import { MarketStatusDot } from "@/components/market/MarketStatusDot";
import type { TerminalLayoutState } from "@/components/terminal/TerminalLayout";
import { Button, ChangePill, IconButton, PaperBadge, PriceText, SourceBadge, type SourceLike } from "@/components/ui";
import { cx } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";
import type { MarketSession, PaperInstrument } from "@/lib/types";

/** Horizontal tool strip of the terminal: `children` scroll sideways when narrow, `end` stays pinned right. */
export function TopBar({ children, end, className }: { children: React.ReactNode; end?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-12 min-w-0 items-center", className)}>
      <div role="toolbar" aria-label="Терминал" className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-2">
        {children}
      </div>
      {end && <div className="flex h-full shrink-0 items-center gap-1 border-l border-white/[0.06] px-1.5">{end}</div>}
    </div>
  );
}

/** Wide terminal (labels next to the top-bar icons): the chart area is ≥ 1440 px wide. */
export const WIDE_QUERY = "(min-width: 1440px)";

export function TopBarDivider() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-white/[0.08]" />;
}

/**
 * Instrument block: search combobox + last price (flash on change) + 24h change + name, data source
 * badge (DEMO / LIVE / DELAYED) and market-session dot.
 */
export function InstrumentHeader({
  symbol,
  onSymbol,
  name,
  price,
  precision,
  source,
  marketStatus,
}: {
  symbol: string;
  onSymbol: (s: string) => void;
  name?: string | null;
  price: number | null;
  precision: number;
  source?: SourceLike | null;
  marketStatus?: MarketSession | null;
}) {
  const symbols = useMemo(() => [symbol], [symbol]);
  const { data: quotes } = useQuotes(symbols, 30_000);
  const q = quotes?.quotes?.[symbol];
  const change = q && q.available ? q.change_24h_pct : null;
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <AssetSearchCombobox value={symbol} onChange={onSymbol} size="sm" className="w-40 shrink-0" ariaLabel="Инструмент" placeholder="Търси инструмент…" />
      <div className="flex min-w-0 flex-col justify-center leading-tight">
        <div className="flex items-center gap-1.5">
          <PriceText value={price} precision={precision} flash className="text-[14px] font-semibold" />
          {change !== null && change !== undefined && <ChangePill value={change} className="!text-[10.5px]" />}
        </div>
        <div className="flex max-w-56 items-center gap-1.5 text-[10.5px] text-muted">
          {marketStatus && <MarketStatusDot status={marketStatus} />}
          <span className="truncate" title={name ?? undefined}>
            {name || symbol}
          </span>
        </div>
      </div>
      <SourceBadge source={source ?? undefined} className="shrink-0" />
    </div>
  );
}

/** Collapse / expand toggles of the right ("]") and bottom ("\") panels. */
export function LayoutToggles({ layout }: { layout: TerminalLayoutState }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {layout.desktop && (
        <IconButton
          icon={PanelBottom}
          label={layout.bottomOpen ? "Скрий долния панел" : "Покажи долния панел"}
          shortcut={"\\"}
          active={layout.bottomOpen}
          size="sm"
          onClick={layout.toggleBottom}
        />
      )}
      <IconButton
        icon={PanelRight}
        label={layout.desktop ? (layout.rightOpen ? "Свий десния панел" : "Разгъни десния панел") : "Отвори панела"}
        shortcut="]"
        active={layout.desktop ? layout.rightOpen : layout.sheetOpen}
        size="sm"
        onClick={layout.toggleRight}
      />
    </div>
  );
}

/** Chart screenshot (PNG incl. drawings) — downloads the image. */
export function ScreenshotButton({ onCapture }: { onCapture: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <IconButton
      icon={Camera}
      label={failed ? "Снимката не успя — опитай отново" : "Снимка на графиката (PNG)"}
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          setFailed(!(await onCapture()));
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/**
 * Top bar of the chart terminals: instrument (search + quote + source + session) | timeframes (Alt+1…8) |
 * Indicators + chart type | Compare TFs (optional) + Replay | pinned: PAPER badge, screenshot, panel toggles.
 * Narrow terminals show icon-only buttons (accessible names unchanged: "Indicators", "Compare TFs", "Replay").
 */
export function TerminalTopBar({
  layout,
  ws,
  symbol,
  onSymbol,
  timeframe,
  onTimeframe,
  instrument,
  precision,
  beginner,
  onScreenshot,
  compare,
  paperBadge,
}: {
  layout: TerminalLayoutState;
  ws: ChartWorkspaceState;
  symbol: string;
  onSymbol: (s: string) => void;
  timeframe: string;
  onTimeframe: (tf: string) => void;
  instrument?: PaperInstrument | null;
  precision: number;
  beginner?: boolean;
  onScreenshot: () => Promise<boolean>;
  /** multi-timeframe toggle (/charts) */
  compare?: { on: boolean; toggle: () => void };
  paperBadge?: boolean;
}) {
  const wide = useMediaQuery(WIDE_QUERY, true);
  const replayHref = `/replay?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}`;
  return (
    <TopBar
      end={
        <>
          {paperBadge && <PaperBadge compact className="mr-1" />}
          <ScreenshotButton onCapture={onScreenshot} />
          <LayoutToggles layout={layout} />
        </>
      }
    >
      <InstrumentHeader
        symbol={symbol}
        onSymbol={onSymbol}
        name={instrument?.name}
        price={ws.lastPrice}
        precision={precision}
        source={ws.source ?? instrument?.source}
        marketStatus={instrument?.market_status}
      />
      <TopBarDivider />
      <TimeframeBar value={timeframe} onChange={onTimeframe} beginner={beginner} hotkeys />
      <TopBarDivider />
      <IndicatorMenu active={ws.active} onChange={ws.setActive} compact={!wide} />
      <ChartTypeMenu value={ws.chartType} onChange={ws.setChartType} />
      <TopBarDivider />
      {compare &&
        (wide ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={compare.on}
            onClick={compare.toggle}
            className={cx("shrink-0", compare.on && "border-accent/40 bg-accent/15 text-accent2")}
          >
            <Columns2 size={13} aria-hidden /> Compare TFs
          </Button>
        ) : (
          <IconButton icon={Columns2} label="Compare TFs" size="sm" active={compare.on} onClick={compare.toggle} />
        ))}
      <Link
        href={replayHref}
        aria-label="Replay"
        title={`Market Replay — ${symbol}`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
      >
        <Rewind size={13} aria-hidden />
        {wide && "Replay"}
      </Link>
    </TopBar>
  );
}
