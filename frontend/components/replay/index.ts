/*
 * Historical Replay V2 (work package S5) — components for /replay and for other packages.
 *
 *   <ReplayStatsCard className? />                       GET /replay/stats (avg / best score, accuracy, common flags → lessons)
 *   <ReplayHistory onOpen(row) activeId? limit? />       GET /replay?limit= (past sessions with score rings)
 *   <ScoreRing score grade? size? label? />              0–100 ring with the A/B/C/D grade
 *   <ReplayChart candles precision boundary="live"|"review" … />   TradingChart + hidden-future boundary
 *   <ReplayScreen api state options? beginner? onNew />  the active replay (decision bar, controls, HUD)
 *   <ReplayReview data onAnother onSetup busy? history? />   AI HISTORY REVIEW of a finished session
 *   useReplaySession()                                   state machine (start / open / step / decide / order / finish)
 */
export { DecisionPanel } from "@/components/replay/DecisionPanel";
export type { PickField } from "@/components/replay/DecisionPanel";
export { ReplayChart } from "@/components/replay/ReplayChart";
export type { ReplayChartProps } from "@/components/replay/ReplayChart";
export { ReplayHistory, ReplayStatsCard } from "@/components/replay/ReplayHistory";
export { ReplayReview } from "@/components/replay/ReplayReview";
export { ReplayScreen } from "@/components/replay/ReplayScreen";
export { ReplaySetup } from "@/components/replay/ReplaySetup";
export { ScoreHud } from "@/components/replay/ScoreHud";
export { TradePanel } from "@/components/replay/TradePanel";
export { ActionBadge, FlagChip, OutcomeBadge, ReplayToasts, ScoreRing } from "@/components/replay/parts";
export { useDecisionPreview, useReplaySession, useToastQueue } from "@/components/replay/useReplaySession";
export type { DecisionRequest, OrderRequest, ReplayError, ReplaySessionApi } from "@/components/replay/useReplaySession";
export * from "@/components/replay/model";
export type * from "@/components/replay/types";
