/*
 * AI Trading Teacher — public components for other packages (S2 terminal, S7 command center, …).
 *
 *   <StrategyView symbol="BTC/USDT" timeframe="1h" strategyId={8} compact />
 *     "What would the strategy do?" on the last CLOSED candle (POST /api/teacher/strategy-view): ✓/✕ per
 *     LONG/SHORT condition, regime-filter row (applied), result badge NO SETUP / POSSIBLE LONG SETUP /
 *     POSSIBLE SHORT SETUP, why bullets, hypothetical risk plan, exact disclaimer. Polls every 30 s.
 *     props: symbol: string; timeframe: string; strategyId?: number | null (omitted → the user's most
 *     recent own strategy, else the default template); compact?: boolean; className?: string
 *
 *   <AIPanel symbol timeframe strategyId? draft? compact? defaultTab? className? />
 *     Terminal right-panel block with tabs Strategy View | Explain | WHY? | Ask.
 *     draft?: { side: "long"|"short"|"buy"|"sell"; entry: number|null|undefined; stop?: number|null;
 *              target?: number|null; qty?: number|null } — "Explain this setup" sends it as the draft order
 *     (invalid/empty entry → explains the chart setup instead). Never places orders.
 *     defaultTab?: "strategy" | "explain" | "why" | "ask" (default "strategy").
 *     The panel fills its parent: give the parent a height and the tab content scrolls inside.
 *
 *   <TeacherAnswer answer onFollowUp? compact? busy? strategyId? className? />
 *     Renderer of a POST /api/teacher/ask response. Without onFollowUp the follow-ups link to /ai?mode=….
 *
 *   <ModePicker value onChange modes? compact? disabled? only? className? />
 *     The 8 teacher modes as chips with icons + one-line descriptions (modes from useTeacherModes()).
 *
 *   <ContextChips items loading? compact? /> — "What the teacher knows" (context_used).
 *   <ChatPanel symbol? timeframe? initialQuestion? compact? fill? className? /> — free-form chat (POST /api/ai/chat);
 *     fill → the message list grows to the container height (no fixed max height).
 *   <QuizCard quiz onNewQuiz? compact? />, <CompareTable comparison />, <ExamplesBlock examples compact? />
 *
 * Hooks: useTeacherModes(), useTeacherAsk(), useTeacherContext(symbol, tf, strategyId?), useStrategyView(…).
 * Deep link to the full page: teacherHref({ mode, symbol?, timeframe?, topic?, strategy_id?, position_id?, … })
 * → "/ai?mode=…&symbol=…&tf=…" (the /ai page auto-runs the mode).
 */
export { AIPanel } from "@/components/ai/AIPanel";
export type { AIPanelProps, AIPanelTab } from "@/components/ai/AIPanel";
export { ChatPanel } from "@/components/ai/ChatPanel";
export type { ChatPanelProps } from "@/components/ai/ChatPanel";
export { CompareTable } from "@/components/ai/CompareTable";
export { ContextChips } from "@/components/ai/ContextChips";
export { DecisionPanel } from "@/components/ai/DecisionPanel";
export { ExamplesBlock } from "@/components/ai/ExamplesBlock";
export { useStrategyView, useTeacherAsk, useTeacherContext, useTeacherModes } from "@/components/ai/hooks";
export { SETUP_DISCLAIMER, teacherHref } from "@/components/ai/model";
export { ModePicker } from "@/components/ai/ModePicker";
export type { ModePickerProps } from "@/components/ai/ModePicker";
export { QuizCard } from "@/components/ai/QuizCard";
export { SetupResultBadge, StrategyView, StrategyViewBody } from "@/components/ai/StrategyView";
export type { StrategyViewProps } from "@/components/ai/StrategyView";
export { TeacherAnswer } from "@/components/ai/TeacherAnswer";
export type { TeacherAnswerProps } from "@/components/ai/TeacherAnswer";
export type * from "@/components/ai/types";
