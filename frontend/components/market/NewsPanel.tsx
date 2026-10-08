"use client";

import { CalendarClock, ExternalLink, Newspaper } from "lucide-react";
import useSWR from "swr";

import { relevantCountries, timeAgo } from "@/components/market/model";
import { EventExplainButton } from "@/components/market/NewsExplain";
import type { CalendarPayload, EarningsEvent, EconomicEvent, NewsPayload } from "@/components/market/types";
import { Badge, DataNotAvailable, Disclaimer, Skeleton } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";

type AssetRef = { symbol: string; slug: string; asset_class?: string | null; currency?: string | null; country?: string | null };

/** "1) … 2) … 3) …" → ["…", "…", "…"]. */
export function howToSteps(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\s*\d\)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const isEarnings = (e: EconomicEvent | EarningsEvent): e is EarningsEvent => "symbol" in e && "date" in e;

/** Calendar items relevant to an instrument: its own earnings, or economic events of its currencies' countries. */
export function relevantEvents(cal: CalendarPayload | undefined, asset: AssetRef, max = 6): (EconomicEvent | EarningsEvent)[] {
  if (!cal?.available) return [];
  if (cal.kind === "earnings") {
    return cal.items.filter((e) => isEarnings(e) && (e.slug === asset.slug || e.symbol.toUpperCase() === asset.symbol.toUpperCase())).slice(0, max);
  }
  const countries = new Set(relevantCountries(asset));
  if (!countries.size) return [];
  return cal.items
    .filter((e): e is EconomicEvent => !isEarnings(e) && !!e.country && countries.has(e.country.toUpperCase()))
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact))
    .slice(0, max);
}

function impactRank(i: string | null | undefined) {
  const k = (i ?? "").toLowerCase();
  return k === "high" ? 3 : k === "medium" ? 2 : k === "low" ? 1 : 0;
}

/** News & events block of the asset page. DATA NOT AVAILABLE (with how to enable it) without a provider. */
export function NewsPanel({ news, asset }: { news: NewsPayload | null | undefined; asset: AssetRef }) {
  const cal = useSWR<CalendarPayload>(news?.available ? "/markets/calendar" : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 600_000 });
  const events = relevantEvents(cal.data, asset);

  if (!news || !news.available) {
    const steps = howToSteps(news?.how_to_enable);
    return (
      <div className="space-y-3">
        <DataNotAvailable
          reason={news?.reason ?? "Няма конфигуриран news provider."}
          provider="Finnhub (news & events calendar)"
          className="py-7"
        />
        {steps.length > 0 && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Как да включиш новините</div>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted marker:text-faint">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        {news?.disclaimer && <Disclaimer>{news.disclaimer}</Disclaimer>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {news.scope === "category" && (
        <p className="text-xs text-faint">
          Новини от категория <span className="text-muted">{news.category ?? "general"}</span> — не са специфични само за {asset.symbol}.
        </p>
      )}
      {news.items.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {news.items.map((n) => (
            <li key={n.id} className="py-3 first:pt-0">
              <div className="flex items-start gap-2.5">
                <Newspaper size={14} strokeWidth={1.9} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  {n.url ? (
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="group inline text-sm font-medium leading-snug text-text hover:text-accent2"
                    >
                      {n.headline}
                      <ExternalLink size={11} strokeWidth={2} className="ml-1 inline align-baseline text-faint group-hover:text-accent2" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-sm font-medium leading-snug text-text">{n.headline}</span>
                  )}
                  <div className="mt-0.5 text-[11px] text-faint">
                    {[n.source, timeAgo(n.ts)].filter(Boolean).join(" · ")}
                  </div>
                  {n.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{n.summary}</p>}
                  <EventExplainButton headline={n.headline} summary={n.summary} symbol={asset.symbol} className="-ml-2 mt-0.5" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Няма скорошни новини за този инструмент.</p>
      )}

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
          <CalendarClock size={12} strokeWidth={2} aria-hidden />
          Events · следващите 7 дни
          {cal.data?.kind && <Badge tone="neutral">{cal.data.kind}</Badge>}
        </div>
        {cal.isLoading && !cal.data ? (
          <Skeleton className="h-10 w-full" />
        ) : !cal.data?.available ? (
          <p className="text-xs text-faint">{cal.data?.reason ?? "Календарът на събитията не е достъпен."}</p>
        ) : events.length ? (
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <EventRow key={i} e={e} symbol={asset.symbol} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-faint">Няма събития за {asset.symbol} в календара за този период.</p>
        )}
        {cal.data?.note && <p className="mt-1.5 text-[11px] text-faint">{cal.data.note}</p>}
      </div>
      {news.disclaimer && <Disclaimer>{news.disclaimer}</Disclaimer>}
    </div>
  );
}

function EventRow({ e, symbol }: { e: EconomicEvent | EarningsEvent; symbol: string }) {
  if (isEarnings(e)) {
    const title = `${e.name ?? e.symbol} earnings (Q${e.quarter ?? "?"} ${e.year ?? ""})`.trim();
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
        <span className="num text-faint">{e.date}</span>
        <span className="min-w-0 flex-1 font-medium text-text">{title}</span>
        {e.eps_estimate !== null && e.eps_estimate !== undefined && <span className="num text-muted">EPS est. {e.eps_estimate}</span>}
        <EventExplainButton headline={title} symbol={symbol} />
      </li>
    );
  }
  const impact = (e.impact ?? "").toLowerCase();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
      <span className="num text-faint">{e.time ?? "—"}</span>
      <span className="font-semibold text-muted">{e.country}</span>
      <span className="min-w-0 flex-1 font-medium text-text">{e.event}</span>
      {impact && (
        <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", impact === "high" ? "bg-down/10 text-down" : impact === "medium" ? "bg-warn/10 text-warn" : "bg-white/[0.05] text-faint")}>
          {impact}
        </span>
      )}
      <EventExplainButton headline={`${e.country ?? ""} ${e.event}`.trim()} symbol={symbol} />
    </li>
  );
}
