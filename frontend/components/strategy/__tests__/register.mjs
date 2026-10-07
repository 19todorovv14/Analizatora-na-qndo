/*
 * Test bootstrap for the S6 pure-logic unit tests (Strategy Builder / Backtesting / Bot Lab) — Node's built-in
 * runner, no extra dependencies:
 *   cd frontend && node --experimental-strip-types --no-warnings --import ./components/strategy/__tests__/register.mjs \
 *     --test components/strategy/__tests__/*.test.ts components/backtest/__tests__/*.test.ts components/bots/__tests__/*.test.ts
 * Registers hooks.mjs, which resolves the "@/…" path alias and extension-less TypeScript imports.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
