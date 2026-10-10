/*
 * Wave-3 integration helpers: alias-aware lesson links, command-palette pages (labs reachable),
 * server UI defaults parsing. Run: npm run test:unit -- lib
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NAV, NAV_GROUP_OF, PALETTE_PAGES, activeHref } from "@/components/shell/nav";
import { LESSON_ROUTE_ALIASES, lessonHref, lessonRoute } from "@/lib/lessons";
import { uiDefaultsFrom } from "@/lib/server-defaults";

test("lessonHref: lab-colliding slugs go to their alias routes", () => {
  assert.equal(lessonHref("leverage"), "/learn/leverage-basics");
  assert.equal(lessonHref("market-structure"), "/learn/market-structure-basics");
  assert.equal(lessonHref("rsi"), "/learn/rsi");
  assert.equal(lessonRoute("candlestick"), "candlestick");
});

test("lessonHref: the API href wins when present", () => {
  assert.equal(lessonHref("leverage", "/learn/leverage-basics"), "/learn/leverage-basics");
  assert.equal(lessonHref("x", null), "/learn/x");
  assert.equal(lessonHref("x", ""), "/learn/x");
});

test("no lesson link can land on a lab page", () => {
  const labRoutes = ["/learn/leverage", "/learn/market-structure", "/learn/candlesticks"];
  for (const slug of [...Object.keys(LESSON_ROUTE_ALIASES), "candlesticks-intro", "rsi"]) {
    assert.ok(!labRoutes.includes(lessonHref(slug)), `${slug} → ${lessonHref(slug)}`);
  }
});

test("command palette offers every nav page plus the Academy labs", () => {
  const hrefs = PALETTE_PAGES.map((p) => p.href);
  for (const n of NAV) assert.ok(hrefs.includes(n.href), n.href);
  for (const lab of ["/learn/candlesticks", "/learn/market-structure", "/learn/leverage", "/simulator"]) {
    assert.ok(hrefs.includes(lab), `${lab} missing from the palette`);
  }
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate palette pages");
  for (const href of ["/learn/candlesticks", "/learn/market-structure", "/learn/leverage"]) {
    assert.equal(NAV_GROUP_OF[href]?.key, "learn");
    // the sidebar highlights Academy on the labs
    assert.equal(activeHref(href), "/learn");
  }
});

test("uiDefaultsFrom keeps only valid server values", () => {
  assert.deepEqual(uiDefaultsFrom({ settings: { app_mode: "trade", explain_mode: false } }), { appMode: "trade", explainMode: false });
  assert.deepEqual(uiDefaultsFrom({ settings: { app_mode: "pro", explain_mode: "yes" } }), { appMode: undefined, explainMode: undefined });
  assert.deepEqual(uiDefaultsFrom(undefined), { appMode: undefined, explainMode: undefined });
});

test("lesson links are built with lessonHref (no raw /learn/${slug} templates)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !p.endsWith(join("lib", "lessons.ts"))) {
        const src = readFileSync(p, "utf8");
        // a template literal that appends a variable straight after /learn/ (quiz URLs are fine)
        for (const m of src.matchAll(/`\/learn\/\$\{/g)) offenders.push(`${p.slice(root.length)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  assert.deepEqual(offenders, [], "use lessonHref() from @/lib/lessons");
});

test("every palette page has a route file", async () => {
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const appDir = fileURLToPath(new URL("../../app/(platform)", import.meta.url));
  for (const p of PALETTE_PAGES) assert.ok(existsSync(`${appDir}${p.href}/page.tsx`), `no page for ${p.href}`);
});
