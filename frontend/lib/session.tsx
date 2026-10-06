"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, patch, post } from "@/lib/api";
import type { User } from "@/lib/types";

type SessionCtx = {
  user: User | null;
  loading: boolean;
  beginner: boolean;
  refresh: () => Promise<void>;
  setMode: (mode: "beginner" | "advanced") => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      setUser(await api<User>("/auth/me", { redirectOn401: false }));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<User>("/auth/me", { redirectOn401: false })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const setMode = useCallback(async (mode: "beginner" | "advanced") => {
    setUser(await patch<User>("/auth/me", { mode }));
  }, []);

  const logout = useCallback(async () => {
    await post("/auth/logout");
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
