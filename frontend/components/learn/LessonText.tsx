"use client";

/*
 * Lesson prose renderer for the blocks produced by annotateLesson() (components/learn/annotate.ts):
 * paragraphs, bullet lists, bold, in-app links and <Term k> on the first mention of each glossary term
 * (Explain mode shows the WHAT / WHY / MISTAKE card). The annotation is a pure function of the lesson
 * text (computed once with useMemo by the page) so StrictMode double renders stay consistent.
 */
import Link from "next/link";

import type { Block, Seg } from "@/components/learn/annotate";
import { Term } from "@/components/ui";
import { cx } from "@/lib/format";

export { annotateLesson } from "@/components/learn/annotate";
export type { Block, Seg } from "@/components/learn/annotate";

function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => {
        let node: React.ReactNode = s.t;
        if (s.href)
          node = (
            <Link href={s.href} className="font-medium text-accent2 underline decoration-accent2/40 underline-offset-2 hover:text-text">
              {s.t}
            </Link>
          );
        else if (s.term) node = <Term k={s.term}>{s.t}</Term>;
        return s.bold ? (
          <strong key={i} className="font-semibold text-text">
            {node}
          </strong>
        ) : (
          <span key={i}>{node}</span>
        );
      })}
    </>
  );
}

/** Renders annotated blocks: consecutive "li" blocks become one bullet list. */
export function LessonText({ blocks, className }: { blocks: Block[]; className?: string }) {
  const out: React.ReactNode[] = [];
  let list: Block[] = [];
  const flush = (key: string) => {
    if (!list.length) return;
    out.push(
      <ul key={key} className="my-3 space-y-1.5">
        {list.map((b, i) => (
          <li key={i} className="flex gap-2.5 leading-7">
            <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent2/70" aria-hidden />
            <span className="min-w-0">
              <Segs segs={b.segs} />
            </span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === "li") list.push(b);
    else {
      flush(`ul-${i}`);
      out.push(
        <p key={i} className="my-3 leading-7 first:mt-0 last:mb-0">
          <Segs segs={b.segs} />
        </p>,
      );
    }
  });
  flush("ul-end");
  return <div className={cx("text-[15px] text-text/90", className)}>{out}</div>;
}
