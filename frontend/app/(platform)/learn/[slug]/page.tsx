"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { LessonVisual, type Visual } from "@/components/academy/visuals";
import { Badge, Button, Card, ErrorText, Loading, RichText } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { useSession } from "@/lib/session";

type Lesson = {
  slug: string;
  title: string;
  summary: string;
  body: string[];
  sections: { heading: string; body: string[] }[];
  key_points: string[];
  common_mistakes: string[];
  visual: Visual | null;
  xp: number;
  module: string;
  module_title: string;
  completed: boolean;
  module_unlocked: boolean;
  prev: string | null;
  next: string | null;
  index: number;
  count: number;
};

export default function LessonPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, mutate } = useSWR<Lesson>(`/academy/lessons/${slug}`, fetcher);
  const { refresh } = useSession();
  const [gained, setGained] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (error) return <ErrorText error={errorMessage(error)} />;
  if (!data) return <Loading />;

  const complete = async () => {
    try {
      const r = await post<{ xp_gained: number }>(`/academy/lessons/${slug}/complete`);
      setGained(r.xp_gained);
      mutate();
      refresh();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="text-xs text-muted">
        <Link href="/learn" className="hover:text-text">
          Academy
        </Link>{" "}
        / {data.module_title} / урок {data.index} от {data.count}
      </div>
      <div>
        <h1 className="text-2xl font-bold">{data.title}</h1>
        <p className="mt-1 text-muted">{data.summary}</p>
        <div className="mt-2 flex gap-2">
          <Badge tone="accent">+{data.xp} XP</Badge>
          {data.completed && <Badge tone="up">завършен</Badge>}
          {!data.module_unlocked && <Badge tone="warn">модулът още е заключен</Badge>}
        </div>
      </div>

      {data.visual && (
        <Card title="Интерактивен пример">
          <LessonVisual visual={data.visual} />
        </Card>
      )}

      <Card>
        <RichText paragraphs={data.body} />
        {data.sections.map((s) => (
          <div key={s.heading} className="mt-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-accent2">{s.heading}</h3>
            <RichText paragraphs={s.body} />
          </div>
        ))}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Key points">
          <ul className="space-y-1.5 text-sm">
            {data.key_points.map((k) => (
              <li key={k}>✓ {k}</li>
            ))}
          </ul>
        </Card>
        {data.common_mistakes.length > 0 && (
          <Card title="Common mistakes">
            <ul className="space-y-1.5 text-sm">
              {data.common_mistakes.map((k) => (
                <li key={k} className="text-text/90">
                  ✗ {k}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <ErrorText error={err} />
      <div className="flex flex-wrap items-center gap-2">
        {data.prev && (
          <Link href={`/learn/${data.prev}`}>
            <Button variant="outline">← Предишен</Button>
          </Link>
        )}
        <Button onClick={complete} variant={data.completed ? "outline" : "primary"}>
          {data.completed ? "Завършен ✓" : "Маркирай като завършен"}
        </Button>
        {gained !== null && gained > 0 && <span className="text-sm text-gold">+{gained} XP!</span>}
        <Link href={`/ai?q=${encodeURIComponent(`Обясни ми: ${data.title}`)}`}>
          <Button variant="ghost">🤖 Питай AI Teacher</Button>
        </Link>
        <span className="ml-auto" />
        {data.next ? (
          <Link href={`/learn/${data.next}`}>
            <Button>Следващ урок →</Button>
          </Link>
        ) : (
          <Link href={`/learn/quiz/${data.module}`}>
            <Button>Към quiz-а →</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
