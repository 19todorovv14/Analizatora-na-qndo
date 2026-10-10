"use client";

import { BookOpen, CircleCheck, CircleX, Medal, Play, RotateCcw, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import TradingChart, { type PriceLineDef } from "@/components/charts/TradingChart";
import { Badge, Button, Card, ErrorState, ErrorText, Meter, PageHeader, Skeleton, StatTile } from "@/components/ui";
import { api, errorMessage, fetcher, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { PALETTE } from "@/lib/theme";
import type { Candle } from "@/lib/types";
import { LearnHint } from "@/lib/workspace";

type Challenge = { key: string; title: string; kind: string; xp: number; target: number; description: string; lesson: string; progress: number; completed: boolean };
type Round = { index: number; candles: Candle[]; options?: string[]; token: string };
type Result = { correct: number; total: number; passed: boolean; xp_gained: number; results: { correct: boolean; expected: string | number; explanation: string }[] };

function Interactive({ ch, onDone }: { ch: Challenge; onDone: () => void }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<{ token: string; answer: string | number }[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setResult(null);
    setAnswers([]);
    setI(0);
    setPick(null);
    setError(null);
    setBusy(true);
    try {
      setRounds((await api<{ rounds: Round[] }>(`/challenges/${ch.key}/rounds`)).rounds);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (a: string | number) => {
    if (!rounds) return;
    const next = [...answers, { token: rounds[i].token, answer: a }];
    setAnswers(next);
    setPick(null);
    if (i + 1 < rounds.length) setI(i + 1);
    else {
      setBusy(true);
      try {
        const r = await post<Result>(`/challenges/${ch.key}/attempt`, { answers: next });
        setResult(r);
        onDone();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    }
  };

  if (!rounds)
    return (
      <>
        <ErrorText error={error} />
        <Button size="sm" onClick={start} disabled={busy}>
          <Play size={13} strokeWidth={2.25} aria-hidden /> Start
        </Button>
      </>
    );
  if (result)
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            {result.correct}/{result.total}
          </span>
          {result.passed ? <Badge tone="up">Passed +{result.xp_gained} XP</Badge> : <Badge tone="warn">Опитай пак</Badge>}
        </div>
        <ul className="space-y-1">
          {result.results.map((r, k) => (
            <li key={k} className="flex gap-1.5 text-[13px] leading-relaxed">
              {r.correct ? (
                <CircleCheck size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-up" aria-label="вярно" />
              ) : (
                <CircleX size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-warn" aria-label="грешно" />
              )}
              <span className="text-text/90">
                <span className="num text-muted">{k + 1}.</span> {r.explanation}
              </span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" onClick={start} disabled={busy}>
          <RotateCcw size={13} strokeWidth={2.25} aria-hidden /> Нов опит
        </Button>
      </div>
    );
  const round = rounds[i];
  const lines: PriceLineDef[] = pick !== null ? [{ id: "pick", price: pick, color: PALETTE.gold, title: "твоят избор", dashed: true }] : [];
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">
        Рунд {i + 1}/{rounds.length} · {ch.key === "identify_trend" ? "Какъв е трендът?" : "Кликни върху графиката там, където е support зоната, после потвърди."}
      </div>
      <TradingChart
        candles={round.candles}
        height={260}
        hideTimeAxis
        volume={false}
        fitKey={`${ch.key}-${i}`}
        priceLines={lines}
        onPriceClick={ch.key === "find_support" ? (p) => setPick(Number(p.toFixed(2))) : undefined}
      />
      {ch.key === "identify_trend" ? (
        <div className="flex flex-wrap gap-2">
          {(round.options ?? []).map((o) => (
            <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => answer(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : (
        <Button size="sm" disabled={pick === null || busy} onClick={() => pick !== null && answer(pick)}>
          Потвърди support на {pick ?? "—"}
        </Button>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { interactive: "Интерактивно", auto: "Автоматично" };

/** Where an automatically tracked challenge is practised. */
const WHERE: Record<string, { href: string; label: string }> = {
  trade_breakout: { href: "/trade", label: "Paper Trading" },
  risk_1pct: { href: "/trade", label: "Paper Trading" },
  no_overtrade: { href: "/trade", label: "Paper Trading" },
  twenty_with_stop: { href: "/trade", label: "Paper Trading" },
  journal_5: { href: "/journal", label: "Trading Journal" },
  first_backtest: { href: "/backtesting", label: "Backtesting" },
  safe_bot: { href: "/bots", label: "Bot Lab" },
};

export default function ChallengesPage() {
  const { data, error, mutate } = useSWR<{ challenges: Challenge[]; xp: number }>("/challenges", fetcher);
  const { refresh } = useSession();
  const done = data?.challenges.filter((c) => c.completed).length ?? 0;
  const total = data?.challenges.length ?? 0;
  const possible = data?.challenges.reduce((s, c) => s + c.xp, 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Trophy}
        title="Challenges"
        subtitle="Упражнения за умения — награждават процеса (стоп, малък риск, търпение), не печалбата или броя сделки."
      />

      {!data ? (
        error ? (
          <ErrorState title="Предизвикателствата не се заредиха" onRetry={() => void mutate()} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2" role="status" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-40 !rounded-xl" />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatTile label="Завършени" value={`${done}/${total}`} icon={Medal} tone="gold" />
            <StatTile label="XP от challenges" value={`${data.xp} XP`} sub={`от ${possible} възможни`} icon={Trophy} tone="accent" />
            <div className="card col-span-2 flex flex-col justify-center px-4 py-3.5 md:col-span-1">
              <Meter value={total ? (done / total) * 100 : 0} tone="up" label="Общ прогрес" showValue />
            </div>
          </div>
          <LearnHint>Интерактивните упражнения ползват исторически демо графики. Целта е да тренираш окото — няма прогнози и няма реални пари.</LearnHint>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.challenges.map((c) => (
              <Card
                key={c.key}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    {c.completed ? (
                      <Trophy size={15} strokeWidth={2} className="shrink-0 text-gold" aria-label="завършено" />
                    ) : (
                      <Target size={15} strokeWidth={2} className="shrink-0 text-accent2" aria-hidden />
                    )}
                    <span className="truncate">{c.title}</span>
                  </span>
                }
                right={
                  <span className="flex items-center gap-1.5">
                    <Badge tone="neutral">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                    <Badge tone={c.completed ? "up" : "accent"}>+{c.xp} XP</Badge>
                  </span>
                }
              >
                <p className="text-sm leading-relaxed text-muted">{c.description}</p>
                <div className="mt-3 flex items-center gap-3">
                  <Meter value={c.target ? (c.progress / c.target) * 100 : 0} tone={c.completed ? "up" : "accent"} className="flex-1" />
                  <span className="num shrink-0 text-xs text-muted">
                    {Math.min(c.progress, c.target)}/{c.target}
                  </span>
                </div>
                <div className="mt-3.5 space-y-2">
                  {c.kind === "interactive" && (
                    <Interactive
                      ch={c}
                      onDone={() => {
                        void mutate();
                        void refresh();
                      }}
                    />
                  )}
                  {c.kind !== "interactive" && !c.completed && WHERE[c.key] && (
                    <p className="text-xs text-muted">
                      Отчита се автоматично от твоите действия в{" "}
                      <Link href={WHERE[c.key].href} className="font-medium text-accent2 hover:text-text">
                        {WHERE[c.key].label}
                      </Link>
                      .
                    </p>
                  )}
                  {c.lesson && (
                    <Link href={`/learn/${c.lesson}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent2 transition-colors hover:text-text">
                      <BookOpen size={12} strokeWidth={2.25} aria-hidden /> Свързан урок
                    </Link>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
