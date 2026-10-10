import Link from "next/link";

import { Badge } from "@/components/ui";
import { cx, pnlClass } from "@/lib/format";
import type { Review } from "@/lib/types";
import { lessonHref } from "@/lib/lessons";

export function TradeReviewCard({ review }: { review: Review }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold tracking-wide">TRADE REVIEW</span>
        <Badge tone={review.side === "long" ? "up" : "down"}>{review.side}</Badge>
        <span className="font-semibold">{review.symbol}</span>
        <span className={cx("ml-auto rounded-md px-2 py-0.5 text-sm font-bold", review.grade <= "B" ? "bg-up/15 text-up" : "bg-warn/15 text-warn")}>
          Process grade {review.grade} · {review.process_score}/100
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-panel2 p-2">
          <div className="label">Entry</div>
          <div className="num text-xs">{review.entry}</div>
        </div>
        <div className="rounded-md bg-panel2 p-2">
          <div className="label">Exit</div>
          <div className="num text-xs">{review.exit}</div>
        </div>
        <div className="rounded-md bg-panel2 p-2">
          <div className="label">Result</div>
          <div className={cx("num font-bold", pnlClass(review.net_pnl))}>{review.result}</div>
        </div>
      </div>
      <div>
        <div className="label">What happened</div>
        <p className="text-text/90">{review.what_happened}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="label text-up">What you did well</div>
          {review.did_well.length ? (
            <ul className="space-y-1">
              {review.did_well.map((x) => (
                <li key={x} className="text-text/90">
                  ✓ {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">—</p>
          )}
        </div>
        <div>
          <div className="label text-down">What you did poorly</div>
          {review.did_poorly.length ? (
            <ul className="space-y-1">
              {review.did_poorly.map((x) => (
                <li key={x} className="text-text/90">
                  ✗ {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Няма забележки по процеса.</p>
          )}
        </div>
      </div>
      <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
        <div className="label text-accent2">Main lesson</div>
        <p className="font-medium">{review.main_lesson}</p>
        {review.lessons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            Препоръчани уроци:
            {review.lessons.map((l) => (
              <Link key={l} href={lessonHref(l)} className="text-accent2 hover:underline">
                /learn/{l}
              </Link>
            ))}
          </div>
        )}
      </div>
      {review.narrative && (
        <div className="rounded-md bg-panel2 p-3 text-text/90">
          <div className="label">AI Teacher</div>
          <p className="whitespace-pre-line">{review.narrative}</p>
        </div>
      )}
    </div>
  );
}
