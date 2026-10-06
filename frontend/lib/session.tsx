"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, patch, post } from "@/lib/api";
import type { User } from "@/lib/types";

type SessionCtx = {
  user: User | null;
  loading: boolean;
  beginner: boolean;
  refresh: () => Promise<void>;
  /** Optimistic: the UI switches immediately; rolls back if the server rejects the change. Never throws. */
  setMode: (mode: "beginner" | "advanced") => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  // last mode confirmed by the server + a sequence number so only the newest request wins
  const confirmedMode = useRef<User["mode"] | null>(null);
  const modeSeq = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me", { redirectOn401: false });
      confirmedMode.current = me.mode;
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<User>("/auth/me", { redirectOn401: false })
      .then((me) => {
        confirmedMode.current = me.mode;
        setUser(me);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const setMode = useCallback(async (mode: "beginner" | "advanced") => {
    const seq = ++modeSeq.current;
    setUser((u) => (u && u.mode !== mode ? { ...u, mode } : u));
    try {
      const updated = await patch<User>("/auth/me", { mode });
      confirmedMode.current = updated.mode;
      if (seq === modeSeq.current) setUser(updated);
    } catch (e) {
      if (seq !== modeSeq.current) return; // a newer change is in flight — it decides the final state
      const back = confirmedMode.current;
      setUser((u) => (u && back && u.mode !== back ? { ...u, mode: back } : u));
      if (process.env.NODE_ENV !== "production") console.warn("Mode change failed, rolled back:", e);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {
      /* the session may already be gone — leave anyway */
    }
    setUser(null);
    router.push("/");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, beginner: (user?.mode ?? "beginner") === "beginner", refresh, setMode, logout }),
    [user, loading, refresh, setMode, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}

/** Start a one-click demo session (fresh isolated guest profile with $10,000 virtual). */
export async function startGuest(): Promise<void> {
  await post("/auth/guest");
}
