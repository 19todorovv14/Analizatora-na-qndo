"use client";

/*
 * Data hooks of the AI Teacher UI (SWR + POST /teacher/ask). SWR keys follow the app convention:
 * API paths without the /api prefix.
 */
import { useCallback, useRef, useState } from "react";
import useSWR from "swr";

import { mergeModes } from "@/components/ai/model";
import type { AskRequest, ModeInfo, StrategyViewData, TeacherAnswerData, TeacherContext } from "@/components/ai/types";
import { fetcher, post } from "@/lib/api";

/** GET /teacher/modes merged over the built-in list (renders instantly, never empty). */
export function useTeacherModes(): ModeInfo[] {
  const { data } = useSWR<ModeInfo[]>("/teacher/modes", fetcher, { revalidateOnFocus: false, dedupingInterval: 10 * 60_000 });
  return mergeModes(Array.isArray(data) ? data : null);
}

/** GET /teacher/context — "What the teacher knows" before an answer exists. Polls every 60 s. */
export function useTeacherContext(symbol: string, timeframe: string, strategyId?: number | null, enabled = true) {
  const key = enabled
    ? `/teacher/context?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}${strategyId ? `&strategy_id=${strategyId}` : ""}`
    : null;
  return useSWR<TeacherContext>(key, fetcher, { refreshInterval: 60_000, revalidateOnFocus: false, keepPreviousData: true });
}

type ViewKey = readonly ["/teacher/strategy-view", string, string, number | null];

const fetchView = ([, symbol, timeframe, strategyId]: ViewKey) =>
  post<StrategyViewData>("/teacher/strategy-view", { symbol, timeframe, ...(strategyId ? { strategy_id: strategyId } : {}) });

/** POST /teacher/strategy-view (closed candles only) — shared/deduped between the chart and the card. */
export function useStrategyView(symbol: string, timeframe: string, strategyId?: number | null, enabled = true) {
  const key: ViewKey | null = enabled && symbol && timeframe ? ["/teacher/strategy-view", symbol, timeframe, strategyId ?? null] : null;
  return useSWR<StrategyViewData, unknown, ViewKey | null>(key, fetchView, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
    errorRetryCount: 1,
  });
}

export type TeacherAskState = {
  answer: TeacherAnswerData | null;
  request: AskRequest | null;
  busy: boolean;
  error: unknown;
};

const IDLE: TeacherAskState = { answer: null, request: null, busy: false, error: null };

/**
 * POST /teacher/ask with "latest request wins" semantics: an answer that arrives after a newer request
 * (or after reset) is dropped, so fast mode switching never shows a stale answer.
 */
export function useTeacherAsk() {
  const [state, setState] = useState<TeacherAskState>(IDLE);
  const seq = useRef(0);

  const ask = useCallback(async (request: AskRequest): Promise<TeacherAnswerData | null> => {
    const id = ++seq.current;
    setState((s) => ({ ...s, request, busy: true, error: null }));
    try {
      const answer = await post<TeacherAnswerData>("/teacher/ask", request);
      if (id === seq.current) setState({ answer, request, busy: false, error: null });
      return answer;
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, busy: false, error }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    seq.current += 1;
    setState(IDLE);
  }, []);

  return { ...state, ask, reset };
}
