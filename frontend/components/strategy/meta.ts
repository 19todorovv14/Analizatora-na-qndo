"use client";

import useSWR from "swr";

import type { BuilderMeta } from "@/components/strategy/types";
import { fetcher } from "@/lib/api";

// Pure DSL helpers live in ./dsl (unit-tested with node --test); re-exported here for existing imports.
export * from "@/components/strategy/dsl";

/** GET /strategies/meta — public, static per deploy. */
export function useBuilderMeta() {
  return useSWR<BuilderMeta>("/strategies/meta", fetcher, { revalidateOnFocus: false, dedupingInterval: 600_000 });
}
