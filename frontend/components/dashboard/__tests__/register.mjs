/*
 * Test bootstrap for the S7 tests (dashboard, analytics, journal, settings) — Node's built-in runner:
 *   cd frontend && node --experimental-strip-types --no-warnings --import ./components/dashboard/__tests__/register.mjs \
 *     --test components/dashboard/__tests__/*.test.ts
 * hooks.mjs resolves "@/…" and extension-less imports and transpiles .tsx with TypeScript.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
