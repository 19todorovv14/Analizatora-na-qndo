"use client";

/*
 * Candlestick Lab PRACTICE: 10 HMAC-signed rounds (GET /learn/candlesticks/practice?n=10) — a synthetic pattern
 * in context, 4 options, optional per-round timer. The answers are graded only on submit (POST, the answer is
 * not in the payload), which stores a QuizResult "lab:candlesticks" for the learning dashboard; the result
 * shows the score and an explanation per round.
 */
import { CircleCheck, CircleX, Clock, RotateCcw, Send, SkipForward, Target, Timer, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MiniCandles } from "@/components/labs/MiniCandles";
import { BIAS_META, practiceBody } from "@/components/labs/model";
import type { PracticeResult, PracticeSet } from "@/components/labs/types";
import { Badge, Button, Disclaimer, ErrorText, Kbd, ProgressBar, Switch } from "@/components/ui";
import { api, errorMessage, post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { LearnHint } from "@/lib/workspace";

export const PRACTICE_ROUNDS = 10;
export const ROUND_SECONDS = 20;

type Play = {
  set: PracticeSet;
  i: number;
  answers: Record<number, string | null>;
  /** seconds left in the current round (null = no timer) */
  left: number | null;
};

/** Moves to the next round (the last round stays — the user submits). */
function advance(p: Play, timer: boolean): Play {
  const last = p.set.rounds.length - 1;
  if (p.i >= last) return { ...p, left: timer ? 0 : null };
  return { ...p, i: p.i + 1, left: timer ? ROUND_SECONDS : null };
}

export function PatternPractice() {
  const [timerOn, setTimerOn] = useState(false);
  const [play, setPlay] = useState<Play | null>(null);
  const [result, setResult] = useState<{ set: PracticeSet; answers: Record<number, string | null>; res: PracticeResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const set = await api<PracticeSet>(`/learn/candlesticks/practice?n=${PRACTICE_ROUNDS}`);
      setResult(null);
      setPlay({ set, i: 0, answers: {}, left: timerOn ? ROUND_SECONDS : null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!play) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<PracticeResult>("/learn/candlesticks/practice", practiceBody(play.set.rounds, play.answers));
      setResult({ set: play.set, answers: play.answers, res });
      setPlay(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = useCallback((key: string) => {
    // a round whose timer ran out is closed
    setPlay((p) => (p && p.left !== 0 ? { ...p, answers: { ...p.answers, [p.set.rounds[p.i].index]: key } } : p));
  }, []);

  // per-round countdown: when it runs out the round stays unanswered (or keeps the picked option) and moves on
  const ticking = !!play && play.left !== null && play.left > 0;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => {
      setPlay((p) => {
        if (!p || p.left === null || p.left <= 0) return p;
        return p.left > 1 ? { ...p, left: p.left - 1 } : advance(p, true);
      });
    }, 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const round = play ? play.set.rounds[play.i] : null;
  useHotkeys(
    Object.fromEntries([1, 2, 3, 4].map((n) => [String(n), () => round && round.options[n - 1] && choose(round.options[n - 1].key)])),
    { enabled: !!round && !busy },
  );

  /* ── result ───────────────────────────────────────────────── */
  if (result) {
    const { res, set } = result;
    const byIndex = new Map(set.rounds.map((r) => [r.index, r]));
    return (
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-5 p-5">
          <div
            className={cx(
              "flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ring-1 ring-inset",
              res.passed ? "bg-up/10 text-up ring-up/25" : "bg-warn/10 text-warn ring-warn/25",
            )}
          >
            <span className="num text-2xl font-semibold leading-none">{res.score_pct}%</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em]">score</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text">
                {res.correct} от {res.total} верни
              </h2>
              <Badge tone={res.passed ? "up" : "warn"}>{res.passed ? "Passed" : `Нужни са ${Math.round(res.pass_score * 100)}%`}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {res.stored
                ? "Резултатът е записан в learning dashboard (Candlestick Lab)."
                : "Резултатът не е записан (този set вече е предаден)."}{" "}
              Отговорени: <span className="num text-text">{res.answered}</span> / {res.total}.
            </p>
          </div>
          <Button type="button" onClick={start} disabled={busy}>
            <RotateCcw size={15} aria-hidden /> Нов set
          </Button>
        </div>
        <ErrorText error={error} />
        <ol className="grid gap-3 md:grid-cols-2" aria-label="Обяснения по рундове">
          {res.results.map((r, k) => {
            const rd = r.index !== null ? byIndex.get(r.index) : undefined;
            return (
              <li key={k} className={cx("card min-w-0 p-3.5", r.correct ? "border-up/25" : "border-down/20")}>
                <div className="flex gap-3">
                  <div className="w-28 shrink-0">
                    {rd && <MiniCandles candles={rd.candles} highlight={[]} markLast width={112} height={70} ariaLabel={`Рунд ${(r.index ?? 0) + 1}`} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.correct ? <CircleCheck size={15} className="text-up" aria-hidden /> : <CircleX size={15} className="text-down" aria-hidden />}
                      <span className="text-xs font-semibold text-text">Рунд {r.index !== null ? r.index + 1 : "—"}</span>
                      <Badge tone={r.correct ? "up" : "down"}>{r.correct ? "Вярно" : "Грешно"}</Badge>
                      {r.bias && <Badge tone={BIAS_META[r.bias].tone}>{BIAS_META[r.bias].label}</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Твоят отговор: <span className="text-text">{r.answer_name ?? (r.answer ? r.answer : "без отговор")}</span>
                      {r.expected_name && !r.correct && (
                        <>
                          {" "}
                          · Верен: <span className="text-up">{r.expected_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">{r.explanation}</p>
              </li>
            );
          })}
        </ol>
        <Disclaimer>{set.disclaimer}</Disclaimer>
      </div>
    );
  }

  /* ── idle ──────────────────────────────────────────────────── */
  if (!play || !round) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent2 ring-1 ring-inset ring-accent/25">
              <Target size={19} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text">Practice: разпознай модела</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {PRACTICE_ROUNDS} рунда. Всеки показва няколко свещи контекст и модел, който завършва на последната свещ (отбелязана с ▼). Избери един от 4
                отговора. Проверката е накрая — с обяснение за всеки рунд.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <Switch checked={timerOn} onChange={setTimerOn} label={`Таймер ${ROUND_SECONDS} s на рунд (по желание)`} />
            <Button type="button" onClick={start} disabled={busy}>
              <Target size={15} aria-hidden /> {busy ? "Зареждане…" : "Започни"}
            </Button>
          </div>
          <ErrorText error={error} />
        </div>
        <div className="space-y-3">
          <LearnHint title="Как да мислиш">
            Първо виж контекста (покачване или спад преди модела), после последните 1–3 свещи: размер на тялото спрямо диапазона, дълги сенки, дали
            тялото „поглъща“ предходното.
          </LearnHint>
          <div className="card p-4 text-sm text-muted">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-text">
              <Trophy size={15} className="text-gold" aria-hidden /> Резултат
            </div>
            Резултатът се записва в learning dashboard. Праг за „passed“: 70%. Клавиши <Kbd>1</Kbd>–<Kbd>4</Kbd> избират отговор.
          </div>
        </div>
      </div>
    );
  }

  /* ── playing ───────────────────────────────────────────────── */
  const n = play.set.rounds.length;
  const chosen = play.answers[round.index] ?? null;
  const isLast = play.i === n - 1;
  const answered = play.set.rounds.filter((r) => play.answers[r.index]).length;
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-sm font-semibold text-text">
          Рунд {play.i + 1} / {n}
        </span>
        <ProgressBar value={((play.i + (chosen ? 1 : 0)) / n) * 100} className="min-w-[120px] flex-1" />
        <span className="num text-xs text-muted">отговорени {answered}</span>
        {play.left !== null && (
          <span
            className={cx(
              "num inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
              play.left <= 5 ? "bg-down/10 text-down ring-down/25" : "bg-white/[0.05] text-text ring-white/10",
            )}
            aria-live="polite"
          >
            <Clock size={12} aria-hidden /> {play.left} s
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-text">{round.question}</p>
          <div className="glass-inset rounded-xl px-4 pb-3 pt-2">
            <MiniCandles candles={round.candles} highlight={[]} markLast width={420} height={210} ariaLabel={`Рунд ${play.i + 1}: ${round.candles.length} свещи`} />
          </div>
          <p className="mt-2 text-[11px] text-faint">▼ = последната свещ. Свещите са синтетични (за упражнение), не са пазарни данни.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          {round.options.map((o, k) => {
            const on = chosen === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => choose(o.key)}
                aria-pressed={on}
                className={cx(
                  "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  on ? "border-accent/50 bg-accent/15 text-text" : "border-white/10 bg-white/[0.03] text-text hover:border-white/20 hover:bg-white/[0.06]",
                )}
              >
                <Kbd>{k + 1}</Kbd>
                <span className="min-w-0 flex-1 font-medium">{o.name}</span>
                {on && <CircleCheck size={15} className="shrink-0 text-accent2" aria-hidden />}
              </button>
            );
          })}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
            {!isLast ? (
              <>
                <Button size="sm" variant="ghost" type="button" onClick={() => setPlay((p) => (p ? advance(p, timerOn) : p))}>
                  <SkipForward size={14} aria-hidden /> {chosen ? "Следващ" : "Пропусни"}
                </Button>
                <Button size="sm" type="button" disabled={!chosen} onClick={() => setPlay((p) => (p ? advance(p, timerOn) : p))}>
                  Напред
                </Button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted">{play.left === 0 ? "Времето изтече." : "Последен рунд."}</span>
                <Button size="sm" type="button" onClick={submit} disabled={busy}>
                  <Send size={14} aria-hidden /> {busy ? "Проверка…" : `Предай (${answered}/${n})`}
                </Button>
              </>
            )}
          </div>
          {play.left !== null && (
            <p className="flex items-center gap-1 text-[11px] text-faint">
              <Timer size={12} aria-hidden /> Без отговор при изтичане рундът се брои за грешен.
            </p>
          )}
        </div>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
