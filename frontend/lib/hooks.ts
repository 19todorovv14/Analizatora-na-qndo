"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";

import { fetcher } from "@/lib/api";
import { indicatorQuery } from "@/lib/indicators";
import type { AccountView, CandlesResponse } from "@/lib/types";

export function useCandles(symbol: string, timeframe: string, indicators: string[] = [], limit = 400, live = true) {
  const q = indicatorQuery(indicators);
  const key = `/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}${q ? `&indicators=${q}` : ""}`;
  return useSWR<CandlesResponse>(key, fetcher, {
    refreshInterval: live ? 5000 : 0,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
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
