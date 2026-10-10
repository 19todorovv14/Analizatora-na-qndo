#!/usr/bin/env node
/*
 * Trading Academy — end-to-end walkthrough (Playwright + Chromium, plain Node).
 *
 * Starts as a guest from the landing page and drives every main page with a real interaction:
 * search, asset page, chart tools, academy + labs, paper trading (virtual money only), AI teacher,
 * replay, strategy builder, backtest, paper bot, journal, analytics, settings, command palette and
 * the shortcuts help. Ends with a mobile (390×844) pass over the key pages.
 *
 * Env: BASE_URL (default http://localhost:3000), SHOTS_DIR (default ./shots), HEADLESS (default true;
 *      HEADLESS=0 shows the browser), STEP_TIMEOUT ms (default 20000).
 * Output: "OK  <step>" / "FAIL <step> <reason>" per step, a screenshot per step (FAIL-<step>.png +
 * FAIL-<step>.aria.txt on failure), then the console errors, page errors and failed /api responses.
 * Exit code 1 when a step failed or an unexpected error was collected.
 *
 * `playwright` is loaded with require() so NODE_PATH works too (ESM imports ignore NODE_PATH).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const SHOTS_DIR = path.resolve(process.env.SHOTS_DIR || "./shots");
const HEADLESS = !/^(0|false|no)$/i.test(process.env.HEADLESS ?? "true");
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT || 20000);

fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = []; // { name, ok, reason }
const problems = []; // unexpected console errors, page errors, failed API responses
let loggedIn = false; // a 401 from /api/auth/* is expected only before the guest login
let shotNo = 0;

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

function attachCollectors(page) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // the browser logs every non-2xx resource; those are judged by the response listener below
    if (/^Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    problems.push(`[console] ${page.url()} ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()} ${String(e.message || e).slice(0, 300)}`));
  page.on("response", (r) => {
    const url = r.url();
    if (!url.includes("/api/")) return;
    const st = r.status();
    if (st < 400) return;
    if (st === 401 && !loggedIn) return; // expected: session probe before the guest login
    problems.push(`[http ${st}] ${r.request().method()} ${url.replace(BASE_URL, "")}`);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "bg-BG" });
  context.setDefaultTimeout(STEP_TIMEOUT);
  const page = await context.newPage();
  attachCollectors(page);

  const go = async (p) => {
    await page.goto(BASE_URL + p, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  };
  const main = () => page.getByRole("main");
  const shot = async (name) => {
    await page.waitForTimeout(500);
    shotNo += 1;
    await page.screenshot({ path: path.join(SHOTS_DIR, `${String(shotNo).padStart(2, "0")}-${slug(name)}.png`) });
  };
  const noHorizontalOverflow = async (label) => {
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (sw > iw + 1) throw new Error(`${label}: horizontal page overflow (${sw}px > ${iw}px)`);
  };

  async function step(name, fn, { fatal = false } = {}) {
    try {
      await fn();
      await shot(name);
      results.push({ name, ok: true });
      console.log(`OK   ${name}`);
    } catch (e) {
      const reason = String(e?.message || e).split("\n")[0];
      results.push({ name, ok: false, reason });
      console.log(`FAIL ${name} ${reason}`);
      try {
        await page.screenshot({ path: path.join(SHOTS_DIR, `FAIL-${slug(name)}.png`) });
        fs.writeFileSync(path.join(SHOTS_DIR, `FAIL-${slug(name)}.aria.txt`), await page.locator("body").ariaSnapshot({ timeout: 5000 }));
      } catch {
        /* the page may be gone */
      }
      if (fatal) throw new Error(`fatal step failed: ${name}`);
    }
  }

  /* ───────────────────────────── 1. landing → guest */
  await step(
    "landing",
    async () => {
      await go("/");
      await page.getByRole("heading", { level: 1, name: "Learn trading. Practice without risking real money." }).waitFor();
      await page.getByRole("button", { name: "START LEARNING" }).waitFor();
    },
    { fatal: true },
  );

  await step(
    "guest start (START LEARNING)",
    async () => {
      await page.getByRole("button", { name: "START LEARNING" }).click();
      await page.waitForURL("**/learn");
      loggedIn = true;
      await page.getByRole("heading", { level: 1, name: "Trading Academy" }).waitFor();
    },
    { fatal: true },
  );

  /* ───────────────────────────── 2. dashboard (+ guided tour) */
  await step("dashboard + guided tour", async () => {
    await go("/dashboard");
    const tour = page.getByRole("dialog", { name: "Добре дошъл в Trading Academy" });
    await tour.waitFor();
    await tour.getByRole("button", { name: "Пропусни" }).click();
    await tour.waitFor({ state: "detached" });
    await main().getByRole("heading", { level: 2, name: "Paper account" }).waitFor();
    await main().getByRole("heading", { level: 2, name: "Watchlist" }).waitFor();
    await main().getByRole("heading", { level: 2, name: "Learning progress" }).waitFor();
  });

  /* ───────────────────────────── 3. search: '/' palette → TSLA */
  await step("search palette '/' → tesla → TSLA", async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("/");
    const dlg = page.getByRole("dialog", { name: "Търсене" });
    await dlg.waitFor();
    await dlg.getByRole("combobox", { name: "Търси актив, урок или страница" }).fill("tesla");
    const opt = dlg.getByRole("option", { name: /TSLA/ }).first();
    await opt.waitFor();
    await opt.click();
    await page.waitForURL(/\/markets\/TSLA/);
    await main().getByRole("heading", { level: 1, name: /Tesla/ }).waitFor();
    await main().locator("canvas").first().waitFor();
  });

  /* ───────────────────────────── 4. markets + in-page search */
  await step("markets: class tab + search", async () => {
    await go("/markets");
    await main().getByRole("heading", { level: 1, name: "Markets" }).waitFor();
    await main().getByRole("tab", { name: /^Crypto/ }).click();
    await main().getByRole("tab", { name: /^Crypto/, selected: true }).waitFor();
    const search = main().getByRole("combobox", { name: "Търси инструмент на пазара" });
    await search.fill("ethereum");
    const opt = page.getByRole("option", { name: /ETH\/USDT/ }).first();
    await opt.waitFor();
    await opt.click();
    await page.waitForURL(/\/markets\/ETH-USDT/);
  });

  /* ───────────────────────────── 5. asset page */
  await step("asset page /markets/BTC-USDT: quote + chart", async () => {
    await go("/markets/BTC-USDT");
    const overview = main().getByRole("region", { name: "Обзор на актива" });
    await overview.getByRole("heading", { level: 1, name: "Bitcoin" }).waitFor();
    await overview.getByText(/\d{2,3},\d{3}\.\d{2}/).first().waitFor();
    await main().getByRole("heading", { level: 2, name: "Chart" }).waitFor();
    await main().locator("canvas").first().waitFor();
    await main().getByRole("group", { name: "Timeframe" }).getByRole("button", { name: "1D", exact: true }).click();
    await main().getByRole("group", { name: "Timeframe" }).getByRole("button", { name: "1D", exact: true, pressed: true }).waitFor();
  });

  /* ───────────────────────────── 6. watchlist */
  await step("watchlist: add instrument", async () => {
    await go("/watchlist");
    await main().getByRole("heading", { level: 1, name: "Watchlist" }).waitFor();
    const add = main().getByRole("combobox", { name: "Добави инструмент в watchlist" });
    await add.fill("AAPL");
    const opt = page.getByRole("option", { name: /AAPL/ }).first();
    await opt.waitFor();
    await opt.click();
    await main().getByRole("button", { name: "Премахни AAPL" }).waitFor();
  });

  /* ───────────────────────────── 7. chart terminal */
  await step("charts: timeframe 4H", async () => {
    await go("/charts");
    await main().locator("canvas").first().waitFor();
    const tf = main().getByRole("group", { name: "Timeframe" });
    await tf.getByRole("button", { name: "4H", exact: true }).click();
    await tf.getByRole("button", { name: "4H", exact: true, pressed: true }).waitFor();
    await page.waitForTimeout(800);
  });

  await step("charts: add MACD indicator", async () => {
    await main().getByRole("button", { name: /^Indicators/ }).click();
    const item = page.getByRole("button", { name: /^MACD/ }).or(page.getByRole("checkbox", { name: /MACD/ })).or(page.getByRole("menuitemcheckbox", { name: /MACD/ }));
    await item.first().click();
    await page.keyboard.press("Escape");
    await main().getByRole("button", { name: /^Indicators 4/ }).waitFor();
  });

  await step("charts: draw horizontal line", async () => {
    const tools = main().getByRole("toolbar", { name: "Инструменти за чертане" });
    await tools.getByRole("button", { name: "Horizontal line" }).click();
    const box = await main().locator("canvas").first().boundingBox();
    if (!box) throw new Error("chart canvas not visible");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await tools.getByRole("button", { name: "Cursor" }).click();
    await tools.getByRole("button", { name: "Изчисти всички рисунки" }).waitFor();
  });

  await step("charts: compare timeframes", async () => {
    await main().getByRole("button", { name: "Compare TFs" }).click();
    await page.waitForTimeout(1500);
    await main().locator("canvas").nth(1).waitFor();
  });

  /* ───────────────────────────── 8. academy */
  await step("learn: path → lesson → complete (+XP)", async () => {
    await go("/learn");
    await main().getByRole("heading", { level: 2, name: /Learning path/ }).waitFor();
    await noHorizontalOverflow("/learn 1280");
    await main().getByRole("link", { name: /01 Какво е financial market\?/ }).click();
    await page.waitForURL(/\/learn\/[a-z0-9-]+$/);
    await main().getByRole("button", { name: "Маркирай като завършен" }).click();
    await page.getByRole("status").filter({ hasText: /XP!/ }).waitFor();
  });

  await step("learn: level 0 quiz", async () => {
    await go("/learn/quiz/level0");
    await main().getByRole("heading", { level: 1 }).first().waitFor();
    const groups = main().getByRole("radiogroup");
    const n = await groups.count();
    if (!n) throw new Error("no quiz questions");
    for (let i = 0; i < n; i++) await groups.nth(i).getByRole("radio").first().check();
    await main().getByRole("button", { name: /Предай/ }).click();
    await main().getByText(/верни/).first().waitFor();
  });

  await step("candlestick lab: open pattern", async () => {
    await go("/learn/candlesticks");
    await main().getByRole("heading", { level: 1, name: "Candlestick Lab" }).waitFor();
    await main().getByRole("button", { name: /^Hammer — / }).click();
    await page.getByRole("region", { name: "Интерактивна свещ" }).waitFor();
  });

  await step("candlestick lab: practice round", async () => {
    await page.getByRole("button", { name: /Practice: 10 рунда/ }).first().click();
    await main().getByRole("button", { name: "Започни" }).click();
    await main().getByText(/Рунд 1 \/ \d+/).waitFor();
    for (let i = 0; i < 12; i++) {
      const submit = main().getByRole("button", { name: /^Предай/ });
      if (await submit.isVisible()) break;
      await main().locator("button[aria-pressed]").first().click();
      await main().getByRole("button", { name: "Напред" }).click();
    }
    await main().locator("button[aria-pressed]").first().click();
    await main().getByRole("button", { name: /^Предай/ }).click();
    await main().getByText("Резултат").first().waitFor();
  });

  await step("leverage simulator: 50x → liquidation + warning", async () => {
    await go("/learn/leverage");
    await main().getByRole("heading", { level: 2, name: "Leverage симулатор" }).waitFor();
    await main().getByRole("group", { name: "Какво въвеждаш" }).getByRole("button", { name: "Margin" }).click();
    await main().getByRole("group", { name: "Leverage" }).getByRole("button", { name: "50x", exact: true }).click();
    await main().getByRole("group", { name: "Leverage" }).getByRole("button", { name: "50x", exact: true, pressed: true }).waitFor();
    await main().getByText(/Ликвидационна цена/).first().waitFor();
    await main().getByText("WARNING").first().waitFor();
  });

  await step("market structure lab: mark + check", async () => {
    await go("/learn/market-structure");
    await main().getByRole("heading", { level: 1, name: "Market Structure Lab" }).waitFor();
    await main().getByRole("button", { name: "Higher High" }).click();
    const canvas = main().locator("canvas").first();
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("structure chart not visible");
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
    await main().getByRole("list", { name: "Поставени етикети" }).waitFor();
    await main().getByRole("button", { name: "Провери" }).click();
    await main().getByRole("region", { name: "Твоите етикети" }).waitFor();
  });

  await step("trade simulator", async () => {
    await go("/simulator");
    await main().getByRole("heading", { level: 1, name: "Trade Simulator" }).waitFor();
    await main().getByRole("button", { name: "Примерни нива" }).click().catch(() => {});
    await main().getByRole("heading", { level: 2, name: /Сценарии/ }).waitFor();
  });

  /* ───────────────────────────── 9. paper trading */
  await step("trade: SL/TP + paper market order filled", async () => {
    await go("/trade");
    const ticket = page.getByRole("complementary", { name: "Paper trading" });
    await ticket.getByRole("heading", { name: "Order panel" }).waitFor();
    await ticket.getByRole("button", { name: "Стоп 1%" }).click();
    await ticket.getByRole("button", { name: "Цел 2R" }).click();
    const sl = await ticket.getByRole("textbox", { name: "Stop Loss" }).inputValue();
    const tp = await ticket.getByRole("textbox", { name: "Take Profit" }).inputValue();
    if (!sl || !tp) throw new Error(`SL/TP not set (sl=${sl}, tp=${tp})`);
    await ticket.getByRole("button", { name: /^BUY \/ LONG .*virtual/ }).click();
    await ticket.getByText("Поръчката е filled").waitFor();
    await main().getByRole("button", { name: /^Positions 1/ }).waitFor();
  });

  await step("trade: Explain this setup + WHY?", async () => {
    const ai = page.getByRole("region", { name: "AI анализ" });
    await ai.getByRole("button", { name: "Explain this setup" }).click();
    await ai.getByText("INVALIDATION").first().waitFor({ timeout: 30000 });
    await ai.getByRole("tab", { name: "WHY?" }).click();
    await ai.getByRole("tab", { name: "WHY?", selected: true }).waitFor();
    await page.waitForTimeout(1500);
  });

  await step("trade: close the position", async () => {
    const pos = main().getByRole("region", { name: "Позиции, поръчки и история" });
    await pos.getByRole("button", { name: /^Positions/ }).click();
    await pos.getByRole("button", { name: "Close", exact: true }).first().click();
    await main().getByRole("button", { name: /^Positions 0/ }).waitFor();
    await pos.getByRole("button", { name: /^History/ }).click();
    await pos.getByRole("button", { name: "AI review" }).first().waitFor();
  });

  /* ───────────────────────────── 10. AI teacher */
  await step("AI teacher: analyze + WHY?", async () => {
    await go("/ai");
    await main().getByRole("heading", { level: 1, name: "AI Trading Teacher" }).waitFor();
    await main().getByRole("button", { name: /^ANALYZE · / }).click();
    await main().getByText("INVALIDATION").first().waitFor({ timeout: 30000 });
    await main().getByRole("button", { name: /^WHY\? / }).click();
    await main().getByRole("button", { name: /^WHY\? · / }).click();
    await page.waitForTimeout(2000);
  });

  /* ───────────────────────────── 11. replay */
  await step("replay: start → decision → next candle → finish → review", async () => {
    await go("/replay");
    await main().getByRole("heading", { level: 1, name: "Market Replay" }).waitFor();
    await main().getByRole("button", { name: "Start replay" }).click();
    const next = main().getByRole("button", { name: /Next candle/ });
    await next.waitFor({ timeout: 30000 });
    const decision = main().getByRole("region", { name: "Решение на текущата свещ" });
    await decision.getByRole("group", { name: "Посока" }).getByRole("button", { name: /LONG/ }).click();
    await decision.getByRole("button", { name: /^Запиши LONG/ }).click();
    await page.waitForTimeout(800);
    await next.click();
    await page.waitForTimeout(800);
    await main().getByRole("button", { name: /Finish \+ AI review/ }).click();
    await main().getByRole("heading", { name: "Replay review" }).waitFor({ timeout: 30000 });
  });

  /* ───────────────────────────── 12. strategies → backtest → bot */
  await step("strategy builder: template + check signal", async () => {
    await go("/strategies");
    await main().getByRole("heading", { level: 1, name: "Strategy Builder" }).waitFor();
    await main().getByRole("button", { name: "Шаблони" }).click();
    const card = main()
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: /EMA 20\/50 crossover с филтър EMA 200/ }) })
      .first();
    await card.getByRole("button", { name: "Copy & edit" }).click();
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === "Име" || i.labels?.[0]?.textContent?.trim() === "Име");
      return !!el && /EMA 20\/50/.test(el.value);
    });
    await main().getByRole("button", { name: "Check current signal" }).click();
    await main().getByText(/затворена свещ/).first().waitFor();
    await main().getByText("This is a rule-based hypothetical setup, not a guarantee of future price movement.").first().waitFor();
  });

  await step("backtest: run → metrics + validation", async () => {
    await go("/backtesting");
    await main().getByRole("heading", { level: 1, name: "Backtesting Lab" }).waitFor();
    await main().getByRole("button", { name: "Run backtest" }).click();
    await main().getByText(/Strategy validation/i).first().waitFor({ timeout: 90000 });
  });

  await step("bot lab: create paper bot → start", async () => {
    await go("/bots");
    await main().getByRole("heading", { level: 1, name: "Bot Lab" }).waitFor();
    await main().getByRole("button", { name: "Create paper bot" }).click();
    await page.waitForURL(/\/bots\/\d+/, { timeout: 30000 });
    await main().getByRole("button", { name: /▶ Start/ }).click();
    await main().getByText("RUNNING", { exact: true }).first().waitFor();
  });

  /* ───────────────────────────── 13. journal + analytics */
  await step("journal: add entry", async () => {
    await go("/journal");
    await main().getByRole("heading", { level: 1, name: "Trading Journal" }).waitFor();
    await main().getByRole("button", { name: "Нов запис" }).click();
    const dlg = page.getByRole("dialog", { name: "Нов запис в журнала" });
    await dlg.waitFor();
    await dlg.getByRole("textbox", { name: "Symbol" }).fill("BTC/USDT");
    await dlg.getByRole("textbox", { name: "Reason (защо влезе?)" }).fill("E2E: pullback към EMA 20, stop под последния swing low.");
    await dlg.getByRole("button", { name: "Добави в журнала" }).click();
    await dlg.waitFor({ state: "detached" });
    await main().getByRole("heading", { level: 2, name: /Entries \(1\)/ }).waitFor();
  });

  await step("statistics renders", async () => {
    await go("/stats");
    await main().getByRole("heading", { level: 1, name: "Statistics" }).waitFor();
    await main().getByRole("heading", { level: 2, name: /WEEKLY REVIEW/ }).waitFor();
  });

  await step("performance renders", async () => {
    await go("/performance");
    await main().getByRole("heading", { level: 1, name: "Performance" }).waitFor();
    await main().getByRole("button", { name: "Всички" }).click();
  });

  await step("risk: position size calculator", async () => {
    await go("/risk");
    await main().getByRole("heading", { level: 2, name: "Position Size Calculator" }).waitFor();
    await main().getByRole("textbox", { name: "Stop loss" }).fill("97");
    await main().getByRole("textbox", { name: "Risk %", exact: true }).fill("0.5");
    await main().getByText(/0\.50%/).first().waitFor();
    await main().getByRole("heading", { level: 2, name: "Risk rules" }).waitFor();
  });

  await step("challenges: start", async () => {
    await go("/challenges");
    await main().getByRole("heading", { level: 2, name: "Identify trend" }).waitFor();
    await main().getByRole("button", { name: "Start" }).first().click();
    await page.waitForTimeout(1000);
  });

  /* ───────────────────────────── 14. settings */
  await step("settings renders", async () => {
    await go("/settings");
    await main().getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    await main().getByRole("heading", { level: 2, name: /Simulation realism/ }).waitFor();
  });

  await step("settings: data sources", async () => {
    await go("/settings/data-sources");
    await main().getByRole("heading", { level: 1, name: "Data Sources" }).waitFor();
    await main().getByRole("button", { name: "Провери връзката" }).click();
    await page.waitForTimeout(1500);
  });

  await step("settings: AI settings", async () => {
    await go("/settings/ai");
    await main().getByRole("heading", { level: 1, name: "AI Settings" }).waitFor();
    await main().getByRole("heading", { level: 2, name: "Предпазни правила" }).waitFor();
  });

  /* ───────────────────────────── 15. command palette + shortcuts help */
  await step("command palette (Ctrl+K) → lab page", async () => {
    await go("/dashboard");
    await main().getByRole("heading", { level: 2, name: "Paper account" }).waitFor();
    await page.keyboard.press("Control+k");
    const dlg = page.getByRole("dialog", { name: "Търсене" });
    await dlg.waitFor();
    await dlg.getByRole("combobox").fill("leverage");
    await dlg.getByRole("option", { name: /Leverage Simulator/ }).click();
    await page.waitForURL(/\/learn\/leverage$/);
    await main().getByRole("heading", { level: 1, name: "Leverage Academy" }).waitFor();
  });

  await step("command palette → lesson 'Leverage' (alias route, not the lab)", async () => {
    await page.keyboard.press("Control+k");
    const dlg = page.getByRole("dialog", { name: "Търсене" });
    await dlg.waitFor();
    await dlg.getByRole("combobox").fill("leverage");
    await dlg.getByRole("group", { name: "LESSONS" }).getByRole("option").first().click();
    await page.waitForURL(/\/learn\/leverage-basics$/);
    await main().getByRole("button", { name: /Маркирай като завършен|Завършен/ }).waitFor();
  });

  await step("shortcuts help ('?')", async () => {
    await main().getByRole("heading", { level: 1 }).first().click();
    await page.keyboard.press("Shift+Slash");
    const dlg = page.getByRole("dialog", { name: "Клавишни комбинации" });
    await dlg.waitFor();
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
  });

  /* ───────────────────────────── 16. mobile pass */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [p, heading] of [
    ["/dashboard", null],
    ["/markets", "Markets"],
    ["/markets/BTC-USDT", "Bitcoin"],
    ["/watchlist", "Watchlist"],
    ["/charts", null],
    ["/trade", null],
    ["/simulator", "Trade Simulator"],
    ["/learn", "Trading Academy"],
    ["/learn/candlesticks", "Candlestick Lab"],
    ["/learn/leverage", "Leverage Academy"],
    ["/learn/market-structure", "Market Structure Lab"],
    ["/ai", "AI Trading Teacher"],
    ["/replay", "Market Replay"],
    ["/strategies", "Strategy Builder"],
    ["/backtesting", "Backtesting Lab"],
    ["/bots", "Bot Lab"],
    ["/journal", "Trading Journal"],
    ["/stats", "Statistics"],
    ["/performance", "Performance"],
    ["/risk", "Risk Management"],
    ["/challenges", "Challenges"],
    ["/settings", "Settings"],
    ["/settings/data-sources", "Data Sources"],
    ["/settings/ai", "AI Settings"],
  ]) {
    await step(`mobile 390 ${p}`, async () => {
      await go(p);
      if (heading) await main().getByRole("heading", { level: 1, name: heading }).waitFor();
      else await main().waitFor();
      await page.waitForTimeout(800);
      await noHorizontalOverflow(`${p} @390`);
    });
  }

  await browser.close();
}

let crashed = null;
try {
  await main();
} catch (e) {
  crashed = e;
}

const failed = results.filter((r) => !r.ok);
const uniqueProblems = [...new Set(problems)];
console.log(`\nSTEPS: ${results.length - failed.length}/${results.length} OK`);
for (const f of failed) console.log(`  FAIL ${f.name} — ${f.reason}`);
console.log(`\nUNEXPECTED ERRORS: ${uniqueProblems.length}`);
for (const p of uniqueProblems.slice(0, 80)) console.log(`  ${p}`);
if (crashed) console.log(`\nABORTED: ${crashed.message}`);
console.log(`\nScreenshots: ${SHOTS_DIR}`);
process.exit(failed.length || uniqueProblems.length || crashed ? 1 : 0);
