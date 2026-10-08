"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { useSWRConfig } from "swr";

import { ClassIcon } from "@/components/market/ClassBadge";
import { classLabel, comboKeyAction, hasWidthClass } from "@/components/market/model";
import type { AssetSummary, SearchPayload } from "@/components/market/types";
import { Kbd, Skeleton, SourceBadge, Spinner } from "@/components/ui";
import { useAnchoredPosition, useIsClient } from "@/components/ui/floating";
import { fetcher } from "@/lib/api";
import { cx } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

export type AssetSearchComboboxProps = {
  /** selected symbol ("BTC/USDT"); "" = nothing selected */
  value: string;
  /** called with the canonical symbol of the picked instrument */
  onChange: (symbol: string) => void;
  placeholder?: string;
  /** classes of the wrapper (layout: width, flex, margins). Default width: w-56 */
  className?: string;
  /** limit the search to one asset class (crypto | stock | etf | forex | index | commodity) */
  assetClass?: string;
  /* ── optional extras ─────────────────────────────────────────── */
  /** classes of the text field itself (padding, font size) */
  inputClassName?: string;
  /** the full search row of the picked instrument (slug, name, class, availability) */
  onSelectAsset?: (asset: AssetSummary) => void;
  /** keep the field empty after a pick (e.g. "add to watchlist") */
  clearOnSelect?: boolean;
  size?: "sm" | "md" | "lg";
  autoFocus?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  /** max results (default 12, ≤ 50) */
  limit?: number;
  /** symbols shown with a check mark (e.g. already in the watchlist) */
  markedSymbols?: string[];
  markedLabel?: string;
};

const SIZE = {
  sm: { input: "h-8 py-0 pl-7 pr-7 text-xs", icon: 13, left: "left-2.5", right: "right-2", overlay: "left-7 right-7 text-xs" },
  md: { input: "h-9 py-0 pl-8 pr-8 text-sm", icon: 15, left: "left-2.5", right: "right-2.5", overlay: "left-8 right-8 text-sm" },
  lg: { input: "h-12 py-0 pl-11 pr-10 text-[15px] rounded-xl", icon: 18, left: "left-4", right: "right-3.5", overlay: "left-11 right-10 text-[15px]" },
} as const;

function searchKey(q: string, limit: number, assetClass?: string) {
  const p = new URLSearchParams({ q, limit: String(Math.max(1, Math.min(50, limit))) });
  if (assetClass) p.set("asset_class", assetClass);
  return `/market/search?${p.toString()}`;
}

/** Case-insensitive match highlight (first occurrence). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-accent/20 px-px text-text">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * Instrument search combobox (WAI-ARIA combobox + listbox): debounced GET /market/search, keyboard
 * navigation (↑ ↓ Enter Esc Tab), class badge + data availability per row. Empty query → the most
 * popular instruments. The list is a portal, so it is never clipped by scrolling panels.
 */
export function AssetSearchCombobox({
  value,
  onChange,
  placeholder,
  className,
  assetClass,
  inputClassName,
  onSelectAsset,
  clearOnSelect,
  size = "md",
  autoFocus,
  ariaLabel,
  disabled,
  limit = 12,
  markedSymbols,
  markedLabel = "добавен",
}: AssetSearchComboboxProps) {
  const isClient = useIsClient();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<AssetSummary | null>(null);
  const keyNav = useRef(false);
  // search key of an Enter pressed while the rows were stale — resolved by onSuccess when its results arrive
  const pendingKey = useRef<string | null>(null);
  const { cache } = useSWRConfig();

  const close = useCallback(() => {
    pendingKey.current = null;
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const select = useCallback(
    (a: AssetSummary) => {
      setPicked(a);
      onChange(a.symbol);
      onSelectAsset?.(a);
      close();
      if (!clearOnSelect) inputRef.current?.blur();
    },
    [onChange, onSelectAsset, close, clearOnSelect],
  );

  const dq = useDebounced(query.trim(), 200);
  const results = useSWR<SearchPayload>(open ? searchKey(dq, limit, assetClass) : null, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    shouldRetryOnError: false,
    onSuccess: (d, key) => {
      if (pendingKey.current !== key) return;
      pendingKey.current = null;
      if (d.results.length) select(d.results[0]);
    },
    onError: (_e, key) => {
      if (pendingKey.current === key) pendingKey.current = null;
    },
  });
  // name / class of the current value (skipped when we already know it from the last pick)
  const known = picked && picked.symbol.toUpperCase() === value.toUpperCase() ? picked : null;
  const selected = useSWR<SearchPayload>(value && !known && !clearOnSelect ? searchKey(value, 8) : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    shouldRetryOnError: false,
  });
  const current =
    known ??
    selected.data?.results.find((r) => r.symbol.toUpperCase() === value.toUpperCase() || r.slug.toUpperCase() === value.toUpperCase()) ??
    null;

  const rows = results.data?.results ?? [];
  const loading = open && !results.data && !results.error;
  const typingAhead = query.trim() !== dq;
  // rows of an older query: keepPreviousData keeps them on screen while the debounce / request for the new one runs
  const stale = typingAhead || results.isLoading;
  const marked = new Set((markedSymbols ?? []).map((s) => s.toUpperCase()));

  useAnchoredPosition(open && isClient, wrapEl, listEl, "bottom", "start", 6, true);

  // keep the active option in view while navigating with the keyboard
  useEffect(() => {
    if (!open || !listEl || !keyNav.current) return;
    listEl.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listEl]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const act = comboKeyAction(e.key, { open, count: rows.length, active, stale, navigated: keyNav.current });
    switch (act.type) {
      case "open":
        e.preventDefault();
        keyNav.current = e.key !== "Enter";
        setOpen(true);
        break;
      case "move":
        e.preventDefault();
        keyNav.current = true;
        pendingKey.current = null;
        setActive(act.active);
        break;
      case "select":
        e.preventDefault();
        select(rows[act.index]);
        break;
      case "defer": {
        e.preventDefault();
        // the typed query may already be cached (searched a moment ago) → pick now, else when it arrives
        const key = searchKey(query.trim(), limit, assetClass);
        const hit = cache.get(key)?.data as SearchPayload | undefined;
        if (hit) {
          if (hit.results.length) select(hit.results[0]);
        } else {
          pendingKey.current = key;
        }
        break;
      }
      case "close":
        if (act.prevent) {
          e.preventDefault();
          e.stopPropagation();
        }
        close();
        break;
      case "blur":
        inputRef.current?.blur();
        break;
    }
  };

  const s = SIZE[size];
  const showOverlay = !editing && !!value && !clearOnSelect;
  const activeId = open && rows.length ? `${listId}-o${Math.min(active, rows.length - 1)}` : undefined;

  return (
    <div ref={setWrapEl} className={cx("relative min-w-0", !hasWidthClass(className) && "w-56 max-w-full", className)}>
      <Search
        size={s.icon}
        strokeWidth={2}
        className={cx("pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint", s.left)}
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel ?? (value && !clearOnSelect ? `Инструмент: ${value}. Търси друг` : "Търси инструмент")}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        value={editing ? query : clearOnSelect ? "" : value}
        placeholder={
          editing && value && !clearOnSelect ? `${value} — търси друг…` : (placeholder ?? "Търси актив: BTC, Apple, EUR/USD…")
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          keyNav.current = false;
          pendingKey.current = null;
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setEditing(true);
          setOpen(true);
        }}
        onBlur={() => {
          setEditing(false);
          close();
        }}
        onKeyDown={onKeyDown}
        className={cx("input font-medium", s.input, showOverlay && "text-transparent", inputClassName)}
      />
      {showOverlay && (
        <div className={cx("pointer-events-none absolute inset-y-0 flex min-w-0 items-center gap-2", s.overlay)} aria-hidden>
          <span className="num shrink-0 font-semibold text-text">{value}</span>
          {current?.name && current.name !== value && <span className="min-w-0 truncate text-[0.85em] text-muted">{current.name}</span>}
        </div>
      )}
      <span className={cx("pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint", s.right)} aria-hidden>
        {open && (results.isValidating || typingAhead) ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown size={s.icon} strokeWidth={2} className={cx("transition-transform", open && "rotate-180")} />
        )}
      </span>

      {open &&
        isClient &&
        createPortal(
          <div
            ref={setListEl}
            className="glass-strong invisible fixed left-0 top-0 z-[110] flex w-[min(440px,calc(100vw-16px))] animate-pop-in flex-col overflow-hidden rounded-xl text-sm text-text"
            onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
              <span>
                {dq ? "Резултати" : "Популярни"}
                {assetClass ? ` · ${classLabel(assetClass)}` : ""}
              </span>
              {results.data && dq && <span className="num normal-case tracking-normal">{results.data.total} намерени</span>}
            </div>
            <div id={listId} role="listbox" aria-label="Инструменти" className="max-h-[min(360px,55vh)] overflow-y-auto overscroll-contain p-1">
              {loading &&
                Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-2 py-2" aria-hidden>
                    <Skeleton className="h-6 w-6 !rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-2.5 w-24" />
                      <Skeleton className="h-2 w-40" />
                    </div>
                  </div>
                ))}
              {results.error && !results.data && (
                <div className="px-3 py-4 text-center text-xs text-muted" role="status">
                  Търсенето не е достъпно в момента. Опитай отново след малко.
                </div>
              )}
              {results.data && !rows.length && !typingAhead && (
                <div className="px-3 py-4 text-center text-xs leading-relaxed text-muted" role="status">
                  Няма инструменти за „{dq}“. Опитай символ (BTC), име (Apple) или клас (gold, forex).
                </div>
              )}
              {rows.map((a, i) => {
                const on = i === Math.min(active, rows.length - 1);
                const isMarked = marked.has(a.symbol.toUpperCase());
                const isSelected = !clearOnSelect && a.symbol.toUpperCase() === value.toUpperCase();
                return (
                  <div
                    key={a.slug}
                    id={`${listId}-o${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => {
                      keyNav.current = false;
                      if (!on) setActive(i);
                    }}
                    onClick={() => select(a)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-75",
                      on ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <ClassIcon cls={a.asset_class} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="num truncate text-[13px] font-semibold text-text">
                          <Highlight text={a.symbol} query={dq} />
                        </span>
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{classLabel(a.asset_class)}</span>
                        {isSelected && <Check size={12} strokeWidth={2.5} className="shrink-0 text-accent2" aria-label="избран" />}
                      </div>
                      <div className="truncate text-[11.5px] leading-4 text-muted">
                        <Highlight text={a.name} query={dq} />
                        {a.exchange ? <span className="text-faint"> · {a.exchange}</span> : null}
                      </div>
                    </div>
                    {isMarked ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-up">
                        <Check size={11} strokeWidth={2.5} aria-hidden /> {markedLabel}
                      </span>
                    ) : a.available ? (
                      <SourceBadge source={a.source} className="shrink-0" />
                    ) : (
                      <span
                        title={`DATA NOT AVAILABLE — ${a.unavailable_reason ?? "няма конфигуриран доставчик"}`}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint ring-1 ring-inset ring-white/10"
                      >
                        N/A
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden items-center gap-3 border-t border-white/[0.06] px-3 py-1.5 text-[10.5px] text-faint sm:flex">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> избор
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Enter</Kbd> избери
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> затвори
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
