"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import TradingChart, { type PriceLineDef } from "@/components/charts/TradingChart";
import { Badge, Button, Card, ErrorText, Loading, ProgressBar } from "@/components/ui";
import { api, errorMessage, fetcher, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Candle } from "@/lib/types";

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

  const start = async () => {
    setResult(null);
    setAnswers([]);
    setI(0);
    setPick(null);
    try {
      setRounds((await api<{ rounds: Round[] }>(`/challenges/${ch.key}/rounds`)).rounds);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const answer = async (a: string | number) => {
    if (!rounds) return;
    const next = [...answers, { token: rounds[i].token, answer: a }];
    setAnswers(next);
    setPick(null);
    if (i + 1 < rounds.length) setI(i + 1);
    else {
      const r = await post<Result>(`/challenges/${ch.key}/attempt`, { answers: next });
      setResult(r);
      onDone();
    }
  };

  if (!rounds)
    return (
      <>
        <ErrorText error={error} />
        <Button size="sm" onClick={start}>
          Start
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
        {result.results.map((r, k) => (
          <p key={k} className={r.correct ? "text-up" : "text-warn"}>
            {k + 1}. {r.correct ? "✓" : "✗"} <span className="text-text/90">{r.explanation}</span>
          </p>
        ))}
        <Button size="sm" variant="outline" onClick={start}>
          Нов опит
        </Button>
      </div>
    );
  const round = rounds[i];
  const lines: PriceLineDef[] = pick !== null ? [{ id: "pick", price: pick, color: "#f5c542", title: "твоят избор", dashed: true }] : [];
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
        <div className="flex gap-2">
          {(round.options ?? []).map((o) => (
            <Button key={o} size="sm" variant="outline" onClick={() => answer(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : (
        <Button size="sm" disabled={pick === null} onClick={() => pick !== null && answer(pick)}>
          Потвърди support на {pick ?? "—"}
        </Button>
      )}
    </div>
  );
}

export default function ChallengesPage() {
  const { data, mutate } = useSWR<{ challenges: Challenge[]; xp: number }>("/challenges", fetcher);
  const { refresh } = useSession();
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Challenges</h1>
        <p className="text-sm text-muted">Упражнения за умения — награждават процеса (стоп, малък риск, търпение), не печалбата или броя сделки.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.challenges.map((c) => (
          <Card
            key={c.key}
            title={
              <span className="flex items-center gap-2">
                {c.completed ? "🏆" : "🎯"} {c.title}
              </span>
            }
            right={<Badge tone={c.completed ? "up" : "accent"}>+{c.xp} XP</Badge>}
          >
            <p className="text-sm text-muted">{c.description}</p>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={(c.progress / c.target) * 100} tone={c.completed ? "up" : "accent"} />
              <span className="num shrink-0 text-xs text-muted">
                {c.progress}/{c.target}
              </span>
            </div>
            <div className="mt-3">
              {c.kind === "interactive" ? (
                <Interactive
                  ch={c}
                  onDone={() => {
                    mutate();
                    refresh();
                  }}
                />
              ) : (
                <Link href={`/learn/${c.lesson}`} className="text-xs text-accent2">
                  Свързан урок →
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
