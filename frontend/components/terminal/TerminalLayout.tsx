"use client";

import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BOTTOM_LIMITS,
  LG_QUERY,
  MIN_CHART_HEIGHT,
  MIN_CHART_WIDTH,
  RIGHT_LIMITS,
  SM_QUERY,
  fitPanel,
  gridTemplate,
  termKey,
  type PanelLimits,
} from "@/components/terminal/model";
import { Drawer, IconButton, ResizeHandle, usePanelSize, useStoredState } from "@/components/ui";
import { cx } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";

export type PanelTab = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** small count / status next to the label */
  badge?: React.ReactNode;
};

const asBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

export type TerminalLayoutState = {
  route: string;
  /** ≥ lg: grid with side + bottom panels; below: stacked page + drawer */
  desktop: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  rightSize: number;
  bottomSize: number;
  setRightSize: (v: number | ((p: number) => number)) => void;
  setBottomSize: (v: number | ((p: number) => number)) => void;
  /** desktop: expand / collapse the right panel · mobile: open / close the drawer */
  toggleRight: () => void;
  openRight: () => void;
  toggleBottom: () => void;
  setBottomOpen: (open: boolean) => void;
  /** mobile / tablet drawer of the right panel */
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  limits: { right: PanelLimits; bottom: PanelLimits };
};

/**
 * Panel state of a terminal route, persisted per viewer: sizes under "ta-term:<route>:right|bottom"
 * (usePanelSize), open / collapsed under "ta-term:<route>:right-open|bottom-open".
 */
export function useTerminalLayout(
  route: string,
  opts: { right?: Partial<PanelLimits>; bottom?: Partial<PanelLimits>; rightOpen?: boolean; bottomOpen?: boolean } = {},
): TerminalLayoutState {
  const right = { ...RIGHT_LIMITS, ...opts.right };
  const bottom = { ...BOTTOM_LIMITS, ...opts.bottom };
  const desktop = useMediaQuery(LG_QUERY, true);
  const [rightSize, setRightSize] = usePanelSize(termKey(route, "right"), right.def, right.min, right.max);
  const [bottomSize, setBottomSize] = usePanelSize(termKey(route, "bottom"), bottom.def, bottom.min, bottom.max);
  const [rightOpen, setRightOpen] = useStoredState<boolean>(termKey(route, "right-open"), opts.rightOpen ?? true, { validate: asBool });
  const [bottomOpen, setBottomOpen] = useStoredState<boolean>(termKey(route, "bottom-open"), opts.bottomOpen ?? true, { validate: asBool });
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleRight = useCallback(() => {
    if (desktop) setRightOpen((o) => !o);
    else setSheetOpen((o) => !o);
  }, [desktop, setRightOpen]);
  const openRight = useCallback(() => {
    if (desktop) setRightOpen(true);
    else setSheetOpen(true);
  }, [desktop, setRightOpen]);
  const toggleBottom = useCallback(() => setBottomOpen((o) => !o), [setBottomOpen]);

  return {
    route,
    desktop,
    rightOpen,
    bottomOpen,
    rightSize,
    bottomSize,
    setRightSize,
    setBottomSize,
    toggleRight,
    openRight,
    toggleBottom,
    setBottomOpen,
    sheetOpen: !desktop && sheetOpen,
    setSheetOpen,
    limits: { right, bottom },
  };
}

export type RightPanelConfig = {
  tabs: PanelTab[];
  active: string;
  onActive: (key: string) => void;
  /** null → all sections (desktop "stacked" panels); a tab key → that section only */
  render: (tab: string | null) => React.ReactNode;
  /** desktop: render every section in one scrolling column instead of tabs */
  stacked?: boolean;
  /** header title of a stacked panel */
  title?: React.ReactNode;
};

export type BottomPanelConfig = {
  tabs: PanelTab[];
  active: string;
  onActive: (key: string) => void;
  render: (tab: string) => React.ReactNode;
  /** right side of the tab header (session info, clock…) */
  extra?: React.ReactNode;
};

function TabStrip({ tabs, active, onPick, dense }: { tabs: PanelTab[]; active: string; onPick: (k: string) => void; dense?: boolean }) {
  return (
    <div className="no-scrollbar flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
      {tabs.map((t) => {
        const on = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(t.key)}
            className={cx(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150",
              dense ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[12.5px]",
              on ? "bg-white/[0.07] text-text" : "text-muted hover:bg-white/[0.04] hover:text-text",
            )}
          >
            <Icon size={13} className={on ? "text-accent2" : "text-faint"} aria-hidden />
            {t.label}
            {t.badge !== undefined && t.badge !== null && t.badge !== "" && (
              <span className="num rounded bg-white/[0.08] px-1 text-[10px] leading-4 text-muted">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Terminal frame: CSS grid with areas top / left / chart / right / bottom filling the full-bleed <main>
 * (calc(100dvh − top bar)). Right and bottom panels are resizable (ResizeHandle, sizes persisted per
 * route) and collapsible (buttons; the pages bind "]" and "\"). Below lg the page stacks: top bar
 * (scrolls sideways), horizontal drawing tools, chart (60dvh), bottom panel, and the right panel opens as
 * a drawer (tablet) / bottom sheet (phone) from a sticky tab bar. The chart keeps its React position in
 * both modes, so switching never re-creates it.
 */
export function TerminalLayout({
  layout,
  top,
  left,
  chart,
  right,
  bottom,
  className,
}: {
  layout: TerminalLayoutState;
  top: React.ReactNode;
  /** drawing tools; gets the orientation of the current mode */
  left?: (orientation: "vertical" | "horizontal") => React.ReactNode;
  chart: React.ReactNode;
  right: RightPanelConfig;
  bottom: BottomPanelConfig;
  className?: string;
}) {
  const { desktop, rightOpen, bottomOpen, limits } = layout;
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const phone = !useMediaQuery(SM_QUERY, true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox((b) => (b && Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasLeft = !!left;
  // keep MIN_CHART_* for the chart whatever the stored sizes are
  const rightSize = fitPanel(layout.rightSize, limits.right, box?.w, MIN_CHART_WIDTH + (hasLeft ? 44 : 0));
  const bottomSize = fitPanel(layout.bottomSize, limits.bottom, box?.h, MIN_CHART_HEIGHT + 48);
  const grid = gridTemplate({ hasLeft, rightOpen, rightSize, bottomOpen, bottomSize });
  const rightTab = right.tabs.find((t) => t.key === right.active) ?? right.tabs[0];

  const bottomHeader = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-1.5">
      <TabStrip
        tabs={bottom.tabs}
        active={bottom.active}
        dense
        onPick={(k) => {
          bottom.onActive(k);
          if (desktop && !bottomOpen) layout.setBottomOpen(true);
        }}
      />
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        {bottom.extra}
        {desktop && (
          <IconButton
            icon={bottomOpen ? ChevronDown : ChevronUp}
            label={bottomOpen ? "Скрий долния панел" : "Покажи долния панел"}
            shortcut={"\\"}
            size="sm"
            tooltipSide="top"
            onClick={layout.toggleBottom}
          />
        )}
      </div>
    </div>
  );

  const rightHeader = (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.06] pl-1.5 pr-1">
      {right.stacked ? (
        <div className="min-w-0 flex-1 truncate px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{right.title}</div>
      ) : (
        <div className="min-w-0 flex-1">
          <TabStrip tabs={right.tabs} active={right.active} onPick={right.onActive} />
        </div>
      )}
      <IconButton icon={PanelRightClose} label="Свий десния панел" shortcut="]" size="sm" tooltipSide="left" onClick={layout.toggleRight} />
    </div>
  );

  const rail = (
    <div className="flex h-full flex-col items-center gap-1 py-1.5">
      <IconButton icon={PanelRightOpen} label="Разгъни десния панел" shortcut="]" size="sm" tooltipSide="left" onClick={layout.toggleRight} />
      <span className="my-1 h-px w-5 bg-white/[0.07]" aria-hidden />
      {right.tabs.map((t) => (
        <IconButton
          key={t.key}
          icon={t.icon}
          label={t.label}
          size="sm"
          tooltipSide="left"
          active={!right.stacked && t.key === right.active}
          onClick={() => {
            right.onActive(t.key);
            layout.openRight();
          }}
        />
      ))}
    </div>
  );

  return (
    <>
      <div
        ref={rootRef}
        data-terminal={layout.route}
        className={cx(
          // explicit height: the full-bleed <main> is a flex item whose height is not definite for children
          "h-[calc(100dvh-var(--spacing-topbar))] min-h-0",
          desktop ? "grid overflow-hidden" : "flex flex-col overflow-y-auto overflow-x-hidden",
          className,
        )}
        style={desktop ? { gridTemplateColumns: grid.columns, gridTemplateRows: grid.rows, gridTemplateAreas: grid.areas } : undefined}
      >
        {/* slot 0 — top bar */}
        <div
          style={desktop ? { gridArea: "top" } : undefined}
          className={cx("min-w-0 border-b border-white/[0.06] bg-surface/40", !desktop && "sticky top-0 z-20 shrink-0 backdrop-blur-md")}
        >
          {top}
        </div>
        {/* slot 1 — drawing tools */}
        {hasLeft ? (
          <div
            style={desktop ? { gridArea: "left" } : undefined}
            className={cx(
              desktop ? "no-scrollbar min-h-0 overflow-y-auto border-r border-white/[0.06] px-1" : "shrink-0 border-b border-white/[0.06] py-1",
            )}
          >
            {left?.(desktop ? "vertical" : "horizontal")}
          </div>
        ) : null}
        {/* slot 2 — chart (same position in both modes → never re-mounted) */}
        <div style={desktop ? { gridArea: "chart" } : undefined} className={cx("relative min-w-0", desktop ? "min-h-0" : "h-[60dvh] min-h-[300px] shrink-0")}>
          {chart}
        </div>
        {/* slot 3 — bottom resize handle (desktop, open) */}
        {desktop && bottomOpen ? (
          <div style={{ gridArea: "bh" }} className="min-w-0">
            <ResizeHandle
              direction="vertical"
              label="Размер на долния панел"
              valueNow={bottomSize}
              valueMin={limits.bottom.min}
              valueMax={limits.bottom.max}
              onResize={(d) => layout.setBottomSize((s) => fitPanel(s, limits.bottom, box?.h, MIN_CHART_HEIGHT + 48) - d)}
              onDoubleClick={() => layout.setBottomSize(limits.bottom.def)}
              className="h-full"
            />
          </div>
        ) : null}
        {/* slot 4 — bottom panel */}
        <section
          aria-label="Позиции, поръчки и история"
          style={desktop ? { gridArea: "bottom" } : undefined}
          className={cx("flex min-w-0 flex-col bg-surface/30", desktop ? "min-h-0 border-t border-white/[0.06]" : "shrink-0 border-t border-white/[0.06]")}
        >
          {bottomHeader}
          {(bottomOpen || !desktop) && <div className={cx("min-w-0", desktop ? "min-h-0 flex-1 overflow-auto" : "min-h-[220px] pb-2")}>{bottom.render(bottom.active)}</div>}
        </section>
        {/* slot 5 — right resize handle */}
        {desktop && rightOpen ? (
          <div style={{ gridArea: "rh" }} className="min-h-0">
            <ResizeHandle
              direction="horizontal"
              label="Ширина на десния панел"
              valueNow={rightSize}
              valueMin={limits.right.min}
              valueMax={limits.right.max}
              onResize={(d) => layout.setRightSize((s) => fitPanel(s, limits.right, box?.w, MIN_CHART_WIDTH) - d)}
              onDoubleClick={() => layout.setRightSize(limits.right.def)}
              className="h-full"
            />
          </div>
        ) : null}
        {/* slot 6 — right panel (desktop) / sticky sheet tab bar (mobile) */}
        {desktop ? (
          <aside aria-label={typeof rightTab?.label === "string" ? rightTab.label : "Панел"} style={{ gridArea: "right" }} className="flex min-h-0 min-w-0 flex-col border-l border-white/[0.06] bg-surface/40">
            {rightOpen ? (
              <>
                {rightHeader}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{right.render(right.stacked ? null : right.active)}</div>
              </>
            ) : (
              rail
            )}
          </aside>
        ) : (
          <nav aria-label="Панели" className="glass-strong sticky bottom-0 z-20 mt-auto grid shrink-0 auto-cols-fr grid-flow-col gap-1 border-x-0 border-b-0 p-1.5">
            {right.tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    right.onActive(t.key);
                    layout.setSheetOpen(true);
                  }}
                  className="flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
                >
                  <Icon size={16} aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
      {!desktop && (
        <Drawer
          open={layout.sheetOpen}
          onClose={() => layout.setSheetOpen(false)}
          side={phone ? "bottom" : "right"}
          ariaLabel={rightTab?.label ?? "Панел"}
          padded={false}
          className={phone ? "h-[85dvh]" : undefined}
        >
          <div className="flex h-full min-h-0 flex-col">
            {right.tabs.length > 1 && (
              <div className="shrink-0 border-b border-white/[0.06] px-2 py-1.5">
                <TabStrip tabs={right.tabs} active={right.active} onPick={right.onActive} />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">{right.render(right.active)}</div>
          </div>
        </Drawer>
      )}
    </>
  );
}
