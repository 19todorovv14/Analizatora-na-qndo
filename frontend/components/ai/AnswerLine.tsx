import { ArrowUpRight, Check, TriangleAlert, X } from "lucide-react";
import Link from "next/link";

import { parseLine, splitNumbers } from "@/components/ai/model";
import { cx } from "@/lib/format";

function Marker({ mark }: { mark: "pass" | "fail" | "warn" }) {
  const map = {
    pass: { Icon: Check, cls: "bg-up/15 text-up ring-up/30", sr: "✓" },
    fail: { Icon: X, cls: "bg-down/15 text-down ring-down/30", sr: "✕" },
    warn: { Icon: TriangleAlert, cls: "bg-warn/15 text-warn ring-warn/30", sr: "!" },
  }[mark];
  return (
    <span className={cx("mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", map.cls)}>
      <map.Icon size={10} strokeWidth={3} aria-hidden />
      <span className="sr-only">{map.sr}</span>
    </span>
  );
}

/** Text with price/percent-like numbers set in tabular figures. */
export function NumText({ text }: { text: string }) {
  return (
    <>
      {splitNumbers(text).map((p, i) =>
        p.num ? (
          <span key={i} className="num font-medium text-text">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * One line of a teacher section: leading ✓ / ✗ / ⚠ become markers, "→ /learn/rsi" style paths become
 * in-app link chips, numbers are tabular. `dot` is the bullet colour class for plain lines.
 */
export function AnswerLine({ line, dot = "bg-faint", compact }: { line: string; dot?: string; compact?: boolean }) {
  const { mark, parts } = parseLine(line);
  return (
    <li className={cx("flex gap-2 leading-relaxed text-text/85", compact ? "text-[12px]" : "text-[13px]")}>
      {mark ? <Marker mark={mark} /> : <span className={cx("mt-[9px] h-1 w-1 shrink-0 rounded-full opacity-70", dot)} aria-hidden />}
      <span className="min-w-0 break-words">
        {parts.map((p, i) =>
          p.kind === "link" ? (
            <Link
              key={i}
              href={p.href}
              className="mx-0.5 inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-accent/25 bg-accent/10 px-1.5 py-px align-baseline text-[11px] font-medium text-accent2 transition-colors hover:border-accent/45 hover:text-text"
            >
              {p.text}
              <ArrowUpRight size={11} strokeWidth={2.25} aria-hidden />
            </Link>
          ) : (
            <NumText key={i} text={p.text} />
          ),
        )}
      </span>
    </li>
  );
}
