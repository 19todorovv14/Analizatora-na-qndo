"use client";

/*
 * State machine of the /replay page: setup → active session → review. One request at a time (busy ref),
 * auto-play, toasts for resolved predictions and warning flags, the address bar keeps ?session=<id> so a
 * reload resumes the session (or reopens its stored review).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  INDICATORS_QUERY,
  buildCreateBody,
  flagToasts,
  mergeState,
  normalizeFinish,
  normalizeStored,
  resolvedToast,
  sessionUrl,
  type ToastSpec,
} from "@/components/replay/model";
import type {
  DecisionPreview,
  DecisionResponse,
  FinishResponse,
  OrderResponse,
  ReplayAction,
  ReplaySetupValues,
  ReplayState,
  ReviewData,
  StoredReviewResponse,
} from "@/components/replay/types";
import { ApiError, errorMessage, errorReason, fetcher, isDataNotAvailable, post } from "@/lib/api";
import type { RiskFinding } from "@/lib/types";

export type ReplayError = { message: string; unavailable: boolean; reason: string | null };

export type DecisionRequest = {
  action: ReplayAction;
  stop?: number | null;
  target?: number | null;
  note?: string | null;
  place_order?: boolean;
  risk_pct?: number | null;
};

export type OrderRequest = { side: "buy" | "sell"; qty: number; stop_loss?: number | null; take_profit?: number | null };

const TOAST_MS = 5200;

function toError(e: unknown): ReplayError {
  const unavailable = isDataNotAvailable(e) || (e instanceof ApiError && e.status === 503);
  return { message: errorMessage(e), unavailable, reason: unavailable ? errorReason(e) : null };
}

function replaceUrl(url: string) {
  try {
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  } catch {
    /* history unavailable (tests) */
  }
}

export type Toast = ToastSpec & { at: number };

export function useToastQueue(ms = TOAST_MS) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);
  const push = useCallback(
    (items: ToastSpec[]) => {
      if (!items.length) return;
      const now = Date.now();
      setToasts((t) => [...t.filter((x) => !items.some((i) => i.id === x.id)), ...items.map((i) => ({ ...i, at: now }))].slice(-4));
      for (const i of items) {
        const old = timers.current.get(i.id);
        if (old) clearTimeout(old);
        timers.current.set(
          i.id,
          setTimeout(() => dismiss(i.id), ms),
        );
      }
    },
    [dismiss, ms],
  );
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  return { toasts, push, dismiss };
}

export function useReplaySession() {
  const [state, setState] = useState<ReplayState | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [error, setError] = useState<ReplayError | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(900);
  const [findings, setFindings] = useState<RiskFinding[]>([]);
  const busyRef = useRef(false);
  const toastQ = useToastQueue();
  const { push } = toastQ;

  const call = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(toError(e));
      setAuto(false);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const apply = useCallback((next: ReplayState) => {
    setState((prev) => mergeState(prev, next));
    if (next.session.status !== "active") setAuto(false);
  }, []);

  const start = useCallback(
    async (setup: ReplaySetupValues) => {
      const s = await call(async () => {
        const created = await post<ReplayState>("/replay", buildCreateBody(setup));
        // POST /replay has no ?indicators — read the state once more with the EMA overlay (best effort)
        try {
          return await fetcher<ReplayState>(`/replay/${created.session.id}?indicators=${INDICATORS_QUERY}`);
        } catch {
          return created;
        }
      });
      if (!s) return null;
      setReview(null);
      setFindings([]);
      setState(s);
      replaceUrl(sessionUrl(s.session.id));
      return s;
    },
    [call],
  );

  const open = useCallback(
    async (id: number, finished?: boolean) => {
      setOpening(true);
      try {
        const loadReview = async () => {
          const r = await call(() => fetcher<StoredReviewResponse>(`/replay/${id}/review`));
          if (!r) return false;
          setState(null);
          setReview(normalizeStored(r));
          replaceUrl(sessionUrl(id));
          return true;
        };
        if (finished && (await loadReview())) return;
        const s = await call(() => fetcher<ReplayState>(`/replay/${id}?indicators=${INDICATORS_QUERY}`));
        if (!s) return;
        if (s.session.status !== "active" && s.session.has_review !== false) {
          if (await loadReview()) return;
        }
        setReview(null);
        setFindings([]);
        setState(s);
        replaceUrl(sessionUrl(id));
      } finally {
        setOpening(false);
      }
    },
    [call],
  );

  const sid = state?.session.id ?? null;

  const step = useCallback(
    async (n: number) => {
      if (!sid) return null;
      const s = await call(() => post<ReplayState>(`/replay/${sid}/step?indicators=${INDICATORS_QUERY}`, { n }));
      if (!s) return null;
      apply(s);
      if (s.resolved?.length) push(s.resolved.map((r) => resolvedToast(r)));
      return s;
    },
    [sid, call, apply, push],
  );

  const decide = useCallback(
    async (req: DecisionRequest) => {
      if (!sid) return null;
      const body: Record<string, unknown> = { action: req.action };
      if (req.action !== "wait") {
        body.stop = req.stop ?? null;
        if (req.target) body.target = req.target;
        if (req.place_order) body.place_order = true;
        if (req.risk_pct) body.risk_pct = req.risk_pct;
      }
      if (req.note?.trim()) body.note = req.note.trim().slice(0, 300);
      const r = await call(() => post<DecisionResponse>(`/replay/${sid}/decision?indicators=${INDICATORS_QUERY}`, body));
      if (!r) return null;
      apply(r);
      setFindings(r.findings ?? []);
      const d = r.decision;
      const toasts = flagToasts(d.flags ?? [], `d${d.id ?? d.bar_ts}`);
      if (r.order) toasts.unshift({ id: `ord-${r.order.id}`, tone: "info", title: "Paper поръчка изпратена", text: "Изпълнява се на OPEN на следващата свещ." });
      push(toasts);
      return r;
    },
    [sid, call, apply, push],
  );

  const order = useCallback(
    async (req: OrderRequest) => {
      if (!sid) return null;
      const body: Record<string, unknown> = { side: req.side, qty: req.qty };
      if (req.stop_loss) body.stop_loss = req.stop_loss;
      if (req.take_profit) body.take_profit = req.take_profit;
      const r = await call(() => post<OrderResponse>(`/replay/${sid}/order`, body));
      if (!r) return null;
      apply(r);
      setFindings(r.findings ?? []);
      return r;
    },
    [sid, call, apply],
  );

  const action = useCallback(
    async (kind: "close" | "cancel", id: string) => {
      if (!sid) return null;
      const body = kind === "close" ? { kind, position_id: id } : { kind, order_id: id };
      const r = await call(() => post<ReplayState>(`/replay/${sid}/action`, body));
      if (r) apply(r);
      return r;
    },
    [sid, call, apply],
  );

  const finish = useCallback(async () => {
    if (!sid) return null;
    setAuto(false);
    const r = await call(() => post<FinishResponse>(`/replay/${sid}/finish`));
    if (!r) return null;
    setState(r);
    setReview(normalizeFinish(r));
    replaceUrl(sessionUrl(r.session.id));
    return r;
  }, [sid, call]);

  const reset = useCallback(() => {
    setAuto(false);
    setState(null);
    setReview(null);
    setError(null);
    setFindings([]);
    replaceUrl(sessionUrl(null));
  }, []);

  // auto-play: one candle per tick, skipped while a request is in flight
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const active = state?.session.status === "active";
  useEffect(() => {
    if (!auto || !active) return;
    const id = setInterval(() => {
      if (!busyRef.current) void stepRef.current(1);
    }, speed);
    return () => clearInterval(id);
  }, [auto, active, speed]);

  return {
    state,
    review,
    error,
    setError,
    busy,
    opening,
    auto,
    setAuto,
    speed,
    setSpeed,
    findings,
    toasts: toastQ.toasts,
    dismissToast: toastQ.dismiss,
    pushToasts: push,
    start,
    open,
    step,
    decide,
    order,
    action,
    finish,
    reset,
  };
}

export type ReplaySessionApi = ReturnType<typeof useReplaySession>;

/**
 * Debounced POST /replay/{sid}/decision {preview:true}: live planned R:R, flags and score components of the
 * draft — nothing is recorded. Stale answers (older cursor / levels) are dropped.
 */
export function useDecisionPreview(
  sid: number | null,
  cursor: number | null,
  draft: { action: ReplayAction | null; stop: number | null; target: number | null; valid: boolean },
  delayMs = 350,
) {
  const [result, setResult] = useState<{ key: string; preview: DecisionPreview["decision"] | null; error: string | null } | null>(null);
  const key = sid && cursor && draft.action && draft.action !== "wait" && draft.valid ? `${sid}|${cursor}|${draft.action}|${draft.stop}|${draft.target}` : null;
  useEffect(() => {
    if (!key || !sid || !draft.action) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const body: Record<string, unknown> = { action: draft.action, stop: draft.stop, preview: true };
        if (draft.target) body.target = draft.target;
        const r = await post<DecisionPreview>(`/replay/${sid}/decision`, body);
        if (!cancelled) setResult({ key, preview: r.decision, error: null });
      } catch (e) {
        if (!cancelled) setResult({ key, preview: null, error: errorMessage(e) });
      }
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, sid, draft.action, draft.stop, draft.target, delayMs]);
  if (!key || !result || result.key !== key) return { preview: null, error: null, loading: !!key };
  return { preview: result.preview, error: result.error, loading: false };
}
