/* Unit tests for the academy page helpers (components/learn/model.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FLOW_STEPS,
  connectorTone,
  currentLevel,
  defaultOpenLevels,
  fmtXp,
  learningFlow,
  overallPercent,
  quizIsNext,
  scoreTone,
  toggleLevel,
} from "../model";
import type { LearningDashboard, LearningPath, PathLevel } from "../types";

function level(n: number, over: Partial<PathLevel> = {}): PathLevel {
  return {
    level: n,
    key: `l${n}`,
    title: `Level ${n}`,
    title_bg: `Ниво ${n}`,
    goal: "Цел",
    unlock: { rule: "previous_quiz_or_progress", after_module: null, text: "" },
    status: n === 0 ? "available" : "locked",
    percent: 0,
    lessons_total: 4,
    lessons_completed: 0,
    xp_total: 40,
    quiz: { key: `m${n}`, title: `Quiz ${n}`, best_score: null, best_pct: null, passed: false, attempts: 0, questions: 8, href: `/learn/quiz/m${n}` },
    modules: [],
    labs: [],
    ...over,
  };
}

function path(over: Partial<LearningPath> = {}): LearningPath {
  return {
    levels: Array.from({ length: 11 }, (_, i) => level(i)),
    current_level: 0,
    next: { type: "lesson", href: "/learn/what-is-a-financial-market", title: "Какво е financial market?", level: 0, slug: "what-is-a-financial-market", module: "level0" },
    pass_score: 0.7,
    lessons_total: 117,
    lessons_completed: 0,
    levels_completed: 0,
    ...over,
  };
}

function dash(over: Partial<LearningDashboard> = {}): LearningDashboard {
  return {
    current_level: { level: 0, title: "Market Basics" },
    xp: 0,
    xp_level: 1,
    lessons_completed: 0,
    lessons_total: 117,
    quiz_avg_score: null,
    quizzes_passed: 0,
    replay_score: null,
    replay_sessions: 0,
    paper_trades: 0,
    risk_discipline: { score: null, trades: 0, components: { with_stop_pct: null, within_risk_rule_pct: null, no_widened_stops_pct: null, rr_ok_pct: null } },
    most_common_mistake: null,
    skills: [],
    strongest_skill: null,
    weakest_skill: null,
    recommendations: [],
    ...over,
  };
}

describe("learningFlow", () => {
  test("has the 8 steps of the learning loop in order", () => {
    assert.deepEqual(
      FLOW_STEPS.map((s) => s.label),
      ["LEARN", "UNDERSTAND", "PRACTICE", "REPLAY", "BACKTEST", "PAPER TRADE", "REVIEW", "IMPROVE"],
    );
  });
  test("fresh guest: nothing done, LEARN is next and links to path.next", () => {
    const steps = learningFlow(path(), dash());
    assert.equal(steps.filter((s) => s.done).length, 0);
    assert.equal(steps[0].next, true);
    assert.equal(steps.filter((s) => s.next).length, 1);
    assert.equal(steps[0].href, "/learn/what-is-a-financial-market");
  });
  test("lessons + a passed quiz → PRACTICE is next", () => {
    const steps = learningFlow(path({ lessons_completed: 12 }), dash({ quizzes_passed: 1 }));
    assert.deepEqual(steps.filter((s) => s.done).map((s) => s.key), ["learn", "understand"]);
    assert.equal(steps.find((s) => s.next)?.key, "practice");
  });
  test("works without the dashboard (quiz evidence from the path)", () => {
    const p = path({ lessons_completed: 3 });
    p.levels[0] = level(0, { quiz: { ...level(0).quiz!, passed: true, best_pct: 90, best_score: 0.9, attempts: 1 } });
    assert.equal(learningFlow(p, undefined).find((s) => s.key === "understand")?.done, true);
  });
  test("lab evidence: replay, backtest and journal come from attempted labs", () => {
    const p = path({ lessons_completed: 3 });
    p.levels[1] = level(1, { labs: [{ href: "/learn/candlesticks", title: "Candlestick Lab", attempted: true }] });
    p.levels[8] = level(8, { labs: [{ href: "/backtesting", title: "Backtesting Lab", attempted: true }] });
    p.levels[9] = level(9, { labs: [{ href: "/journal", title: "Journal", attempted: true }] });
    p.levels[10] = level(10, { labs: [{ href: "/replay", title: "Replay", attempted: true }, { href: "/markets", title: "Markets", attempted: null }] });
    const done = Object.fromEntries(learningFlow(p, dash()).map((s) => [s.key, s.done]));
    assert.equal(done.practice, true);
    assert.equal(done.backtest, true);
    assert.equal(done.review, true);
    assert.equal(done.replay, true);
    assert.equal(done.paper, false);
    assert.equal(done.improve, false);
  });
  test("IMPROVE is done only when every other step is; then nothing is 'next'", () => {
    const p = path({ lessons_completed: 117, next: null });
    p.levels[10] = level(10, {
      labs: [
        { href: "/learn/candlesticks", title: "Lab", attempted: true },
        { href: "/backtesting", title: "Backtesting", attempted: true },
        { href: "/journal", title: "Journal", attempted: true },
      ],
    });
    const steps = learningFlow(p, dash({ quizzes_passed: 11, replay_sessions: 2, paper_trades: 5 }));
    assert.ok(steps.every((s) => s.done));
    assert.ok(steps.every((s) => !s.next));
    assert.equal(steps[0].href, "/learn");
  });
});

describe("level helpers", () => {
  test("currentLevel falls back to the first level", () => {
    assert.equal(currentLevel(path({ current_level: 4 }))?.level, 4);
    assert.equal(currentLevel(path({ current_level: 42 }))?.level, 0);
  });
  test("defaultOpenLevels opens the current level; toggleLevel is immutable", () => {
    const open = defaultOpenLevels(path({ current_level: 2 }));
    assert.deepEqual([...open], [2]);
    const more = toggleLevel(open, 5);
    assert.deepEqual([...more].sort(), [2, 5]);
    assert.deepEqual([...open], [2]);
    assert.deepEqual([...toggleLevel(more, 2)], [5]);
  });
  test("quizIsNext when all lessons are done and the quiz is not passed", () => {
    assert.equal(quizIsNext(level(0)), false);
    assert.equal(quizIsNext(level(0, { lessons_completed: 4 })), true);
    assert.equal(quizIsNext(level(0, { lessons_completed: 4, quiz: { ...level(0).quiz!, passed: true } })), false);
    assert.equal(quizIsNext(level(0, { lessons_completed: 4, quiz: null })), false);
  });
  test("connectorTone between timeline nodes", () => {
    assert.equal(connectorTone("completed", "in_progress"), "done-to-open");
    assert.equal(connectorTone("completed", "locked"), "done");
    assert.equal(connectorTone("completed", null), "done");
    assert.equal(connectorTone("in_progress", "locked"), "idle");
  });
});

describe("numbers", () => {
  test("overallPercent is clamped and rounded", () => {
    assert.equal(overallPercent({ lessons_completed: 16, lessons_total: 117 }), 14);
    assert.equal(overallPercent({ lessons_completed: 0, lessons_total: 0 }), 0);
    assert.equal(overallPercent({ lessons_completed: 200, lessons_total: 117 }), 100);
  });
  test("scoreTone thresholds", () => {
    assert.equal(scoreTone(null), "neutral");
    assert.equal(scoreTone(Number.NaN), "neutral");
    assert.equal(scoreTone(80), "up");
    assert.equal(scoreTone(75), "up");
    assert.equal(scoreTone(60), "warn");
    assert.equal(scoreTone(10), "down");
  });
  test("fmtXp", () => {
    assert.equal(fmtXp(1250), "1,250");
    assert.equal(fmtXp(0), "0");
  });
});
