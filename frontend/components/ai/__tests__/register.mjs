/*
 * Test bootstrap for the S4 AI-teacher unit tests (no extra dependencies — Node's built-in runner):
 *   cd frontend && node --experimental-strip-types --no-warnings --import ./components/ai/__tests__/register.mjs \
 *     --test components/ai/__tests__/*.test.ts
 * Registers hooks.mjs: resolves the "@/…" alias + extension-less imports and transpiles .tsx with the
 * project's own TypeScript (jsx: react-jsx), so presentational components can be rendered with
 * react-dom/server in plain Node.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
