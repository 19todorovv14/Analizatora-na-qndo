"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { quotesKey } from "@/components/market/model";
import type { Membership, QuotesPayload } from "@/components/market/types";
import { del, errorMessage, fetcher, post } from "@/lib/api";

export const MEMBERSHIP_KEY = "/markets/membership";

/** Every SWR key that shows watchlist rows (new markets API + the old F1 endpoint the dashboard uses). */
const isWatchlistKey = (key: unknown) =>
  typeof key === "string" && (key.startsWith("/markets/watchlist") || key === "/market/watchlist" || key === MEMBERSHIP_KEY);
const isFavoritesKey = (key: unknown) => typeof key === "string" && (key.startsWith("/market/favorites") || key === MEMBERSHIP_KEY);

/** Watchlist + favorites symbols of the logged-in user (cheap; drives the Favorite / Watchlist buttons). */
export function useMembership() {
  return useSWR<Membership>(MEMBERSHIP_KEY, fetcher, { revalidateOnFocus: false, dedupingInterval: 10_000 });
}

type Toggle = { busy: boolean; error: string | null; toggle: (symbol: string, on: boolean) => Promise<boolean> };

function useMembershipToggle(kind: "favorites" | "watchlist"): Toggle {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = useCallback(
    async (symbol: string, on: boolean) => {
      setBusy(true);
      setError(null);
      const apply = (m: Membership | undefined): Membership | undefined => {
        if (!m) return m;
        const list = m[kind].filter((s) => s !== symbol);
        return { ...m, [kind]: on ? [...list, symbol] : list };
      };
      try {
        // optimistic: the button flips immediately, rolls back if the request fails
        await mutate<Membership>(
          MEMBERSHIP_KEY,
          async (cur) => {
            const path = kind === "favorites" ? "/market/favorites" : "/market/watchlist";
            if (on) await post(path, { symbol });
            else await del(`${path}/${encodeURIComponent(symbol)}`);
            return apply(cur);
          },
          { optimisticData: (cur) => apply(cur) as Membership, rollbackOnError: true, revalidate: false, populateCache: true },
        );
        await mutate(kind === "favorites" ? isFavoritesKey : isWatchlistKey);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [kind, mutate],
  );
  return { busy, error, toggle };
}

export const useFavoriteToggle = () => useMembershipToggle("favorites");
export const useWatchlistToggle = () => useMembershipToggle("watchlist");

/** Adds several instruments to the watchlist (empty-state quick actions). Returns the number added. */
export function useAddToWatchlist() {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(
    async (symbols: string[]) => {
      setBusy(true);
      setError(null);
      let added = 0;
      try {
        for (const symbol of symbols) {
          await post("/market/watchlist", { symbol });
          added++;
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        await mutate(isWatchlistKey);
        setBusy(false);
      }
      return added;
    },
    [mutate],
  );
  return { add, busy, error };
}

/** Quotes for a page of symbols (≤ 100) — GET /markets/quotes, polled every `refreshMs`. */
export function useQuotes(symbols: string[], refreshMs = 30_000) {
  const key = useMemo(() => quotesKey(symbols), [symbols]);
  return useSWR<QuotesPayload>(key, fetcher, {
    refreshInterval: (data) => (data && Object.values(data.quotes).some((q) => q.status === "pending") ? 6_000 : refreshMs),
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

/** POST /market/recent once per symbol per mount ("Recently viewed"). Failures are silent. */
export function useRecordView(symbol: string | null | undefined) {
  const done = useRef<string | null>(null);
  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!symbol || done.current === symbol) return;
    done.current = symbol;
    post("/market/recent", { symbol })
      .then(() => mutate((key) => typeof key === "string" && key.startsWith("/market/recent")))
      .catch(() => {
        /* not critical */
      });
  }, [symbol, mutate]);
}
