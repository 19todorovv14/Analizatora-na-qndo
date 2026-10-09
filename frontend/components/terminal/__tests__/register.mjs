/*
 * Test bootstrap for the S2 terminal unit tests (Node's built-in runner, no extra dependencies):
 *   cd frontend && node --experimental-strip-types --no-warnings --import ./components/terminal/__tests__/register.mjs \
 *     --test components/terminal/__tests__/*.test.ts
 * Registers hooks.mjs: resolves the "@/…" alias + extension-less imports and transpiles .tsx with the
 * project's own TypeScript (jsx: react-jsx), so components can be rendered with react-dom/server.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
