"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Tiny localStorage-backed store for per-viewer UI preferences (sidebar width, explain mode…).
 *
 * - Hydration-safe: the server snapshot is always `null` → the initial value renders on the server
 *   AND during hydration; React then re-renders with the stored value (no mismatch, no flash of
 *   error). Storage is never read during the server render.
 * - Every hook instance using the same key stays in sync (and other tabs via the `storage` event).
 * - Writes are cached in memory immediately and flushed to localStorage shortly after, so dragging
 *   a resize handle does not hit storage on every pointer move.
 * - Works (in memory) when storage is unavailable (private mode, blocked site data).
 */

const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function readRaw(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  let v: string | null = null;
  try {
    v = window.localStorage.getItem(key);
  } catch {
    v = null;
  }
  cache.set(key, v);
  return v;
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function writeRaw(key: string, value: string | null, flushMs: number) {
  cache.set(key, value);
  notify(key);
  const t = pending.get(key);
  if (t) clearTimeout(t);
  const flush = () => {
    pending.delete(key);
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — keep the in-memory value */
    }
  };
  if (flushMs <= 0) flush();
  else pending.set(key, setTimeout(flush, flushMs));
}

let storageListenerAttached = false;
function ensureStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (e) => {
    if (!e.key || !listeners.has(e.key)) return;
    cache.set(e.key, e.newValue);
    notify(e.key);
  });
}

function subscribe(key: string, cb: () => void) {
  ensureStorageListener();
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

export type StoredStateOptions<T> = {
  /** Validate / coerce a parsed value; return undefined to fall back to the initial value. */
  validate?: (v: unknown) => T | undefined;
  /** Delay before persisting to localStorage (ms). Default 0 (immediate). */
  flushMs?: number;
};

/**
 * `useState` persisted in localStorage under `key` (JSON). Server render and hydration always use
 * `initial`; the stored value is applied right after hydration.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  opts: StoredStateOptions<T> = {},
): [T, (v: T | ((prev: T) => T)) => void] {
  const { validate, flushMs = 0 } = opts;
  const raw = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    () => readRaw(key),
    () => null,
  );
  const value = useMemo(() => {
    if (raw === null) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (validate) return validate(parsed) ?? initial;
      return parsed as T;
    } catch {
      return initial;
    }
    // `initial` / `validate` are treated as constants for a given key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, key]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      let prev: T = initial;
      const cur = readRaw(key);
      if (cur !== null) {
        try {
          const parsed: unknown = JSON.parse(cur);
          prev = validate ? (validate(parsed) ?? initial) : (parsed as T);
        } catch {
          prev = initial;
        }
      }
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      writeRaw(key, JSON.stringify(next), flushMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, flushMs],
  );

  return [value, set];
}
