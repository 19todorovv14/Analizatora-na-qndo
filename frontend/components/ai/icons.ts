/*
 * Icons + accent classes of the AI Teacher UI. Class strings are literal so Tailwind's scanner sees them.
 */
import {
  ArrowLeftRight,
  Ban,
  Blocks,
  BookOpen,
  CandlestickChart,
  ClipboardCheck,
  Columns2,
  Crosshair,
  Eye,
  FlaskConical,
  GitBranch,
  GraduationCap,
  HelpCircle,
  History,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  NotebookPen,
  Route,
  Scale,
  ScanSearch,
  ScrollText,
  ShieldAlert,
  Sparkles,
  TestTubeDiagonal,
  ThumbsDown,
  ThumbsUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Accent } from "@/components/ai/model";
import type { TeacherMode } from "@/components/ai/types";

export const MODE_ICON: Record<TeacherMode, LucideIcon> = {
  explain: MessageSquareText,
  analyze: ScanSearch,
  teach: GraduationCap,
  review_trade: ClipboardCheck,
  review_strategy: FlaskConical,
  quiz: ListChecks,
  why: HelpCircle,
  compare: Columns2,
};

const ICON_BY_NAME: Record<string, LucideIcon> = {
  MessageSquareText,
  ScanSearch,
  GraduationCap,
  ClipboardCheck,
  FlaskConical,
  ListChecks,
  HelpCircle,
  CircleHelp: HelpCircle,
  Columns2,
};

/** Icon of a mode: the server's lucide name when known, else the built-in one. */
export function modeIcon(mode: TeacherMode | string, iconName?: string): LucideIcon {
  return (iconName && ICON_BY_NAME[iconName]) || MODE_ICON[mode as TeacherMode] || Sparkles;
}

export const SECTION_ICON: Record<string, LucideIcon> = {
  observation: Eye,
  rules: ListChecks,
  scenario: Route,
  invalidation: Ban,
  risk: ShieldAlert,
  alternative: GitBranch,
  why: HelpCircle,
  examples: History,
  draft: Crosshair,
  comparison: Columns2,
  conclusion: Scale,
  lesson: GraduationCap,
  example: CandlestickChart,
  next_lesson: BookOpen,
  what_happened: ScrollText,
  did_well: ThumbsUp,
  did_poorly: ThumbsDown,
  main_lesson: Lightbulb,
  strengths: ThumbsUp,
  weaknesses: ThumbsDown,
  overfitting: FlaskConical,
  next_test: TestTubeDiagonal,
  quiz: ListChecks,
};

export const CONTEXT_ICON: Record<string, LucideIcon> = {
  chart: CandlestickChart,
  strategy: Blocks,
  historical_examples: History,
  account: Wallet,
  trades: ArrowLeftRight,
  journal: NotebookPen,
  learning: GraduationCap,
  backtest: TestTubeDiagonal,
  compare: Columns2,
};

/** Accent → classes: left rule, icon chip, title ink, soft wash. */
export const ACCENT: Record<Accent, { rule: string; chip: string; ink: string; wash: string; dot: string }> = {
  info: { rule: "before:bg-info/70", chip: "bg-info/10 text-info ring-info/25", ink: "text-info", wash: "from-info/[0.06]", dot: "bg-info" },
  violet: {
    rule: "before:bg-violet/70",
    chip: "bg-violet/10 text-violet ring-violet/25",
    ink: "text-violet",
    wash: "from-violet/[0.06]",
    dot: "bg-violet",
  },
  accent: {
    rule: "before:bg-accent2/70",
    chip: "bg-accent/15 text-accent2 ring-accent/30",
    ink: "text-accent2",
    wash: "from-accent/[0.07]",
    dot: "bg-accent2",
  },
  warn: { rule: "before:bg-warn/70", chip: "bg-warn/10 text-warn ring-warn/25", ink: "text-warn", wash: "from-warn/[0.06]", dot: "bg-warn" },
  down: { rule: "before:bg-down/70", chip: "bg-down/10 text-down ring-down/25", ink: "text-down", wash: "from-down/[0.06]", dot: "bg-down" },
  gold: { rule: "before:bg-gold/70", chip: "bg-gold/10 text-gold ring-gold/25", ink: "text-gold", wash: "from-gold/[0.05]", dot: "bg-gold" },
  up: { rule: "before:bg-up/70", chip: "bg-up/10 text-up ring-up/25", ink: "text-up", wash: "from-up/[0.06]", dot: "bg-up" },
  neutral: {
    rule: "before:bg-white/20",
    chip: "bg-white/[0.05] text-muted ring-white/10",
    ink: "text-muted",
    wash: "from-white/[0.03]",
    dot: "bg-faint",
  },
};
