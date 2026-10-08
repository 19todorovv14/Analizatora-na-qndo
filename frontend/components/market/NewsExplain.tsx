"use client";

import { CircleHelp, ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { ExplainPayload } from "@/components/market/types";
import { Badge, Button, Disclaimer, ErrorState, Modal, RichText, SkeletonText } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { cx } from "@/lib/format";

/** Body text of a section: "- " lines become bullets, other lines paragraphs. */
export function explainParagraphs(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

/** The explanation sections (pure render; exported for tests and reuse). */
export function ExplainSections({ data }: { data: ExplainPayload }) {
  return (
    <div className="space-y-4">
      {data.event_label && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{data.event_label}</Badge>
          <Badge tone="neutral">{data.provider === "offline" ? "offline template" : data.provider}</Badge>
        </div>
      )}
      {data.sections.map((s) => (
        <section key={s.key} data-section={s.key}>
          <h3 className={cx("text-[11px] font-semibold uppercase tracking-[0.08em]", s.key === "no_direction" ? "text-warn" : "text-accent2")}>{s.title}</h3>
          <RichText paragraphs={explainParagraphs(s.body)} className="mt-1 text-sm [&_p]:my-1.5 [&_p]:leading-relaxed" />
        </section>
      ))}
      <Disclaimer>{data.disclaimer}</Disclaimer>
    </div>
  );
}

export type EventExplainButtonProps = {
  headline: string;
  summary?: string | null;
  symbol?: string | null;
  className?: string;
  size?: "sm" | "md";
};

/**
 * "What does this event mean?" — educational explanation of a news item / calendar event
 * (POST /api/markets/news/explain) in a modal. Never a price prediction.
 */
export function EventExplainButton({ headline, summary, symbol, className, size = "sm" }: EventExplainButtonProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ExplainPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await post<ExplainPayload>("/markets/news/explain", { headline: headline.slice(0, 500), summary: summary?.slice(0, 4000) || null, symbol: symbol || null }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={cx("!px-2 text-accent2 hover:text-text", className)}
        onClick={() => {
          setOpen(true);
          if (!data && !busy) void load();
        }}
      >
        <CircleHelp size={13} strokeWidth={2} aria-hidden />
        What does this event mean?
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="What does this event mean?" wide>
        <div className="space-y-4">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Събитие</div>
            <p className="mt-0.5 text-sm font-medium leading-snug text-text">{headline}</p>
          </div>
          {busy && !data && <SkeletonText lines={6} />}
          {error && !data && <ErrorState title="Обяснението не се зареди" description={error} onRetry={() => void load()} />}
          {data && <ExplainSections data={data} />}
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
            <ShieldAlert size={12} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
            Образователно обяснение: какво е събитието и защо пазарите реагират. Не е прогноза и не казва накъде ще тръгне цената.
          </p>
        </div>
      </Modal>
    </>
  );
}
