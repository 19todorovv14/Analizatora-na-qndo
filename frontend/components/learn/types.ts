/*
 * Response shapes of the S3a learning API (backend/app/services/learning_service.py):
 * GET /api/learn/path, GET /api/learn/dashboard, GET /api/learn/candle-drilldown, plus the
 * /api/academy/* lesson and quiz payloads used by the lesson and quiz pages.
 */
import type { SourceLike } from "@/components/ui";

export type LevelStatus = "locked" | "available" | "in_progress" | "completed";

export type PathLesson = {
  slug: string;
  title: string;
  summary: string;
  completed: boolean;
  xp: number;
  visual_type: string | null;
  /** always link lessons with href — two lessons live at alias routes (/learn/leverage-basics …) */
  href: string;
};

export type PathModule = {
  key: string;
  title: string;
  description: string;
  category: string;
  unlocked: boolean;
  lessons_total: number;
  lessons_completed: number;
  percent: number;
  quiz_href: string;
  lessons: PathLesson[];
};

export type PathQuiz = {
  key: string;
  title: string;
  /** fraction 0–1 */
  best_score: number | null;
  /** 0–100 */
  best_pct: number | null;
  passed: boolean;
  attempts: number;
  questions: number;
  href: string;
};

export type PathLab = { href: string; title: string; description?: string; attempted: boolean | null };

export type PathLevel = {
  level: number;
  key: string;
  title: string;
  title_bg: string;
  goal: string;
  unlock: { rule: string; after_module: string | null; text: string };
  status: LevelStatus;
  percent: number;
  lessons_total: number;
  lessons_completed: number;
  xp_total: number;
  quiz: PathQuiz | null;
  modules: PathModule[];
  labs: PathLab[];
};

export type NextStep = {
  type: "lesson" | "quiz" | "lab";
  href: string;
  title: string;
  level: number | null;
  slug: string | null;
  module: string | null;
};

export type LearningPath = {
  levels: PathLevel[];
  current_level: number;
  next: NextStep | null;
  pass_score: number;
  lessons_total: number;
  lessons_completed: number;
  levels_completed: number;
};

export type SkillKey = "candles" | "structure" | "indicators" | "risk" | "leverage" | "strategy" | "backtesting" | "psychology";

export type Skill = {
  key: SkillKey | string;
  title: string;
  title_bg: string;
  /** 0–100 */
  score: number;
  basis: string;
  href: string | null;
  inputs?: {
    lessons_completed: number;
    lessons_total: number;
    lessons_pct: number;
    quiz_pct: number | null;
    practice: number[];
    practice_avg: number | null;
  };
};

export type SkillBrief = { key: string; title: string; title_bg: string; score: number };

export type Mistake = {
  key: string;
  title: string;
  title_bg?: string | null;
  count: number;
  lesson: string | null;
  lesson_title?: string | null;
  href: string | null;
  source?: "behavior" | "journal" | "both";
};

export type RiskDiscipline = {
  score: number | null;
  trades: number;
  components: {
    with_stop_pct: number | null;
    within_risk_rule_pct: number | null;
    no_widened_stops_pct: number | null;
    rr_ok_pct: number | null;
  };
  rules?: { max_risk_per_trade_pct: number; min_reward_risk: number };
};

export type Recommendation = { kind?: string; title: string; href: string; reason: string };

export type LearningDashboard = {
  current_level: { level: number; key?: string; title: string; title_bg?: string; status?: LevelStatus; percent?: number };
  next?: NextStep | null;
  xp: number;
  xp_level: number;
  xp_progress?: { level_start: number; next_level_at: number; into_level: number; needed: number; percent: number };
  lessons_completed: number;
  lessons_total: number;
  levels_completed?: number;
  levels_total?: number;
  /** 0–100 */
  quiz_avg_score: number | null;
  quizzes_passed: number;
  quizzes_total?: number;
  /** 0–100 */
  replay_score: number | null;
  replay_sessions: number;
  replay_finished?: number;
  paper_trades: number;
  risk_discipline: RiskDiscipline;
  most_common_mistake: Mistake | null;
  skills: Skill[];
  strongest_skill: SkillBrief | null;
  weakest_skill: SkillBrief | null;
  recommendations: Recommendation[];
};

export type OhlcCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

export type Drilldown = {
  symbol: string;
  timeframe: string;
  child_timeframe: string;
  precision: number;
  source: SourceLike | null;
  disclaimer?: string;
  available: boolean;
  reason: string | null;
  parent: OhlcCandle | null;
  candles: OhlcCandle[];
  complete: boolean;
  matches_parent: boolean;
  expected_candles: number;
  anatomy: {
    direction: "bullish" | "bearish" | "neutral" | string;
    range: number;
    body: number;
    upper_wick: number;
    lower_wick: number;
    body_pct: number;
    upper_wick_pct: number;
    lower_wick_pct: number;
  } | null;
  path: {
    high_time: number;
    low_time: number;
    high_index: number;
    low_index: number;
    first_extreme: "high" | "low" | "same" | null;
    close_position_pct: number;
    open_position_pct: number;
    largest_move: { time: number; index: number; change_pct: number } | null;
  } | null;
  explanation: string[];
  summary?: string;
};

export type LessonDetail = {
  slug: string;
  title: string;
  summary: string;
  body: string[];
  sections: { heading: string; body: string[] }[];
  key_points: string[];
  common_mistakes: string[];
  visual: { type: string; [k: string]: unknown } | null;
  xp: number;
  module: string;
  module_title: string;
  completed: boolean;
  module_unlocked: boolean;
  prev: string | null;
  next: string | null;
  index: number;
  count: number;
  keywords?: string[];
  // V2 (additive)
  href?: string;
  prev_href?: string | null;
  next_href?: string | null;
  quiz_href?: string;
  level?: number;
  level_title?: string;
  level_title_bg?: string;
};

export type ModuleDetail = {
  key: string;
  title: string;
  category: string;
  description: string;
  level?: number;
  lessons_total: number;
  lessons_completed: number;
  percent: number;
  quiz_score: number | null;
  quiz_passed: boolean;
  unlocked: boolean;
  quiz_questions: number;
  lessons: { slug: string; title: string; summary: string; xp: number; completed: boolean; visual: string | null; href?: string }[];
};

export type QuizPayload = {
  module: string;
  title: string;
  questions: { id: string; question: string; options: string[] }[];
  pass_score: number;
};

export type QuizResult = {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
  xp_gained: number;
  unlocked_module: string | null;
  results: {
    id: string;
    question: string;
    your_answer: number | null;
    correct_answer: number;
    options: string[];
    correct: boolean;
    explanation: string;
  }[];
};

/** Lesson URL: the API `href` when present, else the alias-aware /learn/<route> (see lib/lessons). */
export { lessonHref } from "@/lib/lessons";
