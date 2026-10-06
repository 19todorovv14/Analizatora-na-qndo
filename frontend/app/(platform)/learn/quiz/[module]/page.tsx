"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { Badge, Button, Card, ErrorText, Loading } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";

type Quiz = { module: string; title: string; questions: { id: string; question: string; options: string[] }[]; pass_score: number };
type Result = {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
  xp_gained: number;
  unlocked_module: string | null;
  results: { id: string; question: string; your_answer: number | null; correct_answer: number; options: string[]; correct: boolean; explanation: string }[];
};

export default function QuizPage() {
  const { module } = useParams<{ module: string }>();
  const { data } = useSWR<Quiz>(`/academy/quiz/${module}`, fetcher);
  const { refresh } = useSession();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Loading />;

  const submit = async () => {
    try {
      setResult(await post<Result>(`/academy/quiz/${module}`, { answers }));
      refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/learn" className="text-xs text-muted hover:text-text">
          ← Academy
        </Link>
        <h1 className="text-xl font-bold">Quiz: {data.title}</h1>
        <p className="text-sm text-muted">Нужни са {Math.round(data.pass_score * 100)}% за отключване на следващия модул.</p>
      </div>

      {result && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span className={cx("text-3xl font-bold", result.passed ? "text-up" : "text-warn")}>{Math.round(result.score * 100)}%</span>
            <span className="text-sm text-muted">
              {result.correct}/{result.total} верни
            </span>
            {result.passed ? <Badge tone="up">Passed</Badge> : <Badge tone="warn">Опитай пак</Badge>}
            {result.xp_gained > 0 && <span className="text-sm text-gold">+{result.xp_gained} XP</span>}
            {result.unlocked_module && (
              <Link href="/learn" className="ml-auto">
                <Button size="sm">Отключен е следващият модул →</Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {data.questions.map((q, i) => {
        const r = result?.results.find((x) => x.id === q.id);
        return (
          <Card key={q.id}>
            <p className="mb-2 font-medium">
              {i + 1}. {q.question}
            </p>
            <div className="space-y-1.5">
              {q.options.map((o, j) => {
                const chosen = answers[q.id] === j;
                const isCorrect = r && r.correct_answer === j;
                const isWrongChoice = r && chosen && !r.correct;
                return (
                  <label
                    key={j}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                      isCorrect ? "border-up bg-up/10" : isWrongChoice ? "border-down bg-down/10" : chosen ? "border-accent bg-accent/10" : "border-line hover:bg-panel2",
                    )}
                  >
                    <input type="radio" name={q.id} checked={chosen} disabled={!!result} onChange={() => setAnswers({ ...answers, [q.id]: j })} />
                    {o}
                  </label>
                );
              })}
            </div>
            {r && (
              <p className={cx("mt-2 text-sm", r.correct ? "text-up" : "text-warn")}>
                {r.correct ? "✓ Вярно. " : "✗ Корекция: "}
                <span className="text-text/90">{r.explanation}</span>
              </p>
            )}
          </Card>
        );
      })}
      <ErrorText error={error} />
      {!result ? (
        <Button onClick={submit} disabled={Object.keys(answers).length < data.questions.length}>
          Предай ({Object.keys(answers).length}/{data.questions.length})
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setResult(null);
            setAnswers({});
          }}
        >
          Опитай отново
        </Button>
      )}
    </div>
  );
}
