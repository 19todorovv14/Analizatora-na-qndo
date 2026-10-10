"use client";

/*
 * Journal entries as a dense table: Date · Instrument · Strategy · Entry · Exit · Stop · Target · Risk ·
 * Result · R · Screenshot · AI review. A row expands to the reason, notes, lesson, emotion, mistakes,
 * tags and the AI review panel. Wide → scrolls sideways inside its card on small screens.
 */
import { ChevronDown, ImageIcon, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";

import { AiReviewPanel } from "@/components/journal/AiReviewPanel";
import { gradeTone, plannedRR, strategyOf, type JournalEntry } from "@/components/journal/model";
import { Badge, IconButton } from "@/components/ui";
import { cx, fmtDate, fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/format";

const GRADE_INK = { up: "text-up", info: "text-info", warn: "text-warn", down: "text-down", neutral: "text-muted" } as const;

function px(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function Thumb({ src, onOpen }: { src: string | null | boolean | undefined; onOpen: (s: string) => void }) {
  if (typeof src !== "string" || !src) return <span className="text-faint">—</span>;
  return (
    <button type="button" onClick={() => onOpen(src)} className="block overflow-hidden rounded-md ring-1 ring-white/10 transition hover:ring-accent/50" aria-label="Отвори screenshot">
      {/* eslint-disable-next-line @next/next/no-img-element -- user-provided data URL */}
      <img src={src} alt="" className="h-7 w-11 object-cover" />
    </button>
  );
}

function Details({ e, onUpdated, onOpenShot }: { e: JournalEntry; onUpdated: (e: JournalEntry) => void; onOpenShot: (s: string) => void }) {
  const rr = plannedRR(e);
  return (
    <div className="grid gap-4 px-3 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-2.5 text-[13px] leading-relaxed">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Reason</div>
          <p className="whitespace-pre-line text-text/90">{e.reason || <span className="text-faint">—</span>}</p>
        </div>
        {e.notes && (
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Notes</div>
            <p className="whitespace-pre-line text-text/85">{e.notes}</p>
          </div>
        )}
        {e.lesson && (
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent2">Lesson</div>
            <p className="whitespace-pre-line text-text/85">{e.lesson}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {e.emotion && <Badge>{e.emotion}</Badge>}
          {e.confidence ? <span className="num">confidence {e.confidence}/5</span> : null}
          {rr !== null && <span className="num">· planned R:R 1:{rr.toFixed(2)}</span>}
          {e.timeframe && <span className="num">· {e.timeframe}</span>}
        </div>
        {((e.mistakes?.length ?? 0) > 0 || (e.tags?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1">
            {(e.mistakes ?? []).map((m) => (
              <Badge key={m} tone="down">
                {m}
              </Badge>
            ))}
            {(e.tags ?? []).map((t) => (
              <Badge key={t}>#{t}</Badge>
            ))}
          </div>
        )}
        {typeof e.screenshot === "string" && e.screenshot && (
          <button type="button" onClick={() => onOpenShot(e.screenshot as string)} className="block overflow-hidden rounded-lg ring-1 ring-white/10 hover:ring-accent/50">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-provided data URL */}
            <img src={e.screenshot} alt="Screenshot на сделката" className="max-h-40 w-auto" />
          </button>
        )}
      </div>
      <AiReviewPanel entry={e} onUpdated={onUpdated} />
    </div>
  );
}

export function JournalTable({
  entries,
  onEdit,
  onDelete,
  onUpdated,
  onOpenShot,
}: {
  entries: JournalEntry[];
  onEdit: (e: JournalEntry) => void;
  onDelete: (e: JournalEntry) => void;
  onUpdated: (e: JournalEntry) => void;
  onOpenShot: (src: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = (id?: number) => setOpen((o) => (o === id ? null : (id ?? null)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[54rem] text-[13px] [&_td]:px-2 [&_th]:px-2">
        <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-faint">
          <tr className="border-b border-white/[0.06]">
            <th className="w-9 py-2 !pl-3" aria-label="Детайли" />
            <th className="py-2 font-medium">Дата</th>
            <th className="py-2 font-medium">Инструмент</th>
            <th className="py-2 font-medium">Strategy</th>
            <th className="py-2 text-right font-medium">Entry → Exit</th>
            <th className="py-2 text-right font-medium">Stop / Target</th>
            <th className="py-2 text-right font-medium">Risk</th>
            <th className="py-2 text-right font-medium">Result</th>
            <th className="py-2 text-right font-medium">R</th>
            <th className="py-2 font-medium">Shot</th>
            <th className="py-2 font-medium">AI review</th>
            <th className="py-2 !pr-3 text-right font-medium" aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const isOpen = open === e.id;
            const grade = e.ai_review?.grade;
            return (
              <Fragment key={e.id}>
                <tr className={cx("border-b border-white/[0.05] transition-colors hover:bg-white/[0.025]", isOpen && "bg-white/[0.03]")}>
                  <td className="py-2 !pl-3">
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? "Скрий детайлите" : "Покажи детайлите"}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-white/[0.06] hover:text-text"
                    >
                      <ChevronDown size={14} strokeWidth={2.25} className={cx("transition-transform", isOpen && "rotate-180")} aria-hidden />
                    </button>
                  </td>
                  <td className="num whitespace-nowrap py-2 text-muted">{fmtDate(e.created_ts)}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-semibold">{e.symbol || "—"}</span>
                      {e.side && <Badge tone={e.side === "long" ? "up" : "down"}>{e.side}</Badge>}
                    </span>
                  </td>
                  <td className="max-w-[10rem] truncate py-2 text-muted" title={strategyOf(e)}>
                    {strategyOf(e) || "—"}
                  </td>
                  <td className="num whitespace-nowrap py-2 text-right">
                    {px(e.entry)} <span className="text-faint">→</span> {px(e.exit_price)}
                  </td>
                  <td className="num whitespace-nowrap py-2 text-right">
                    <span className="text-down/90">{px(e.stop)}</span> <span className="text-faint">/</span> <span className="text-up/90">{px(e.target)}</span>
                  </td>
                  <td className="num py-2 text-right text-muted">{e.risk_amount ? `$${fmtNum(e.risk_amount)}` : "—"}</td>
                  <td className={cx("num py-2 text-right font-semibold", pnlClass(e.result))}>{fmtMoney(e.result, true)}</td>
                  <td className={cx("num py-2 text-right", pnlClass(e.r_multiple))}>{fmtR(e.r_multiple)}</td>
                  <td className="py-1.5">
                    <Thumb src={e.screenshot} onOpen={onOpenShot} />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(e.id ?? null)}
                      className={cx(
                        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
                        grade ? cx("ring-white/10 hover:bg-white/[0.05]", GRADE_INK[gradeTone(grade)]) : "text-violet ring-violet/25 hover:bg-violet/10",
                      )}
                    >
                      <Sparkles size={11} strokeWidth={2.25} aria-hidden />
                      {grade ? `Grade ${grade}` : "AI review"}
                    </button>
                  </td>
                  <td className="py-2 !pr-3">
                    <span className="flex justify-end gap-0.5">
                      <IconButton icon={Pencil} label="Редактирай" size="sm" onClick={() => onEdit(e)} />
                      <IconButton icon={Trash2} label="Изтрий" size="sm" onClick={() => onDelete(e)} />
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                    <td colSpan={12} className="!px-0">
                      <Details e={e} onUpdated={onUpdated} onOpenShot={onOpenShot} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {entries.some((e) => e.screenshot === true) && (
        <p className="flex items-center gap-1 px-3 py-2 text-[11px] text-faint">
          <ImageIcon size={11} aria-hidden /> Някои screenshots се зареждат при отваряне.
        </p>
      )}
    </div>
  );
}
