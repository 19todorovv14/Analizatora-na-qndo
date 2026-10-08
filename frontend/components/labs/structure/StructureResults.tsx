"use client";

/*
 * Result of POST /learn/structure/check: score 0–100 with its parts (swings 60 % · structure 25 % · events
 * 15 %), the summary, the structure verdict, a CORRECT / INCORRECT / NOT A SWING card per label with the
 * concrete explanation ("Това е Lower High, защото върхът … е под предходния връх …") and the swings / events
 * the user did not mark.
 */
import { CircleCheck, CircleDashed, CircleX, Sparkles } from "lucide-react";

import { LABEL_META, STRUCTURE_META, VERDICT_META, scoreTone } from "@/components/labs/model";
import type { StructureCheck } from "@/components/labs/types";
import { Badge, Disclaimer, Meter, Notice, type MeterTone } from "@/components/ui";
import { cx, fmtPrice } from "@/lib/format";

const TONE_RING: Record<string, string> = {
  up: "bg-up/10 text-up ring-up/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  down: "bg-down/10 text-down ring-down/25",
  neutral: "bg-white/[0.05] text-text ring-white/10",
};

/** score part → meter colour (high is good here, unlike the risk meters' "auto" tone) */
const meterTone = (v: number): MeterTone => {
  const t = scoreTone(v);
  return t === "up" || t === "warn" || t === "down" ? t : "accent";
};

function when(ts: number, timeframe: string): string {
  const d = new Date(ts * 1000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (timeframe === "1d" || timeframe === "1w") return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function StructureResults({ check, precision, stale }: { check: StructureCheck; precision: number; stale?: boolean }) {
  const tone = scoreTone(check.score);
  const w = check.components.weights;
  const marks = [...check.marks].sort((a, b) => a.time - b.time);
  const st = check.structure;
  return (
    <div className={cx("space-y-4 transition-opacity", stale && "opacity-70")}>
      {stale && (
        <Notice tone="info" title="Маркировките са променени">
          Резултатът по-долу е за предишната проверка. Натисни „Провери“, за да оцениш новите етикети.
        </Notice>
      )}
      {check.note && <Notice tone="info">{check.note}</Notice>}

      <div className="card grid gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-5">
        <div className={cx("flex h-24 w-24 flex-col items-center justify-center rounded-2xl ring-1 ring-inset", TONE_RING[tone] ?? TONE_RING.neutral)}>
          <span className="num text-3xl font-semibold leading-none">{check.score}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em]">/ 100</span>
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-sm leading-relaxed text-text">{check.summary}</p>
          {check.ai_summary && (
            <p className="flex gap-1.5 text-xs leading-relaxed text-muted">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-violet" aria-hidden />
              <span>{check.ai_summary}</span>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Meter value={check.components.swings} max={100} tone={meterTone(check.components.swings)} label={`Swings · ${Math.round(w.swings * 100)}%`} showValue />
            <Meter value={check.components.structure} max={100} tone={meterTone(check.components.structure)} label={`Структура · ${Math.round(w.structure * 100)}%`} showValue />
            <Meter value={check.components.events} max={100} tone={meterTone(check.components.events)} label={`Събития · ${Math.round(w.events * 100)}%`} showValue />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              Верни swings: <span className="num text-text">{check.counts.correct_swings}</span> / {check.counts.reference_swings}
            </span>
            <span>
              Грешни swing етикети: <span className="num text-text">{check.counts.wrong_swing_marks}</span>
            </span>
            <span>
              Събития: <span className="num text-text">{check.counts.event_types_found.length}</span> / {check.counts.event_types_present.length} типа
            </span>
            <span>
              Проверка: <span className="text-text">{check.checker === "deterministic" ? "детерминистична (AI проверява по правилата)" : check.checker}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {st.correct ? <CircleCheck size={16} className="text-up" aria-hidden /> : <CircleX size={16} className="text-down" aria-hidden />}
          <h3 className="text-sm font-semibold text-text">Структура</h3>
          <span className="text-xs text-muted">твоят отговор:</span>
          {st.answer ? <Badge tone={STRUCTURE_META[st.answer]?.tone ?? "neutral"}>{STRUCTURE_META[st.answer]?.label ?? st.answer}</Badge> : <Badge>няма</Badge>}
          <span className="text-xs text-muted">правилен:</span>
          <Badge tone={STRUCTURE_META[st.expected]?.tone ?? "neutral"}>{STRUCTURE_META[st.expected]?.label ?? st.expected}</Badge>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{st.explanation}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card min-w-0 p-4" aria-label="Твоите етикети">
          <h3 className="mb-2 text-sm font-semibold text-text">
            Твоите етикети <span className="num font-normal text-muted">({marks.length})</span>
          </h3>
          {marks.length ? (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {marks.map((m, i) => {
                const v = VERDICT_META[m.verdict];
                return (
                  <li key={`${m.time}-${m.label}-${i}`} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={v.tone}>{v.label}</Badge>
                      <span className="text-xs font-semibold text-text">{LABEL_META[m.label]?.title ?? m.label}</span>
                      {m.verdict === "INCORRECT" && m.expected_label && <span className="text-xs text-muted">→ правилно: {m.expected_label}</span>}
                      <span className="num ml-auto text-[11px] text-faint">
                        {when(m.time, check.timeframe)} · {fmtPrice(m.price, precision)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{m.explanation}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Не си поставил етикети — всички swings са в „Пропуснати“.</p>
          )}
        </section>

        <section className="card min-w-0 p-4" aria-label="Пропуснати">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text">
            <CircleDashed size={15} className="text-muted" aria-hidden /> Пропуснати{" "}
            <span className="num font-normal text-muted">({check.missed.length + check.missed_events.length})</span>
          </h3>
          {check.missed.length + check.missed_events.length ? (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {check.missed.map((s, i) => (
                <li key={`s-${s.time}-${s.kind}-${i}`} className="rounded-lg border border-dashed border-white/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{s.label}</Badge>
                    <span className="text-xs text-muted">swing {s.kind === "high" ? "high" : "low"}</span>
                    <span className="num ml-auto text-[11px] text-faint">
                      {when(s.time, check.timeframe)} · {fmtPrice(s.price, precision)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{s.explanation}</p>
                </li>
              ))}
              {check.missed_events.map((e, i) => (
                <li key={`e-${e.time}-${e.type}-${i}`} className="rounded-lg border border-dashed border-white/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="info">{LABEL_META[e.type]?.title ?? e.type}</Badge>
                    <span className="text-xs text-muted">{e.direction === "up" ? "нагоре" : "надолу"}</span>
                    <span className="num ml-auto text-[11px] text-faint">
                      {when(e.time, check.timeframe)} · {fmtPrice(e.price, precision)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{e.explanation}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Нищо не е пропуснато.</p>
          )}
        </section>
      </div>
      <Disclaimer>{check.disclaimer}</Disclaimer>
    </div>
  );
}
