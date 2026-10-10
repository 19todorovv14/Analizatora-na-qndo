"use client";

import {
  ArrowLeftRight,
  Bitcoin,
  BookOpen,
  ChartLine,
  Clock,
  CornerDownLeft,
  Gem,
  Landmark,
  Layers,
  Search,
  SearchX,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";

import { bestScore, normalize } from "@/components/shell/fuzzy";
import { NAV_GROUP_OF, PALETTE_PAGES, type NavItem } from "@/components/shell/nav";
import { ShortcutKeys } from "@/components/shell/ShortcutKeys";
import { Kbd, Skeleton, SourceBadge, Spinner, useStoredState, type SourceLike } from "@/components/ui";
import { useFocusTrap, useIsClient, useScrollLock } from "@/components/ui/floating";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { lessonHref } from "@/lib/lessons";

/* ─────────────────────────────────────────────────────────── types */

/** Row of GET /api/market/search (F1 asset_summary + score). */
type SearchAsset = {
  symbol: string;
  slug: string;
  name: string;
  asset_class: string | null;
  category?: string | null;
  exchange?: string | null;
  available: boolean;
  unavailable_reason?: string | null;
  source?: SourceLike | null;
};
type SearchResponse = { results?: SearchAsset[] };

/** GET /api/academy/modules (the academy has no flat lessons endpoint). */
type ModulesResponse = { modules: { key: string; title: string; lessons: { slug: string; title: string; summary?: string; href?: string | null }[] }[] };

type Item =
  | { kind: "recent"; key: string; query: string }
  | { kind: "asset"; key: string; asset: SearchAsset }
  | { kind: "page"; key: string; item: NavItem; group: string }
  | { kind: "lesson"; key: string; slug: string; href: string | null; title: string; module: string };

type Section = { key: string; label: string; hint?: string; action?: React.ReactNode; loading?: boolean; items: Item[] };

const RECENT_KEY = "ta-recent-search";
const RECENT_MAX = 6;
const asRecent = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, RECENT_MAX) : undefined;

const CLASS_META: Record<string, { label: string; icon: LucideIcon }> = {
  crypto: { label: "Crypto", icon: Bitcoin },
  stock: { label: "Stock", icon: Landmark },
  etf: { label: "ETF", icon: Layers },
  forex: { label: "Forex", icon: ArrowLeftRight },
  index: { label: "Index", icon: ChartLine },
  commodity: { label: "Commodity", icon: Gem },
};

/* ───────────────────────────────────────────────────────── public */

/**
 * Global command palette (opened with "/" or Ctrl/⌘+K and from the top-bar trigger).
 * Sections: ASSETS (GET /market/search — hidden when the endpoint fails), PAGES (fuzzy over the
 * nav + the Academy labs) and LESSONS (GET /academy/modules, matched by title). Empty query → recent searches,
 * popular assets and every page.
 */
export function CommandPalette({ open, onClose, onOpenHelp }: { open: boolean; onClose: () => void; onOpenHelp?: () => void }) {
  const isClient = useIsClient();
  if (!isClient || !open) return null;
  return createPortal(<PaletteDialog onClose={onClose} onOpenHelp={onOpenHelp} />, document.body);
}

/* ───────────────────────────────────────────────────────── dialog */

function PaletteDialog({ onClose, onOpenHelp }: { onClose: () => void; onOpenHelp?: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keyNav = useRef(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useStoredState<string[]>(RECENT_KEY, [], { validate: asRecent });
  useScrollLock(true);
  useFocusTrap(true, panel);

  const query = q.trim();
  const dq = useDebounced(query, 200);
  const nq = normalize(query);

  const assets = useSWR<SearchResponse>(`/market/search?q=${encodeURIComponent(dq)}&limit=12`, fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  });
  const modules = useSWR<ModulesResponse>("/academy/modules", fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 });

  const lessons = useMemo(
    () => (modules.data?.modules ?? []).flatMap((m) => (m.lessons ?? []).map((l) => ({ slug: l.slug, href: l.href ?? null, title: l.title, module: m.title }))),
    [modules.data],
  );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const assetRows = assets.error ? [] : (assets.data?.results ?? []);
    const assetsLoading = !assets.error && !assets.data && assets.isLoading;

    if (!nq) {
      if (recent.length)
        out.push({
          key: "recent",
          label: "RECENT",
          action: (
            <button
              type="button"
              onClick={() => setRecent([])}
              className="rounded px-1 text-[10px] font-medium normal-case tracking-normal text-faint transition-colors hover:text-text"
            >
              Изчисти
            </button>
          ),
          items: recent.map((r) => ({ kind: "recent" as const, key: `r:${r}`, query: r })),
        });
      if (!assets.error)
        out.push({
          key: "assets",
          label: "ASSETS",
          hint: "популярни",
          loading: assetsLoading,
          items: assetRows.slice(0, 6).map((a) => ({ kind: "asset" as const, key: `a:${a.slug}`, asset: a })),
        });
      out.push({
        key: "pages",
        label: "PAGES",
        items: PALETTE_PAGES.map((item) => ({ kind: "page" as const, key: `p:${item.href}`, item, group: NAV_GROUP_OF[item.href]?.label ?? "" })),
      });
      return out.filter((s) => s.items.length || s.loading);
    }

    if (!assets.error)
      out.push({
        key: "assets",
        label: "ASSETS",
        loading: assetsLoading,
        items: assetRows.slice(0, 12).map((a) => ({ kind: "asset" as const, key: `a:${a.slug}`, asset: a })),
      });

    const pages = PALETTE_PAGES.map((item) => {
      const group = NAV_GROUP_OF[item.href]?.label ?? "";
      const score = bestScore(nq, [
        [item.label, 1],
        ...(item.keywords ?? []).map((k): [string, number] => [k, 0.85]),
        [item.href.replace(/[/-]/g, " "), 0.6],
        [group, 0.5],
      ]);
      return { item, group, score };
    })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    out.push({ key: "pages", label: "PAGES", items: pages.map((p) => ({ kind: "page" as const, key: `p:${p.item.href}`, item: p.item, group: p.group })) });

    if (!modules.error) {
      const ls = lessons
        .map((l) => ({ l, score: bestScore(nq, [[l.title, 1]]) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
      out.push({
        key: "lessons",
        label: "LESSONS",
        items: ls.map(({ l }) => ({ kind: "lesson" as const, key: `l:${l.slug}`, slug: l.slug, href: l.href, title: l.title, module: l.module })),
      });
    }
    return out.filter((s) => s.items.length || s.loading);
  }, [nq, recent, setRecent, assets.data, assets.error, assets.isLoading, modules.error, lessons]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIdx = flat.length ? Math.min(active, flat.length - 1) : -1;
  const searching = query !== dq || (assets.isValidating && !assets.error);
  const noResults = !!nq && !searching && !assets.isLoading && flat.length === 0;

  // keep the keyboard-selected row visible
  useEffect(() => {
    if (!keyNav.current || activeIdx < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const remember = (text: string) => {
    if (!text) return;
    setRecent((prev) => [text, ...prev.filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_MAX));
  };

  const select = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === "recent") {
      // rows keep focus in the input (mousedown is prevented), so typing can continue
      setQ(it.query);
      setActive(0);
      return;
    }
    remember(query);
    const href =
      it.kind === "asset" ? `/markets/${encodeURIComponent(it.asset.slug)}` : it.kind === "page" ? it.item.href : lessonHref(it.slug, it.href);
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (!flat.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      keyNav.current = true;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIdx + d + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(flat[activeIdx]);
    }
  };

  const offsets: number[] = [];
  let acc = 0;
  for (const s of sections) {
    offsets.push(acc);
    acc += s.items.length;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-start justify-center bg-overlay p-3 pt-[9vh] sm:pt-[13vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Търсене"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="glass-strong flex max-h-[min(640px,82dvh)] w-full max-w-[640px] animate-scale-in flex-col overflow-hidden rounded-2xl shadow-modal outline-none"
      >
        {/* input */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
          <Search size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            data-autofocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Търси актив, урок или страница…"
            aria-label="Търси актив, урок или страница"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIdx >= 0 ? `${listId}-${activeIdx}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-faint"
          />
          {searching && <Spinner className="h-3.5 w-3.5" />}
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setActive(0);
                inputRef.current?.focus();
              }}
              aria-label="Изчисти търсенето"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              <X size={15} strokeWidth={2} aria-hidden />
            </button>
          )}
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>

        {/* results */}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Резултати"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
          onMouseMove={() => {
            keyNav.current = false;
          }}
        >
          {noResults ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <SearchX size={22} strokeWidth={1.75} className="text-faint" aria-hidden />
              <div className="text-sm font-medium text-text">Няма резултати за „{query}“</div>
              <div className="max-w-sm text-xs leading-relaxed text-muted">
                Опитай със символ (BTC, AAPL, EUR/USD), име (Bitcoin, Apple, Gold) или страница (Charts, Backtesting).
              </div>
            </div>
          ) : (
            sections.map((s, si) => (
              <div key={s.key} role="group" aria-labelledby={`${listId}-${s.key}`} className="mb-1 last:mb-0">
                <div
                  id={`${listId}-${s.key}`}
                  className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint"
                >
                  <span>
                    {s.label}
                    {s.hint && <span className="ml-1.5 font-medium normal-case tracking-normal text-faint/80">· {s.hint}</span>}
                  </span>
                  {s.action}
                </div>
                {s.loading && !s.items.length
                  ? [0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 px-2.5 py-2" aria-hidden>
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-2.5 w-40" />
                        </div>
                      </div>
                    ))
                  : s.items.map((it, ii) => {
                      const i = offsets[si] + ii;
                      const on = i === activeIdx;
                      return (
                        <div
                          key={it.key}
                          id={`${listId}-${i}`}
                          data-idx={i}
                          role="option"
                          aria-selected={on}
                          onMouseMove={() => {
                            if (i !== activeIdx) setActive(i);
                          }}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => select(it)}
                          className={cx(
                            "relative flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-75",
                            on ? "bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]" : "hover:bg-white/[0.035]",
                          )}
                        >
                          <Row it={it} />
                          {on && <CornerDownLeft size={14} strokeWidth={2} className="hidden shrink-0 text-faint sm:block" aria-hidden />}
                        </div>
                      );
                    })}
              </div>
            ))
          )}
        </div>

        {/* footer */}
        <footer className="flex shrink-0 items-center gap-4 border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            избор
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd>
            отвори
          </span>
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Kbd>Esc</Kbd>
            затвори
          </span>
          {onOpenHelp && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenHelp();
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded px-1 transition-colors hover:text-text"
            >
              <ShortcutKeys combo="?" />
              клавиши
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── rows */

function IconTile({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "accent" }) {
  return (
    <span
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-gradient-to-b from-white/[0.07] to-white/[0.02]",
        tone === "accent" ? "text-accent2" : "text-muted",
      )}
    >
      <Icon size={15} strokeWidth={1.8} aria-hidden />
    </span>
  );
}

function Row({ it }: { it: Item }) {
  if (it.kind === "recent") {
    return (
      <>
        <IconTile icon={Clock} />
        <span className="min-w-0 flex-1 truncate text-sm text-text">{it.query}</span>
      </>
    );
  }
  if (it.kind === "asset") {
    const a = it.asset;
    const meta = (a.asset_class && CLASS_META[a.asset_class]) || { label: a.asset_class ?? "—", icon: ChartLine };
    return (
      <>
        <IconTile icon={meta.icon} tone="accent" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-text">{a.symbol}</span>
            {a.exchange && <span className="hidden truncate text-[11px] text-faint sm:inline">{a.exchange}</span>}
          </span>
          <span className="block truncate text-xs text-muted">{a.name}</span>
        </span>
        <span className="hidden shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-muted ring-1 ring-inset ring-white/[0.08] sm:inline">
          {meta.label}
        </span>
        {a.available ? (
          <SourceBadge source={a.source} />
        ) : (
          <span
            title={a.unavailable_reason || "Няма конфигуриран доставчик на данни за този инструмент."}
            className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-faint ring-1 ring-inset ring-white/10"
          >
            N/A
          </span>
        )}
      </>
    );
  }
  if (it.kind === "page") {
    return (
      <>
        <IconTile icon={it.item.icon} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{it.item.label}</span>
          <span className="block truncate text-xs text-muted">{it.item.tour}</span>
        </span>
        <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint md:inline">{it.group}</span>
        {it.item.shortcut && <ShortcutKeys decorative combo={it.item.shortcut} className="hidden sm:inline-flex" />}
      </>
    );
  }
  return (
    <>
      <IconTile icon={BookOpen} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">{it.title}</span>
        <span className="block truncate text-xs text-muted">{it.module}</span>
      </span>
    </>
  );
}
