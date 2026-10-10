"use client";

/*
 * AI review of one journal entry (POST /api/journal/{id}/ai-review → entry.ai_review). A linked, closed
 * paper trade gets a TRADE REVIEW (what happened, entry / exit, risk); any other entry gets a JOURNAL
 * REVIEW of the written plan. Process feedback only — never a prediction or a buy/sell instruction.
 */
import { BookOpen, CircleCheck, CircleHelp, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { gradeTone, type JournalAiReview, type JournalEntry } from "@/components/journal/model";
import { Badge, Button, Disclaimer, ErrorText, Meter, Spinner } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { cx, fmtMoney, fmtR, fmtTime } from "@/lib/format";

const GRADE_CLS = {
  up: "bg-up/12 text-up ring-up/30",
  info: "bg-info/12 text-info ring-info/30",
  warn: "bg-warn/12 text-warn ring-warn/30",
  down: "bg-down/12 text-down ring-down/30",
  neutral: "bg-white/[0.05] text-muted ring-white/10",
} as const;

function List({ title, items, icon: Icon, ink }: { title: string; items: string[]; icon: typeof CircleCheck; ink: string }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className={cx("mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]", ink)}>{title}</h4>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s} className="flex gap-1.5 text-[13px] leading-relaxed text-text/85">
            <Icon size={13} strokeWidth={2.25} className={cx("mt-1 shrink-0", ink)} aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiReviewView({ review }: { review: JournalAiReview }) {
  const tone = gradeTone(review.grade);
  const happened = Array.isArray(review.what_happened) ? review.what_happened : review.what_happened ? [review.what_happened] : [];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        {review.grade && (
          <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold ring-1 ring-inset", GRADE_CLS[tone])} aria-label={`Оценка ${review.grade}`}>
            {review.grade}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-violet">{review.title}</span>
            {review.provider && <Badge tone="neutral">{review.provider}</Badge>}
            {review.generated_ts && <span className="num text-[11px] text-faint">{fmtTime(review.generated_ts)}</span>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-text">{review.summary}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">Process score</div>
          <div className="num text-sm font-semibold">{review.process_score ?? "—"}/100</div>
          <Meter value={review.process_score ?? 0} tone={tone === "up" ? "up" : tone === "down" ? "down" : tone === "warn" ? "warn" : "info"} className="mt-1" />
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">Planned R:R</div>
          <div className="num text-sm font-semibold">{review.planned_rr ? `1 : ${review.planned_rr.toFixed(2)}` : "—"}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">Result</div>
          <div className="num text-sm font-semibold">{fmtR(review.r_multiple ?? review.linked?.r_multiple)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">Stop</div>
          <div className={cx("text-sm font-semibold", review.stop_valid === false ? "text-down" : review.stop_valid ? "text-up" : "text-muted")}>
            {review.stop_valid === null || review.stop_valid === undefined ? "—" : review.stop_valid ? "валиден" : "невалиден"}
          </div>
        </div>
      </div>
      {review.main_lesson && review.main_lesson !== review.summary && (
        <p className="rounded-lg border border-accent/20 bg-accent/[0.06] px-3 py-2 text-[13px] leading-relaxed text-text/90">
          <span className="font-semibold text-accent2">Главен урок: </span>
          {review.main_lesson}
        </p>
      )}
      {happened.length > 0 && (
        <ul className="space-y-0.5 text-[13px] leading-relaxed text-muted">
          {happened.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <List title="Добре" items={review.did_well ?? []} icon={CircleCheck} ink="text-up" />
        <List title="За подобрение" items={review.did_poorly ?? []} icon={TriangleAlert} ink="text-warn" />
      </div>
      <List title="Въпроси към себе си" items={review.questions ?? []} icon={CircleHelp} ink="text-info" />
      {review.lesson_refs?.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {review.lesson_refs.map((l) => (
            <Link key={l.slug} href={l.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent2 hover:text-text">
              <BookOpen size={12} strokeWidth={2.25} aria-hidden /> {l.title}
            </Link>
          ))}
        </div>
      )}
      {review.linked && (
        <p className="text-[11px] text-faint">
          Свързана сделка {review.linked.symbol} {review.linked.side} · {review.linked.result !== null ? fmtMoney(review.linked.result, true) : "—"}
          {review.linked.closed ? "" : " · още отворена"}
        </p>
      )}
      {review.note && <p className="text-[11px] text-faint">{review.note}</p>}
      {review.disclaimer && <Disclaimer>{review.disclaimer}</Disclaimer>}
    </div>
  );
}

/** Generate / show / refresh the AI review of an entry. `onUpdated` receives the entry with ai_review. */
export function AiReviewPanel({ entry, onUpdated }: { entry: JournalEntry; onUpdated?: (e: JournalEntry) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!entry.id) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated?.(await post<JournalEntry>(`/journal/${entry.id}/ai-review`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-violet/20 bg-violet/[0.04] p-3.5">
      {entry.ai_review ? (
        <>
          <AiReviewView review={entry.ai_review} />
          <Button size="sm" variant="ghost" className="mt-2" onClick={run} disabled={busy}>
            {busy ? <Spinner className="!h-3 !w-3" /> : <RefreshCw size={12} strokeWidth={2.25} aria-hidden />} Обнови AI review
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
            AI ще прегледа процеса: причина за входа, stop, R:R, емоции и грешки — и ще предложи урок. Без прогнози за цената.
          </p>
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? <Spinner className="!h-3 !w-3 border-white/30 border-t-white" /> : <Sparkles size={13} strokeWidth={2.25} aria-hidden />} Генерирай AI review
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
