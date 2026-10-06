"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Badge, Button, Card, Loading, ProgressBar } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

type ModuleDetail = {
  key: string;
  title: string;
  category: string;
  description: string;
  lessons_total: number;
  lessons_completed: number;
  percent: number;
  quiz_score: number | null;
  quiz_passed: boolean;
  unlocked: boolean;
  quiz_questions: number;
  lessons: { slug: string; title: string; summary: string; xp: number; completed: boolean; visual: string | null }[];
};

type Progress = { xp: number; level: number; lessons_completed: number; lessons_total: number; categories: { category: string; percent: number }[] };

export default function LearnPage() {
  const { data } = useSWR<{ modules: ModuleDetail[] }>("/academy/modules", fetcher);
  const { data: prog } = useSWR<Progress>("/academy/progress", fetcher);
  const [open, setOpen] = useState<string | null>(null);
  if (!data || !prog) return <Loading />;
  const current = open ?? data.modules.find((m) => m.unlocked && m.percent < 100)?.key ?? data.modules[0].key;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-bold">Trading Academy</h1>
          <p className="text-sm text-muted">
            Започни от Level 0. Следващият модул се отключва след quiz с поне 70%. Знаеш материала? Направи quiz-а директно.
          </p>
        </div>
        {data.modules.map((m, idx) => {
          const expanded = current === m.key;
          return (
            <section key={m.key} className={cx("card", !m.unlocked && "opacity-60")}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(expanded ? "__none" : m.key)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel3 text-sm font-bold">
                  {m.unlocked ? (m.percent === 100 ? "✓" : idx) : "🔒"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{m.title}</span>
                    <Badge>{m.category}</Badge>
                    {m.quiz_passed && <Badge tone="up">quiz {Math.round((m.quiz_score ?? 0) * 100)}%</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">{m.description}</span>
                </span>
                <span className="hidden w-32 sm:block">
                  <ProgressBar value={m.percent} tone={m.percent === 100 ? "up" : "accent"} />
                  <span className="num text-[11px] text-muted">
                    {m.lessons_completed}/{m.lessons_total} уроци · {m.percent}%
                  </span>
                </span>
              </button>
              {expanded && (
                <div className="border-t border-line px-4 py-3">
                  {!m.unlocked && (
                    <p className="mb-2 text-xs text-warn">
                      Модулът е заключен — завърши quiz-а на предишния модул. Можеш да разглеждаш уроците, но прогресът се отключва
                      последователно.
                    </p>
                  )}
                  <ol className="grid gap-1.5 sm:grid-cols-2">
                    {m.lessons.map((l, i) => (
                      <li key={l.slug}>
                        <Link
                          href={`/learn/${l.slug}`}
                          className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-line hover:bg-panel2"
                        >
                          <span className={cx("mt-0.5 text-xs", l.completed ? "text-up" : "text-faint")}>{l.completed ? "●" : "○"}</span>
                          <span>
                            <span className="text-sm">
                              {i + 1}. {l.title}
                            </span>
                            <span className="block text-[11px] text-muted">{l.summary}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 flex items-center gap-2">
                    <Link href={`/learn/quiz/${m.key}`}>
                      <Button size="sm" variant={m.quiz_passed ? "outline" : "primary"}>
                        {m.quiz_passed ? "Повтори quiz" : `Quiz (${m.quiz_questions} въпроса)`}
                      </Button>
                    </Link>
                    <span className="text-xs text-muted">+50 XP при успешен quiz</span>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="space-y-3">
        <Card title="Твоят прогрес">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gold">{prog.xp} XP</span>
            <span className="text-sm text-muted">Level {prog.level}</span>
          </div>
          <div className="space-y-2">
            {prog.categories.map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-xs">
                  <span>{c.category}</span>
                  <span className="num text-muted">{c.percent}%</span>
                </div>
                <ProgressBar value={c.percent} tone={c.percent === 100 ? "up" : "accent"} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {prog.lessons_completed}/{prog.lessons_total} урока завършени
          </p>
        </Card>
        <Card title="Как да учиш ефективно">
          <ul className="space-y-1.5 text-xs text-muted">
            <li>1. Прочети урока и разгледай интерактивната визуализация.</li>
            <li>2. Отвори Charts и намери същото на живата (demo) графика.</li>
            <li>3. Попитай AI Teacher, ако нещо не е ясно.</li>
            <li>4. Направи quiz — грешките идват с обяснения.</li>
            <li>5. Упражни в Market Replay или Paper Trading.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
