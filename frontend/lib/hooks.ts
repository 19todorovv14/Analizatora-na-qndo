"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";

import { fetcher } from "@/lib/api";
import { indicatorQuery } from "@/lib/indicators";
import type { AccountView, CandlesResponse, PaperEvent, PaperInstrument, Trade } from "@/lib/types";

/** SWR key of GET /market/candles (`end` = last bar time, for history pages). */
export function candlesKey(symbol: string, timeframe: string, indicators: string[] = [], limit = 400, end?: number | null): string {
  const q = indicatorQuery(indicators);
  return `/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}${end ? `&end=${Math.floor(end)}` : ""}${
    q ? `&indicators=${q}` : ""
  }`;
}

export function useCandles(
  symbol: string,
  timeframe: string,
  indicators: string[] = [],
  limit = 400,
  live = true,
  opts: { refreshMs?: number; enabled?: boolean; end?: number | null } = {},
) {
  const { refreshMs = 5000, enabled = true, end } = opts;
  const key = enabled && symbol ? candlesKey(symbol, timeframe, indicators, limit, end) : null;
  return useSWR<CandlesResponse>(key, fetcher, {
    refreshInterval: live && !end ? Math.max(5000, refreshMs) : 0,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
}

/** GET /paper/instrument — order-panel parameters (qty step, leverage cap, bid/ask, FX conversion, session). */
export function usePaperInstrument(symbol: string | null | undefined, refreshMs = 10_000) {
  return useSWR<PaperInstrument>(symbol ? `/paper/instrument?symbol=${encodeURIComponent(symbol)}` : null, fetcher, {
    refreshInterval: Math.max(5000, refreshMs),
    keepPreviousData: true,
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });
}

/** GET /paper/trades (closed trades, newest first). */
export function usePaperTrades(limit = 200, refreshMs = 15_000) {
  return useSWR<{ trades: Trade[] }>(`/paper/trades?limit=${limit}`, fetcher, { refreshInterval: Math.max(5000, refreshMs) });
}

/** GET /paper/events (account activity, newest first). */
export function usePaperEvents(limit = 50, refreshMs = 15_000, enabled = true) {
  return useSWR<{ events: PaperEvent[] }>(enabled ? `/paper/events?limit=${limit}` : null, fetcher, {
    refreshInterval: Math.max(5000, refreshMs),
  });
}

/**
 * CSS media query as state. Server render and hydration use `serverDefault` (desktop-first), the real
 * value applies right after hydration.
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  return useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        if (typeof window === "undefined" || !window.matchMedia) return () => {};
        const mql = window.matchMedia(query);
        mql.addEventListener("change", cb);
        return () => mql.removeEventListener("change", cb);
      },
      [query],
    ),
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : serverDefault),
    () => serverDefault,
  );
}

/** Current unix time (s), refreshed every `intervalMs` (clocks, countdowns). 0 during SSR/hydration. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, Math.max(250, intervalMs));
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

export function useAccount(refreshMs = 5000) {
  return useSWR<AccountView>("/paper/account", fetcher, { refreshInterval: refreshMs, revalidateOnFocus: true });
}

/** Per-viewer UI preference persisted in localStorage (falls back to memory when storage is unavailable). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}

export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
