"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

import { useStoredState } from "@/components/ui/storage";

/**
 * Explain mode: when ON, trading terms wrapped in <Term k="…"> get a dotted underline and a
 * WHAT IT IS / WHY IT MATTERS / COMMON MISTAKE card on hover/focus. Persisted per viewer in
 * localStorage "ta-explain" (applied right after hydration — never read during render).
 */
type ExplainCtx = {
  explain: boolean;
  setExplain: (on: boolean) => void;
  toggle: () => void;
};

const STORAGE_KEY = "ta-explain";
const DEFAULT_EXPLAIN = true;

const asBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

const Ctx = createContext<ExplainCtx | null>(null);

export function ExplainProvider({ children }: { children: React.ReactNode }) {
  const [explain, setStored] = useStoredState<boolean>(STORAGE_KEY, DEFAULT_EXPLAIN, { validate: asBool });
  const setExplain = useCallback((on: boolean) => setStored(on), [setStored]);
  const toggle = useCallback(() => setStored((v) => !v), [setStored]);
  const value = useMemo(() => ({ explain, setExplain, toggle }), [explain, setExplain, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: ExplainCtx = { explain: DEFAULT_EXPLAIN, setExplain: () => {}, toggle: () => {} };

/** Explain-mode state. Outside an ExplainProvider (landing, login) it is read-only and ON. */
export function useExplain(): ExplainCtx {
  return useContext(Ctx) ?? FALLBACK;
}

/** Convenience re-export: <Term k="…"> also lives in the design system (`@/components/ui`). */
export { Term } from "@/components/ui/term";
