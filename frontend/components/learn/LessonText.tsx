"use client";

/*
 * Lesson prose renderer: paragraphs, "- " bullets, **bold**, in-app paths written as "(/learn/leverage)"
 * become links, and the FIRST mention of each glossary term in the whole lesson is wrapped in
 * <Term k> (Explain mode shows the WHAT / WHY / MISTAKE card). The annotation is a pure function of
 * the lesson text (computed once with useMemo) so StrictMode double renders stay consistent.
 */
import Link from "next/link";

import { Term } from "@/components/ui";
import { cx } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";

/** alias → glossary key; `cs` = case-sensitive (common words that are only terms when capitalised). */
const ALIASES: { a: string; k: string; cs?: boolean }[] = [
  { a: "stop loss", k: "stoploss" },
  { a: "stop-loss", k: "stoploss" },
  { a: "take profit", k: "takeprofit" },
  { a: "risk per trade", k: "risk_per_trade" },
  { a: "R:R", k: "rr", cs: true },
  { a: "reward:risk", k: "rr" },
  { a: "position size", k: "position_size" },
  { a: "position sizing", k: "position_size" },
  { a: "market order", k: "market_order" },
  { a: "limit order", k: "limit_order" },
  { a: "stop order", k: "stop_order" },
  { a: "unrealized P/L", k: "unrealized" },
  { a: "realized P/L", k: "realized" },
  { a: "free margin", k: "freemargin" },
  { a: "margin level", k: "marginlevel" },
  { a: "maintenance margin", k: "maintenance_margin" },
  { a: "out-of-sample", k: "out_of_sample" },
  { a: "walk-forward", k: "walk_forward" },
  { a: "paper trading", k: "paper_trading" },
  { a: "market cap", k: "market_cap" },
  { a: "profit factor", k: "profitfactor" },
  { a: "win rate", k: "winrate" },
  { a: "market regime", k: "regime" },
  { a: "Bollinger Bands", k: "bb" },
  { a: "Bollinger", k: "bb" },
  { a: "candlestick", k: "candlestick" },
  { a: "wick", k: "wick" },
  { a: "doji", k: "doji" },
  { a: "Bid", k: "bid", cs: true },
  { a: "Ask", k: "ask", cs: true },
  { a: "spread", k: "spread" },
  { a: "slippage", k: "slippage" },
  { a: "fees", k: "fees" },
  { a: "long", k: "long" },
  { a: "short", k: "short" },
  { a: "leverage", k: "leverage" },
  { a: "margin", k: "margin" },
  { a: "liquidation", k: "liquidation" },
  { a: "exposure", k: "exposure" },
  { a: "expectancy", k: "expectancy" },
  { a: "drawdown", k: "drawdown" },
  { a: "volatility", k: "volatility" },
  { a: "timeframe", k: "timeframe" },
  { a: "backtest", k: "backtest" },
  { a: "overfitting", k: "overfitting" },
  { a: "support", k: "support" },
  { a: "resistance", k: "resistance" },
  { a: "breakout", k: "breakout" },
  { a: "retest", k: "retest" },
  { a: "fakeout", k: "fakeout" },
  { a: "trend", k: "trend" },
  { a: "range", k: "range" },
  { a: "equity", k: "equity" },
  { a: "balance", k: "balance" },
  { a: "SQN", k: "sqn", cs: true },
  { a: "HH", k: "hh", cs: true },
  { a: "HL", k: "hl", cs: true },
  { a: "LH", k: "lh", cs: true },
  { a: "LL", k: "ll", cs: true },
  { a: "EMA", k: "ema", cs: true },
  { a: "SMA", k: "sma", cs: true },
  { a: "RSI", k: "rsi", cs: true },
  { a: "MACD", k: "macd", cs: true },
  { a: "VWAP", k: "vwap", cs: true },
  { a: "ATR", k: "atr", cs: true },
  { a: "ADX", k: "adx", cs: true },
  { a: "Open", k: "open", cs: true },
  { a: "High", k: "high", cs: true },
  { a: "Low", k: "low", cs: true },
  { a: "Close", k: "close", cs: true },
  { a: "Body", k: "body", cs: true },
  { a: "volume", k: "volume" },
].filter((x) => GLOSSARY[x.k]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const SORTED = [...ALIASES].sort((x, y) => y.a.length - x.a.length);
const ALIAS_BY_LOWER = new Map<string, { a: string; k: string; cs?: boolean }[]>();
for (const al of SORTED) {
  const key = al.a.toLowerCase();
  ALIAS_BY_LOWER.set(key, [...(ALIAS_BY_LOWER.get(key) ?? []), al]);
}
// latin word boundaries (Cyrillic letters count as boundaries, so "spread-ът" still matches)
const TERM_RE = new RegExp(`(?<![A-Za-z0-9])(${SORTED.map((x) => escape(x.a)).join("|")})(?![A-Za-z0-9])`, "gi");
const LINK_RE = /\((\/[a-z][\w\-/?=&.]*)\)/g;

export type Seg = { t: string; bold?: boolean; term?: string; href?: string };
export type Block = { kind: "p" | "li"; segs: Seg[] };

function termSegs(text: string, bold: boolean, used: Set<string>): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const hit = m[0];
    const cands = ALIAS_BY_LOWER.get(hit.toLowerCase()) ?? [];
    const al = cands.find((c) => !c.cs || c.a === hit);
    if (!al || used.has(al.k)) continue;
    used.add(al.k);
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i), bold });
    out.push({ t: hit, bold, term: al.k });
    last = i + hit.length;
  }
  if (last < text.length) out.push({ t: text.slice(last), bold });
  return out;
}

function lineSegs(line: string, used: Set<string>): Seg[] {
  const out: Seg[] = [];
  for (const part of line.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const text = bold ? part.slice(2, -2) : part;
    let last = 0;
    for (const m of text.matchAll(LINK_RE)) {
      const i = m.index ?? 0;
      if (i > last) out.push(...termSegs(text.slice(last, i), bold, used));
      out.push({ t: "(", bold }, { t: m[1], bold, href: m[1] }, { t: ")", bold });
      last = i + m[0].length;
    }
    if (last < text.length) out.push(...termSegs(text.slice(last), bold, used));
  }
  return out;
}

/**
 * Annotate several groups of paragraphs (body, then each section) in reading order; each glossary
 * term is wrapped only at its first mention across all groups.
 */
export function annotateLesson(groups: string[][]): Block[][] {
  const used = new Set<string>();
  return groups.map((paras) =>
    paras.map((p) => (p.startsWith("- ") ? { kind: "li" as const, segs: lineSegs(p.slice(2), used) } : { kind: "p" as const, segs: lineSegs(p, used) })),
  );
}

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
