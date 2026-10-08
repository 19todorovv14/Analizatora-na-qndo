/*
 * Test bootstrap for the S3b labs pure-logic unit tests (no extra dependencies — Node's built-in runner):
 *   cd frontend && node --experimental-strip-types --no-warnings --import ./components/labs/__tests__/register.mjs \
 *     --test components/labs/__tests__/*.test.ts
 * Registers hooks.mjs, which resolves the "@/…" path alias and extension-less TypeScript imports.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
