"use client";

import { GraduationCap } from "lucide-react";
import { createContext, useCallback, useContext, useMemo } from "react";

import { useStoredState } from "@/components/ui/storage";
import { cx } from "@/lib/format";
import { useServerUiDefaults } from "@/lib/server-defaults";

/**
 * Workspace mode: LEARN (guided, extra hints) vs TRADE (dense paper-trading terminal).
 * Persisted per viewer in localStorage "ta-workspace" (applied right after hydration). When this
 * browser has no stored choice, the account default from /settings (app_mode) applies.
 */
export type WorkspaceMode = "learn" | "trade";

type WorkspaceCtx = {
  mode: WorkspaceMode;
  setMode: (m: WorkspaceMode) => void;
};

const STORAGE_KEY = "ta-workspace";
const DEFAULT_MODE: WorkspaceMode = "learn";
const asMode = (v: unknown): WorkspaceMode | undefined => (v === "learn" || v === "trade" ? v : undefined);

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { appMode } = useServerUiDefaults();
  // null = this browser has no stored choice → the account default (server) applies
  const [stored, setStored] = useStoredState<WorkspaceMode | null>(STORAGE_KEY, null, { validate: asMode });
  const mode = stored ?? appMode ?? DEFAULT_MODE;
  const setMode = useCallback((m: WorkspaceMode) => setStored(m), [setStored]);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: WorkspaceCtx = { mode: DEFAULT_MODE, setMode: () => {} };

/** Current workspace mode. Outside a WorkspaceProvider it is read-only "learn". */
export function useWorkspace(): WorkspaceCtx {
  return useContext(Ctx) ?? FALLBACK;
}

/**
 * Teaching hint that only renders in LEARN mode (hidden in the TRADE workspace).
 * `bare` renders the children without the hint chrome.
 */
export function LearnHint({
  children,
  title,
  className,
  bare,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
  bare?: boolean;
}) {
  const { mode } = useWorkspace();
  if (mode !== "learn") return null;
  if (bare) return <>{children}</>;
  return (
    <div className={cx("flex gap-2.5 rounded-lg border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted", className)}>
      <GraduationCap size={15} strokeWidth={1.75} className="mt-px shrink-0 text-accent2" aria-hidden />
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-semibold text-text">{title}</div>}
        {children}
      </div>
    </div>
  );
}
