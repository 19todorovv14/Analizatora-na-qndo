"use client";

import { ChartCandlestick, Eye, Globe, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { AssetSearchCombobox } from "@/components/market/AssetSearchCombobox";
import { CatalogBrowser } from "@/components/market/explorer/CatalogBrowser";
import { PersonalCards } from "@/components/market/explorer/PersonalCards";
import { Heatmap } from "@/components/market/Heatmap";
import { LinkButton } from "@/components/market/LinkButton";
import { MarketMovers } from "@/components/market/MarketMovers";
import { CATEGORY_TABS, LIST_META, TAB_BY_KEY, assetHref, isTabKey, tabCount, type CategoryTabKey, type HeatmapClass } from "@/components/market/model";
import type { CatalogPayload, ListKind } from "@/components/market/types";
import { Card, PageHeader, Segmented, Tabs, Term, useStoredState } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { LearnHint } from "@/lib/workspace";

const MOVERS: ListKind[] = ["gainers", "losers", "most_volume", "high_volatility", "low_volatility", "trending"];
const HEATMAP_OPTIONS: { value: HeatmapClass; label: string }[] = [
  { value: "crypto", label: "Crypto" },
  { value: "stock", label: "Stocks" },
  { value: "etf", label: "ETFs" },
];

const asTab = (v: unknown) => (isTabKey(v) ? v : undefined);
const asHeat = (v: unknown) => (v === "crypto" || v === "stock" || v === "etf" ? (v as HeatmapClass) : undefined);

/** /markets — MARKET EXPLORER: search, category tabs, personal + mover cards, heatmap and the full catalog. */
export function MarketsExplorer() {
  const router = useRouter();
  const [tabKey, setTabKey] = useStoredState<CategoryTabKey>("ta-markets-tab", "all", { validate: asTab });
  const [heat, setHeat] = useStoredState<HeatmapClass>("ta-markets-heatmap", "crypto", { validate: asHeat });
  const tab = TAB_BY_KEY[tabKey] ?? CATEGORY_TABS[0];
  const [moverKind, setMoverKind] = useState<ListKind>("gainers");

  // deep links: /markets?class=crypto (or ?tab=metal)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const want = p.get("tab") ?? p.get("class");
    if (isTabKey(want)) {
      setTabKey(want);
      const h = TAB_BY_KEY[want].heatmap;
      if (h) setHeat(h);
    }
  }, [setTabKey, setHeat]);

  // unfiltered facets → stable tab counts
  const counts = useSWR<CatalogPayload>("/market/catalog?page_size=1", fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });

  const selectTab = (k: CategoryTabKey) => {
    setTabKey(k);
    const h = TAB_BY_KEY[k].heatmap;
    if (h) setHeat(h);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHeader
        title="Markets"
        icon={Globe}
        subtitle={
          <>
            Пазарен explorer: {counts.data ? <span className="num text-text">{counts.data.total.toLocaleString("en-US")}</span> : "стотици"} инструмента —
            крипто, акции, ETF, forex, индекси и суровини. Данните са само за четене; търговията е виртуална (paper).
          </>
        }
        actions={
          <>
            <LinkButton href="/watchlist">
              <Eye size={14} strokeWidth={2} aria-hidden /> Моят watchlist
            </LinkButton>
            <LinkButton href="/charts">
              <ChartCandlestick size={14} strokeWidth={2} aria-hidden /> Charts
            </LinkButton>
          </>
        }
      />

      <div className="card relative overflow-visible p-3 sm:p-4">
        <AssetSearchCombobox
          value=""
          clearOnSelect
          size="lg"
          className="w-full"
          limit={15}
          ariaLabel="Търси инструмент на пазара"
          placeholder="Търси актив: BTC, Apple, EUR/USD, gold, S&P 500…"
          onChange={() => {}}
          onSelectAsset={(a) => router.push(assetHref(a))}
        />
        <div className="mt-3">
          {/* tighter than the default tab padding: all ten categories fit at 1280 px (narrower screens scroll) */}
          <Tabs
            value={tab.key}
            onChange={selectTab}
            className="!gap-0.5 [&>button]:px-2.5"
            tabs={CATEGORY_TABS.map((t) => {
              const n = tabCount(t, counts.data?.facets, counts.data?.total);
              return {
                key: t.key,
                label: (
                  <span title={t.bg} className="flex items-center gap-1">
                    {t.label}
                    {n !== null && <span className="num rounded bg-white/[0.06] px-1 text-[10px] font-medium text-faint">{n}</span>}
                  </span>
                ),
              };
            })}
          />
        </div>
      </div>

      <LearnHint title="Как да четеш този екран">
        Lists като Top gainers показват какво се е движило — не какво ще се движи. Голям ръст или висока{" "}
        <Term k="volatility">volatility</Term> означава и по-голям риск. Отвори актив, за да видиш графиката, режима на пазара и AI обяснение.
      </LearnHint>

      <section aria-label="Бърз достъп" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <PersonalCards tab={tab} />
        <MarketMovers kind="popular" assetClass={tab.listClass} limit={5} className="md:col-span-2 xl:col-span-1" />
      </section>

      <section aria-label="Market movers" className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
        {MOVERS.map((k) => (
          <MarketMovers key={k} kind={k} assetClass={tab.listClass} limit={5} />
        ))}
      </section>
      {/* phones: one movers card with a list switcher instead of six stacked cards */}
      <section aria-label="Market movers" className="space-y-2 md:hidden">
        <Tabs value={moverKind} onChange={setMoverKind} tabs={MOVERS.map((k) => ({ key: k, label: LIST_META[k].title }))} />
        <MarketMovers kind={moverKind} assetClass={tab.listClass} limit={5} />
      </section>

      <Card
        title={
          <span className="flex items-center gap-2">
            <LayoutGrid size={15} strokeWidth={2} className="text-accent2" aria-hidden />
            <Term k="heatmap">Heatmap</Term>
          </span>
        }
        right={<Segmented size="sm" ariaLabel="Клас за heatmap" options={HEATMAP_OPTIONS} value={heat} onChange={setHeat} />}
      >
        {!tab.heatmap && tab.key !== "all" && (
          <p className="mb-2.5 text-xs text-faint">
            Heatmap има за Crypto, Stocks и ETFs (секторите им дават смислени групи) — за {tab.label} използвай списъците и каталога.
          </p>
        )}
        <Heatmap assetClass={heat} />
      </Card>

      <CatalogBrowser tab={tab} />
    </div>
  );
}
