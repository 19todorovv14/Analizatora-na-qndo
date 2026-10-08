"use client";

import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { modeIcon } from "@/components/ai/icons";
import { isTeacherMode, storedAnswer, tfLabel, type StoredMessage } from "@/components/ai/model";
import { TeacherAnswer } from "@/components/ai/TeacherAnswer";
import type { FollowUp, TeacherSessionRow } from "@/components/ai/types";
import { AiText, Badge, Button, EmptyState, ErrorText, Modal, Popover, SkeletonText } from "@/components/ui";
import { errorMessage, fetcher } from "@/lib/api";
import { cx, fmtTime } from "@/lib/format";

type SessionDetail = { id: number; title: string; messages: StoredMessage[] };

/**
 * Recent teacher answers (GET /teacher/sessions). Opening one shows the stored answer
 * (GET /ai/sessions/{id}): as section cards when the message carries `data.answer`, else as text.
 * "Повтори" re-runs that mode on fresh data via `onRepeat`; follow-ups of a stored answer go to `onFollowUp`.
 */
export function TeacherHistory({
  onRepeat,
  onFollowUp,
}: {
  onRepeat: (row: TeacherSessionRow) => void;
  onFollowUp?: (f: FollowUp) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<TeacherSessionRow | null>(null);
  const { data, error, isLoading } = useSWR<{ sessions: TeacherSessionRow[] }>(open ? "/teacher/sessions" : null, fetcher, { revalidateOnFocus: false });
  const detail = useSWR<SessionDetail>(picked ? `/ai/sessions/${picked.id}` : null, fetcher, { revalidateOnFocus: false });
  const rows = data?.sessions ?? [];
  const stored = storedAnswer(detail.data?.messages);

  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        align="end"
        ariaLabel="Последни отговори на учителя"
        className="w-[min(360px,92vw)] p-1.5"
        trigger={
          <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <History size={14} aria-hidden /> История
          </Button>
        }
      >
        <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Последни отговори</div>
        {error ? (
          <div className="p-2">
            <ErrorText error={errorMessage(error)} />
          </div>
        ) : isLoading && !data ? (
          <div className="p-2">
            <SkeletonText lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={History} title="Още няма отговори" description="Избери режим и попитай учителя." />
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto">
            {rows.map((r) => {
              const Icon = modeIcon(r.mode ?? "analyze");
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(r);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-accent2 ring-1 ring-inset ring-white/10">
                      <Icon size={13} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-text">{r.title}</span>
                      <span className="block text-[11px] text-faint">{fmtTime(r.created_ts)}</span>
                    </span>
                    {r.provider && r.provider !== "offline" && <Badge tone="violet">AI</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Popover>

      <Modal open={!!picked} onClose={() => setPicked(null)} title={picked?.title ?? "Отговор"} wide>
        {detail.error ? (
          <ErrorText error={errorMessage(detail.error)} />
        ) : !detail.data ? (
          <SkeletonText lines={8} />
        ) : (
          <div className="space-y-4">
            <div className={cx("rounded-xl border border-white/[0.07] bg-black/20", stored.answer ? "p-3 sm:p-4" : "p-4")}>
              {stored.answer ? (
                <TeacherAnswer
                  answer={stored.answer}
                  onFollowUp={
                    onFollowUp
                      ? (f) => {
                          setPicked(null);
                          onFollowUp(f);
                        }
                      : undefined
                  }
                />
              ) : stored.text ? (
                <AiText text={stored.text} />
              ) : (
                <p className="text-sm text-muted">Няма записан текст.</p>
              )}
            </div>
            {picked && isTeacherMode(picked.mode) && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  Записан отговор от {fmtTime(picked.created_ts)}
                  {picked.context.symbol ? ` · ${picked.context.symbol} ${tfLabel(picked.context.timeframe)}` : ""} — данните оттогава може да са други.
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    onRepeat(picked);
                    setPicked(null);
                  }}
                >
                  <RotateCcw size={13} aria-hidden /> Повтори с текущите данни
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
