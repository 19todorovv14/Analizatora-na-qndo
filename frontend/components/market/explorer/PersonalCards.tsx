"use client";

import { History, Star, type LucideIcon } from "lucide-react";
import useSWR from "swr";

import { useQuotes } from "@/components/market/hooks";
import { inTab, type CategoryTab } from "@/components/market/model";
import { QuoteList } from "@/components/market/QuoteList";
import type { MarketItem, PersonalPayload } from "@/components/market/types";
import { Card, EmptyState, ErrorState } from "@/components/ui";
import { fetcher } from "@/lib/api";

const ROWS = 5;

function pickVisible(items: PersonalPayload["items"] | undefined, tab: CategoryTab) {
  return (items ?? []).filter((a) => inTab(a, tab)).slice(0, ROWS);
}

/** Empty card body: the full EmptyState from md up, one slim line on phones (the movers stay near the top). */
function EmptyBody({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <>
      <p className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-muted md:hidden">
        <Icon size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-faint" aria-hidden />
        <span>
          <span className="font-medium text-text">{title}.</span> {description}
        </span>
      </p>
      <div className="hidden p-3 md:block">
        <EmptyState compact icon={Icon} title={title} description={description} />
      </div>
    </>
  );
}

/** Favorites + Recently viewed cards of the explorer (filtered by the active category tab). */
export function PersonalCards({ tab }: { tab: CategoryTab }) {
  const fav = useSWR<PersonalPayload>("/market/favorites", fetcher, { revalidateOnFocus: false });
  const rec = useSWR<PersonalPayload>("/market/recent?limit=30", fetcher, { revalidateOnFocus: false });
  const favItems = pickVisible(fav.data?.items, tab);
  const recItems = pickVisible(rec.data?.items, tab);
  const quotes = useQuotes([...favItems, ...recItems].map((a) => a.symbol));
  const withQuote = (list: PersonalPayload["items"]): MarketItem[] => list.map((a) => ({ ...a, quote: quotes.data?.quotes[a.symbol] ?? null }));
  const scopeNote = tab.key === "all" ? "" : ` в ${tab.label}`;

  return (
    <>
      <Card
        title={
          <span className="flex items-center gap-2">
            <Star size={15} strokeWidth={2} className="text-gold" aria-hidden />
            Favorites
          </span>
        }
        right={fav.data ? <span className="num text-[11px] text-faint">{fav.data.items.length}</span> : null}
        bodyClass="p-0"
      >
        {fav.error && !fav.data ? (
          <div className="p-3">
            <ErrorState title="Любимите не се заредиха" onRetry={() => fav.mutate()} className="py-6" />
          </div>
        ) : fav.data && !favItems.length ? (
          <EmptyBody
            icon={Star}
            title={`Няма любими${scopeNote}`}
            description="Отвори актив и натисни звездата — любимите са бърз достъп до инструментите, които търгуваш най-често."
          />
        ) : (
          <QuoteList items={withQuote(favItems)} loading={!fav.data} rows={ROWS} />
        )}
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2">
            <History size={15} strokeWidth={2} className="text-info" aria-hidden />
            Recently viewed
          </span>
        }
        bodyClass="p-0"
      >
        {rec.error && !rec.data ? (
          <div className="p-3">
            <ErrorState title="Историята не се зареди" onRetry={() => rec.mutate()} className="py-6" />
          </div>
        ) : rec.data && !recItems.length ? (
          <EmptyBody icon={History} title={`Още няма разгледани активи${scopeNote}`} description="Активите, които отваряш, ще се появяват тук." />
        ) : (
          <QuoteList items={withQuote(recItems)} loading={!rec.data} rows={ROWS} />
        )}
      </Card>
    </>
  );
}
