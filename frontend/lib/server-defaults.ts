"use client";

import useSWR from "swr";

import { api } from "@/lib/api";

/**
 * The account's saved UI defaults (GET /settings → settings.app_mode / settings.explain_mode).
 * Used by the explain-mode and workspace providers when this browser has no stored choice yet, so a
 * default chosen in /settings applies on every device. Shares the "/settings" SWR key with the
 * Settings pages (a PUT there + mutate updates the providers too). Never redirects on 401.
 */
export type ServerUiDefaults = { appMode?: "learn" | "trade"; explainMode?: boolean };

type SettingsPayload = { settings?: { app_mode?: unknown; explain_mode?: unknown } };

const settingsFetcher = (path: string) => api<SettingsPayload>(path, { redirectOn401: false });

/** Pure: pick the valid UI defaults out of a GET /settings payload (unknown values → undefined). */
export function uiDefaultsFrom(payload: SettingsPayload | null | undefined): ServerUiDefaults {
  const s = payload?.settings;
  return {
    appMode: s?.app_mode === "learn" || s?.app_mode === "trade" ? s.app_mode : undefined,
    explainMode: typeof s?.explain_mode === "boolean" ? s.explain_mode : undefined,
  };
}

export function useServerUiDefaults(): ServerUiDefaults {
  const { data } = useSWR<SettingsPayload>("/settings", settingsFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 30_000,
  });
  return uiDefaultsFrom(data);
}
