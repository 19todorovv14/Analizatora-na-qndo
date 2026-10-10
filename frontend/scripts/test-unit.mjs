// Runs every frontend unit-test suite (components/**/__tests__/*.test.ts) with Node's test runner.
// Each suite uses the register.mjs next to it (path aliases, stubs); suites without one use the
// strategy suite's register. Usage: npm run test:unit [-- <suite name filter>]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fallbackRegister = join(root, "components/strategy/__tests__/register.mjs");
const filter = process.argv[2];

function findSuites(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    if (name === "__tests__") out.push(p);
    else findSuites(p, out);
  }
  return out;
}

const suites = ["components", "lib", "app"]
  .map((d) => join(root, d))
  .filter(existsSync)
  .flatMap((d) => findSuites(d))
  .sort()
  .filter((d) => !filter || d.includes(filter));

let failed = 0;
for (const dir of suites) {
  const tests = readdirSync(dir).filter((f) => f.endsWith(".test.ts")).map((f) => join(dir, f));
  if (!tests.length) continue;
  const own = join(dir, "register.mjs");
  const register = existsSync(own) ? own : fallbackRegister;
  console.log(`\n▶ ${relative(root, dir)} (${tests.length} files)`);
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", register, "--test", ...tests],
    { cwd: root, stdio: "inherit" },
  );
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\n✖ ${failed} suite(s) failed` : `\n✔ all ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
