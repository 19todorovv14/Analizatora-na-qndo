/*
 * Node module hooks for the S5 replay unit tests (same as components/terminal/__tests__/hooks.mjs):
 *  - resolve: "@/x" → <frontend>/x and extension-less relative imports → .ts / .tsx / index.ts(x)
 *    (the same rules as tsconfig "paths" + moduleResolution "bundler"); bare subpaths of packages
 *    without an "exports" map (next/link) fall back to CommonJS resolution;
 *  - load: .tsx → ES module JavaScript via typescript.transpileModule (react-jsx runtime).
 * Plain .ts files are left to Node's --experimental-strip-types.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];
const require = createRequire(path.join(ROOT, "package.json"));
let ts = null;

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
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // packages without an "exports" map (e.g. next/link) → CommonJS resolution of the bare subpath
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;
    return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".tsx")) {
    ts ??= require("typescript");
    const source = readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
