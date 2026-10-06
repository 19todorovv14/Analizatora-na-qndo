"use client";

import { SWRConfig, type SWRConfiguration } from "swr";

import { fetcher } from "@/lib/api";
import { ExplainProvider } from "@/lib/explain";
import { WorkspaceProvider } from "@/lib/workspace";

/** Shared SWR defaults for the platform (per-hook options still win). */
const SWR_DEFAULTS: SWRConfiguration = {
  fetcher,
  dedupingInterval: 2000,
  keepPreviousData: true,
  errorRetryCount: 2,
  revalidateOnFocus: false,
};

/** Client providers for every authenticated route: SWR defaults, explain mode, workspace mode. */
export function PlatformProviders({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={SWR_DEFAULTS}>
      <ExplainProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </ExplainProvider>
    </SWRConfig>
  );
}
