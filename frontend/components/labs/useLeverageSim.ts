"use client";

/*
 * SWR hook for POST /learn/leverage/simulate (public, pure maths). The key is the JSON body, so equal inputs
 * share one request; the previous result stays on screen while a new one loads (no flash while a slider moves).
 */
import useSWR from "swr";

import type { LeverageRequest, LeverageResult } from "@/components/labs/types";
import { post } from "@/lib/api";

export const SIMULATE_PATH = "/learn/leverage/simulate";

const simulateFetcher = ([path, body]: [string, string]) => post<LeverageResult>(path, JSON.parse(body));

export function useLeverageSim(body: LeverageRequest | null) {
  return useSWR<LeverageResult, unknown, [string, string] | null>(body ? [SIMULATE_PATH, JSON.stringify(body)] : null, simulateFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });
}
