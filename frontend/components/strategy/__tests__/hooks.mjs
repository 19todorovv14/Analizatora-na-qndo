/*
 * Node module-resolution hooks for the S6 unit tests: "@/x" → <frontend>/x and extension-less relative imports →
 * .ts / .tsx / index.ts (the same rules as tsconfig "paths" + moduleResolution "bundler").
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

function withExtension(p) {
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of EXTS) if (existsSync(p + ext)) return p + ext;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(ROOT, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = fileURLToPath(new URL(specifier, context.parentURL));
  }
  if (target) {
    const file = withExtension(target);
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}
