/*
 * Paper trading — public components for other packages (S5 replay, S7 command center, asset page, …).
 * Everything is PAPER (virtual money): the only endpoints used are /api/paper/*.
 *
 *   <OrderPanel symbol price precision equity timeframe onPlaced? beginner?
 *               ticket? account? onSymbol? instrument? heading? chartPick? className? />
 *     Order ticket: Asset (search when onSymbol), BUY / LONG · SELL / SHORT, Market / Limit / Stop, Entry, Stop Loss,
 *     Take Profit (quick 0.5 / 1 / 2 % stop, 1.5 / 2 / 3R target), size by risk % or manual units ("Manual size",
 *     placeholder "Количество (единици)"), per-order LEVERAGE (slider capped at the instrument max + liquidation
 *     estimate + "Higher leverage magnifies exposure and liquidation risk."), live preview (risk $ / %, potential
 *     P/L, R:R, margin, spread / fee) and findings (never blocking). Submit "BUY / LONG <qty> · virtual".
 *     ticket: a page-level useOrderTicket(symbol) so the chart (draft lines, click-to-set) and the AI panel share
 *     the draft; omitted → internal state. instrument: GET /paper/instrument payload (fetched when omitted).
 *   <AccountBlock view? advanced? />  PAPER ACCOUNT: Balance, Equity, Available margin, Used margin, Unrealized
 *     P/L, Margin level (+ Realized P/L, Exposure when advanced). view = GET /paper/account (skeleton while null).
 *   <LeverageControl value effective accountDefault max steps onChange liquidation? liquidationDistancePct?
 *                    precision warning? disabled? />   (value null = account default; no "recommended" step)
 *   <PositionsTable positions onChanged beginner onSelectSymbol? />  SL/TP editor, "SL → break-even",
 *     "Partial close", "Close"; mark_available === false → DATA NOT AVAILABLE instead of P/L.
 *   <OrdersTable orders onChanged onSelectSymbol? />  ("Cancel")
 *   <TradesTable trades captureScreenshot? onSelectSymbol? />  "AI review" modal + "📓" → "Journal this trade"
 *     with a chart screenshot (captureScreenshot(trade) may be async, e.g. ChartCapture with focus).
 *   <ActivityList events loading? />, <AccountMetrics view beginner />, <TradeReviewCard review />.
 *
 * Model (pure, unit-tested): ticket.ts — INITIAL_TICKET, ticketReducer, computeTicket, orderRequest,
 * submitLabel, quickStopText / quickTargetText, draftLevels, aiDraft, ticketHints. Hooks: useOrderTicket(symbol),
 * useOrderPreview(request). Sizing maths: lib/sizing.ts.
 */
export { AccountBlock, marginLevelPct } from "@/components/trading/AccountBlock";
export { ActivityList, eventTone } from "@/components/trading/ActivityList";
export { LEVERAGE_WARNING, LeverageControl, stepIndex } from "@/components/trading/LeverageControl";
export { OrderPanel } from "@/components/trading/OrderPanel";
export { AccountMetrics, OrdersTable, PositionsTable, TradesTable, isWideningStop } from "@/components/trading/Tables";
export type { TradeCapture } from "@/components/trading/Tables";
export { TradeReviewCard } from "@/components/trading/TradeReviewCard";
export {
  INITIAL_TICKET,
  RISK_PCTS,
  SETUPS,
  STOP_PCTS,
  TARGET_RS,
  aiDraft,
  applyPrefill,
  computeTicket,
  draftLevels,
  effectiveLeverage,
  orderRequest,
  quickStopText,
  quickTargetText,
  requestKey,
  submitLabel,
  ticketHints,
  ticketReducer,
} from "@/components/trading/ticket";
export type { DraftLevel, LevelKind, OrderRequest, TicketAction, TicketCalc, TicketInstrument, TicketPrefill, TicketState } from "@/components/trading/ticket";
export { useOrderPreview, useOrderTicket } from "@/components/trading/useOrderTicket";
export type { OrderTicket, PreviewState } from "@/components/trading/useOrderTicket";
