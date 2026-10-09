/*
 * Terminal — building blocks of the full-bleed chart terminals (/charts, /trade); reusable by /replay (S5).
 *
 *   const layout = useTerminalLayout(route, { right?: {def,min,max}, bottom?: {def,min,max}, rightOpen?, bottomOpen? })
 *     Panel sizes persisted under "ta-term:<route>:right|bottom" (usePanelSize), open state under
 *     "ta-term:<route>:right-open|bottom-open". layout.toggleRight / toggleBottom / openRight; layout.desktop (≥ lg).
 *   <TerminalLayout layout top left?={(orientation) => …} chart right={{tabs, active, onActive, render(tab|null),
 *                   stacked?, title?}} bottom={{tabs, active, onActive, render(tab), extra?}} />
 *     CSS grid (areas top / left / chart / right / bottom) with resize handles; collapsed right panel → icon rail,
 *     collapsed bottom → tab header only. Below lg: stacked page (chart 60dvh), right panel as drawer / bottom sheet
 *     opened from a sticky tab bar. PanelTab = { key, label, icon: LucideIcon, badge? }.
 *   useTerminalHotkeys({ onTimeframe?, onTool?, onSide?, toggleRight?, toggleBottom?, enabled? })
 *     Alt+1…8 timeframes, H / T / R / M tools, Esc → cursor, B / S order side, "]" right, "\" bottom panel.
 *   <TerminalTopBar layout ws symbol onSymbol timeframe onTimeframe instrument? precision beginner? onScreenshot
 *                   compare?={{on, toggle}} paperBadge? />  (+ TopBar, TopBarDivider, InstrumentHeader,
 *     LayoutToggles, ScreenshotButton for custom bars)
 *   usePaperTerminal({ storageKey, symbol, timeframe, beginner }) → account / trades / instrument / ticket / calc /
 *     draft / ws (useChartWorkspace) / refresh / onPlaced / captureTrade / screenshot / click-to-set (pick,
 *     onPriceClick, chooseLevel, closePick).
 *   usePaperBottomPanel({ route, view, trades, beginner, symbol, timeframe, marketStatus?, onChanged, … }) →
 *     bottom config: Positions | Orders | History | Activity | Replay + <SessionInfo/>.
 *   <PriceLevelChooser pick precision onChoose onClose />  "Set as Entry / SL / TP" (TradingChart children).
 *   <CompareGrid symbol onExit />  multi-timeframe 5m · 1H · 4H · 1D ("← Single chart").
 *   <SessionInfo timeframe marketStatus? />, <ReplayCard symbol timeframe />.
 * Pure helpers (model.ts): gridTemplate, fitPanel, termKey, timeframeBindings, letterBindings, createNavTracker,
 * barCloseIn, fmtCountdown, fmtUtcClock, screenshotName, readTerminalQuery.
 */
export { CompareGrid, COMPARE_TFS } from "@/components/terminal/CompareGrid";
export {
  BOTTOM_LIMITS,
  LG_QUERY,
  RIGHT_LIMITS,
  SM_QUERY,
  barCloseIn,
  createNavTracker,
  fitPanel,
  fmtCountdown,
  fmtUtcClock,
  gridTemplate,
  letterBindings,
  prefillStatus,
  readTerminalQuery,
  screenshotName,
  termKey,
  timeframeBindings,
} from "@/components/terminal/model";
export type { TerminalQuery } from "@/components/terminal/model";
export { BOTTOM_TABS, ReplayCard, usePaperBottomPanel } from "@/components/terminal/PaperBottomPanel";
export type { BottomTab } from "@/components/terminal/PaperBottomPanel";
export { PriceLevelChooser } from "@/components/terminal/PriceLevelChooser";
export type { PricePick } from "@/components/terminal/PriceLevelChooser";
export { SessionInfo } from "@/components/terminal/SessionInfo";
export { TerminalLayout, useTerminalLayout } from "@/components/terminal/TerminalLayout";
export type { BottomPanelConfig, PanelTab, RightPanelConfig, TerminalLayoutState } from "@/components/terminal/TerminalLayout";
export { InstrumentHeader, LayoutToggles, ScreenshotButton, TerminalTopBar, TopBar, TopBarDivider, WIDE_QUERY } from "@/components/terminal/TerminalTopBar";
export { usePaperTerminal } from "@/components/terminal/usePaperTerminal";
export type { PaperTerminal } from "@/components/terminal/usePaperTerminal";
export { useTerminalHotkeys } from "@/components/terminal/useTerminalHotkeys";
export type { TerminalHotkeys } from "@/components/terminal/useTerminalHotkeys";
