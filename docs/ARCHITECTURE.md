# Trading Academy V2 — Architecture

> Образователна trading платформа. **Всички trading действия са виртуални (paper).**
> Няма реални поръчки, депозити, тегления, private keys или API ключове с trading/withdrawal права.
> Никоя система — включително тази — не гарантира доход.

Философия: `LEARN → UNDERSTAND → PRACTICE → BACKTEST → PAPER TRADE → REVIEW → IMPROVE`

Три правила минават през цялата архитектура:

1. **LIVE MARKET DATA ≠ PAPER EXECUTION.** Пазарните данни само се четат (публични GET endpoints). Изпълнението
   винаги е симулирано от `PaperBroker`. Няма код, който може да изпрати реална поръчка.
2. **Никакви измислени числа.** Ако доставчикът не обслужва инструмент или поле → `DATA NOT AVAILABLE`
   (backend: `available:false` + `reason`/`code`; frontend: `<DataNotAvailable/>`). Синтетичните demo данни винаги
   са маркирани **DEMO**.
3. **AI обяснява, не предсказва.** Числата идват от детерминистичния engine; AI текстът минава през safety филтър.

---

## 1. Stack

| Слой | Технология | Бележки |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **React 19** + TypeScript + **Tailwind v4** (`@theme` tokens) | SWR за данни, `lucide-react` икони, шрифтове Inter + JetBrains Mono |
| Charts | **Lightweight Charts 5.2** + собствен SVG слой за чертане | panes за индикатори, multi-chart compare, capture към PNG |
| Backend | Python **FastAPI** + pydantic v2 | ~114 REST пътя под `/api` (Swagger на `/docs`) |
| ORM / DB | **SQLAlchemy 2** (typed models) + **Alembic** (`0001_initial_schema`, `0002_v2`) | PostgreSQL в Docker/production, SQLite в dev/тестове |
| Jobs | **Celery + Redis** (по избор) | worker: backtests; beat: SL/TP синхронизация, ботове, catalog sync. Без Redis всичко работи inline |
| Auth | Сесии със случаен token (в DB само HMAC-SHA256 hash), HttpOnly cookie, CSRF header, rate limit | guest профил с един клик |
| AI | `LLMProvider`: `offline` (детерминистичен учител, default) и `anthropic` (Claude, официален SDK) | safety filter върху всеки изход |

## 2. Структура

```
backend/app/
  api/            REST routers: auth, market, markets (explorer), academy, learn (path + labs), paper, risk,
                  ai, teacher (AI modes), strategies (+ backtests, bots), replay, misc (journal, stats,
                  dashboard, challenges, settings, news) + system (data sources / AI status)
  core/           security (scrypt пароли, сесии), rate limit, json_guard (NaN/Infinity), coerce (strict типове)
  models/         SQLAlchemy модели (33 таблици)
  market/         catalog (297 curated инструмента + synced), providers (per-class chains), registry,
                  demo / http_providers (Binance, Twelve Data), discovery (instrument sync), search,
                  sessions (пазарни часове), overview (quote snapshots, warm-up), marketcap (CoinGecko)
  indicators/     SMA, EMA, RSI, MACD, Bollinger, ATR, VWAP, Volume SMA, ADX, Highest/Lowest
  analysis/       candles (24 candlestick patterns), structure (swings, BOS), regime, signal engine
  strategies/     JSON DSL v2 (rules, structure_ops), meta, templates, view (Strategy View)
  paper_engine/   PaperBroker (чист Python, без DB), fx (конвертиране към USD), models (ExecutionConfig)
  exchange/       PaperExchangeAdapter / PaperExecutionAdapter, MarketDataAdapter (read-only),
                  FutureLiveExecutionAdapter (disabled)
  risk/           Risk Engine (position size, правила), leverage (математика на Leverage Lab)
  backtesting/    engine (същият PaperBroker), metrics, validation
  bots/           stats, coach
  replay/         presets, scoring, outcomes, comparison, review, indicators
  ai/             providers, safety, teacher, modes (8 режима), context, examples, quiz, review, coach, glossary
  academy/        content (11 модула, 117 урока), levels (Level 0–10), patterns (Candlestick Lab),
                  structure_lab (Market Structure Lab)
  psychology/     overtrading, oversizing, revenge trading, moved stops, chasing
  journal/        stats, performance, AI review
  news/           Finnhub (новини, economic/earnings calendar, по избор), explain
  services/       връзка DB ⇄ engines (paper, replay, backtest, bot, markets, learning, stats, settings…)
  workers/        Celery app (beat schedule) + tasks
frontend/
  app/            landing, login, (platform)/… страници и app/api/[...path] (proxy към backend-а)
  components/     ui (design system), shell (sidebar, top bar, command palette, tour), market, charts,
                  terminal, trading, labs, learn, academy, ai, replay, strategy, backtest, bots,
                  dashboard, analytics, journal, risk  (+ __tests__ за чистата логика)
  lib/            api клиент, hooks, types, glossary (термини), explain/workspace режими, hotkeys, theme,
                  indicators, sizing, lessons (route aliases)
e2e/              Playwright walkthrough (61 стъпки + mobile pass)
```

## 3. Как комуникират компонентите

```
Browser ──HTTP──► Next.js (UI + /api/[...path] proxy) ──HTTP──► FastAPI (/api/*)
                                                                   │
        ┌───────────────────────┬──────────────────────────────────┼──────────────────────┬──────────────┐
        ▼                       ▼                                  ▼                      ▼              ▼
  MarketRouter              PaperBroker                     Analysis / AI            Academy / Labs   PostgreSQL
  (READ-ONLY data:          (PAPER EXECUTION:               (signal, Strategy View,  (path, quizzes,  (state)
   demo | binance |          fills, margin, FX,              teacher modes,           patterns,
   twelvedata)               liquidation)                    safety filter)           structure)
        │                       ▲
        └──── closed candles ───┘      Celery beat → sync_paper_accounts (20 s) / run_bots (30 s) / sync_catalog
```

* Браузърът говори само с Next.js; `/api/*` се проксира към `BACKEND_URL` (чете се при всяка заявка, т.е. един
  image работи с всеки backend). Бисквитката остава first-party, не са нужни CORS настройки.
* Всяка промяна изисква header `x-ta-client: web` (CSRF). `lib/api.ts` го добавя; 401 пренасочва към `/login`
  (затова публичните страници не викат auth endpoints).
* Всеки отговор носи header `X-Execution-Mode: paper`; `GET /api/health` връща `"execution_mode":"paper","live_trading":false`.

## 4. Пазарни данни: каталог, доставчици, DATA NOT AVAILABLE

### 4.1 Каталог

* `market/catalog.py`: **297 curated инструмента** — 125 акции, 68 crypto, 40 ETF, 33 forex, 16 индекса, 15 стоки.
  Всеки има `AssetSpec` (клас, категория, сектор, борса, държава, валута, прецизност, spread, такси, стъпка на
  количеството, `max_leverage`, сесия, aliases, popularity, slug — `BTC/USDT` → `BTC-USDT`).
* **Synced инструменти** (`market/discovery.py`): списъци от публични read-only reference endpoints
  (Binance `exchangeInfo`, Twelve Data `/stocks`, `/etf`, `/forex_pairs`, `/indices`, `/commodities`,
  `/cryptocurrencies`) → таблица `assets` (+ `catalog_syncs` лог). Те **нямат demo данни**: показват DATA NOT
  AVAILABLE, освен ако реален доставчик ги обслужва. Изчезналите от списъка се деактивират, не се трият (slug-ът
  остава резервиран). Пуска се с `python -m app.market.discovery --provider binance|twelvedata|all` или дневно от
  Celery beat при `CATALOG_AUTO_SYNC=true`.
* `market/search.py`: in-memory индекс (символ, име, aliases, popularity) → `GET /api/market/search`,
  `GET /api/market/catalog` (филтри, facets, страници), `GET /api/market/instrument/{slug}`; любими и последни
  (`favorite_assets`, `recent_assets`).
* `market/sessions.py`: `market_status(asset)` → open / closed / break, име на сесията, часова зона, следваща промяна.

### 4.2 Provider chains

```
MARKET_DATA_CRYPTO=binance,twelvedata   MARKET_DATA_STOCKS=twelvedata   MARKET_DATA_FX=demo ...
                │
        MarketRouter ── asset_class ──► AssetClassProvider (Crypto/Stock/ETF/Forex/Index/Commodity)
                                              │  първият доставчик във веригата, който SUPPORTS инструмента
                                              ▼
                    DemoMarketDataProvider | BinancePublicProvider | TwelveDataProvider
```

* Изборът е **статичен — по поддръжка, никога заради авария**. Ако избраният доставчик върне грешка, грешката се
  показва (`MARKET_DATA_ERROR`); платформата никога не подменя реални данни с demo.
* Ако никой доставчик във веригата не поддържа инструмента → `DataNotAvailableError` (`code: DATA_NOT_AVAILABLE`,
  `reason`). HTTP: 503 `{detail, code, reason, symbol}`; в списъци и snapshot-и: `available:false` + `reason`.
* ETF, индекси и стоки ползват веригата на акциите, ако собствената им променлива е празна.
* Всеки отговор с данни носи `source` (`DataSource`): `id`, `name`, `is_live`, `disclaimer`,
  `status` = `demo` | `live` | `delayed` | `unavailable`. UI-ят го показва със `SourceBadge`
  (DEMO / LIVE / DELAYED / DATA NOT AVAILABLE) + бадж PAPER EXECUTION.
* **Demo** (`market/demo.py`): детерминистични синтетични свещи със смяна на режими, съгласувани между timeframes,
  без lookahead за текущата свещ; работят offline; винаги `status:"demo"`.
* **Binance**: само публичните market-data endpoints (`klines`, `ticker`, `ticker/24hr`), без ключ.
* **Twelve Data**: ключ в `TWELVEDATA_API_KEY` (изпраща се само към доставчика); `TWELVEDATA_REALTIME=false`
  маркира данните като `delayed`. Rate limiter спазва плана (8 заявки/мин на безплатния).
* Ключовете никога не се връщат в отговори/логове: `redact_secrets` маха query параметри с ключове и всяка
  конфигурирана стойност на ключ, ехо-ната от доставчик.

### 4.3 Quote snapshots (Markets explorer)

`market/overview.py` смята за всеки инструмент цена, 24h промяна/high/low/volume, 7d промяна, ATR %, тренд,
режим, sparkline и `source`. Стратегии по доставчик: `direct` (demo), `binance` (един bulk `ticker/24hr` + дневни
свещи), `rate_limited` (Twelve Data — само on demand за asset page и watchlist, никога за целия universe).
Статуси: `ok`, `unavailable`, `error`, `pending`, `on_demand`, `unknown`. Background warm-up нишка
(`MARKET_WARMUP`) държи snapshot-ите топли; circuit breaker (30 s) пази от каскада от timeouts.
Heatmap: размер по market cap само с `MARKET_CAP_PROVIDER=coingecko`, иначе по 24h volume с бележка
„Market cap: DATA NOT AVAILABLE“. Новини и календар (Finnhub) без ключ → DATA NOT AVAILABLE, никога измислени.

## 5. Database schema

33 таблици (Alembic `0001_initial_schema` + `0002_v2`; тест проверява, че миграцията съвпада с моделите).

| Таблица | Предназначение |
|---|---|
| `users`, `user_sessions` | акаунти (вкл. guest), режим beginner/advanced, настройки (risk правила, `app_mode`, `explain_mode`…); сесии (само hash на token) |
| `assets`, `catalog_syncs` | curated + synced инструменти (метаданни, `active`, `source`); лог на discovery sync |
| `watchlist_items`, `favorite_assets`, `recent_assets` | watchlist, любими, последно отваряни |
| `market_data`, `candles`, `indicators` | кеш на ticker/OHLCV от доставчици; snapshot на индикатори за AI одит |
| `strategies`, `strategy_rules` | стратегия (DSL v2 JSON, stop/TP/risk) + нормализирани правила |
| `paper_accounts` | виртуални сметки (manual / bot / replay), баланс, leverage, execution настройки |
| `paper_orders`, `paper_positions`, `paper_trades`, `paper_events` | поръчки (с per-order leverage), позиции (SL история, MFE/MAE, контекст), сделки (R multiple, exit reason), лог |
| `journal_entries` | setup, причина, entry/exit/stop/target, емоция, увереност, risk, бележки, screenshot, AI review |
| `lessons`, `learning_progress`, `quiz_results`, `challenge_progress` | академия, прогрес, XP |
| `structure_attempts` | опити в Market Structure Lab |
| `bots`, `bot_runs`, `bot_logs` | paper ботове, сесии, логове |
| `backtests`, `backtest_trades` | резултати, equity curve, validation |
| `replay_sessions`, `replay_decisions` | Market Replay (mode, score, review, strategy) и решенията в него |
| `risk_events` | нарушения на правила и поведенчески грешки |
| `ai_sessions`, `ai_messages` | AI история (вкл. teacher mode) |

ID-тата на поръчки/позиции/сделки са UUID низове — paper engine-ът ги генерира без DB, service слоят ги записва 1:1.
В dev (`AUTO_CREATE_TABLES=true`) таблиците се създават при старт; в Docker/production — `alembic upgrade head`.

## 6. Paper trading engine

Чист Python модул (`paper_engine/broker.py`, без DB и мрежа), общ за **paper trading, replay, backtesting и ботовете**.

* **Цени:** свещите са mid. `bid = mid − spread/2`, `ask = mid + spread/2`; BUY пълни на ask, SELL на bid.
* **Market:** цена + latency drift + slippage (база bps + част от волатилността + market impact спрямо обема); винаги неблагоприятен.
* **Limit / Stop:** limit пълни на лимита (или по-добре при gap), само докосване → частично; stop — при пресичане + slippage, при gap на open.
* **Partial fills:** до `participation_rate × обем на свещта`; остатъкът чака.
* **SL/TP:** SL = stop (taker fee, slippage, gaps); TP = limit (maker fee). SL и TP в една свещ → SL първи (`intrabar_policy=worst_case`).
  Вътрешна траектория: бичи бар O→L→H→C, мечи O→H→L→C.
* **Per-order leverage (V2):** всяка поръчка може да носи leverage `1 ≤ L ≤ max_leverage` на инструмента (ESMA-подобни
  лимити по клас: crypto 2x, акции/ETF 5x, индекси 10–20x, стоки 10–20x, forex 20–30x). Над лимита → 400 с обяснение.
  Без стойност важи `min(leverage на сметката, max на инструмента)`. Позицията пази своя leverage; margin = notional / L.
* **Cross margin (V2):** целият equity стои зад всички позиции. Когато `equity / used margin < stop_out_level` (default
  50%), губещите позиции се затварят (stop-out). Liquidation price на позиция = цената, при която (при равни други
  условия) сметката стига stop-out нивото. Сметката показва `used_margin`, `available_margin`, `margin_level`, експозиция и ефективен leverage.
* **FX конверсия (V2, `paper_engine/fx.py`):** сметката е в USD, цените — във валутата на котировката. Методи:
  `identity` (USD, USDT, USDC), `inverse` (USD/XXX), `cross` (курс от реален инструмент от каталога), `fixed`
  (подединици като GBp). Курсът е от момента на събитието: за стари събития (replay, backtest) — close на последната
  **затворена** свещ (без lookahead). Няма курс → `ConversionUnavailableError` (DATA NOT AVAILABLE), никога измислен курс.
* **Risk-based sizing:** `qty_for_risk(symbol, side, entry, stop, risk_amount, leverage)` — рискът в USD за всяка
  валута на котировката, ограничен от свободния margin.
* **Такси:** maker/taker по клас. Realized P/L е нетен; R multiple = нетен P/L / първоначален риск.
* **Синхронизация:** lazy (при заявка) + Celery beat; обработват се само **затворени** 1m свещи след поръчката.
* **Входна защита:** `core/json_guard.py` отхвърля NaN/Infinity в JSON (422 `NON_FINITE_NUMBER`) и сериализира
  такива стойности като `null`; `ExecutionConfig` / `RiskRules` се валидират строго (типове и граници → 400).

### Execution adapters

```
exchange/
  PaperExchangeAdapter         ← единственият активен (registry.get_adapter("paper"));
                                 PaperExecutionAdapter е V2 името му
  MarketDataAdapter            ← само четене на цени
  FutureLiveExecutionAdapter   ← DISABLED: не може да се създаде, всеки метод хвърля LiveTradingDisabledError
```

`LIVE_TRADING_AVAILABLE = False` е константа; `get_adapter()` с всичко различно от `"paper"` хвърля
`LiveTradingDisabledError` (HTTP 403). Няма env променлива, която да включва live trading. Тестове проверяват
и статично (AST сканиране), че в `app/` няма POST/PUT/PATCH/DELETE към външни HTTP клиенти и private endpoints.

## 7. AI architecture

```
Candles → Indicators → Structure → Regime → Levels → Strategy rules → Risk → No-trade checks → Signal
                                                                                      │
                     детерминистичен JSON контекст (числа, причини, invalidation) ◄───┘
                                         │
                 LLMProvider (offline | anthropic) — само ОБЯСНЯВА контекста
                                         │
                numeric grounding check + SafetyFilter (EN + BG) → структуриран отговор
```

* **Signal engine:** LONG SETUP / SHORT SETUP / WAIT / NO TRADE с причини; confidence (LOW/MEDIUM/HIGH) изрично
  не е вероятност за печалба.
* **AI Teacher V2** (`ai/modes.py`, `/api/teacher/*`): 8 режима — **EXPLAIN, ANALYZE, TEACH ME, REVIEW TRADE,
  REVIEW STRATEGY, QUIZ ME, WHY?, COMPARE**. Explain/analyze/why/compare винаги връщат секциите
  **OBSERVATION / RULES / SCENARIO / INVALIDATION / RISK / ALTERNATIVE SCENARIO**. RULES checklist, COMPARISON таблицата и
  QUIZ въпросите се генерират от engine-а, никога от LLM. Числа в LLM текста, които ги няма в контекста, се отхвърлят
  (fallback към offline текста). `context.py` събира графиката, черновата на поръчката, стратегията, сделката и прогреса.
* **Strategy View** (`strategies/view.py`): ✓/✕ по условие, regime филтър, резултат POSSIBLE LONG/SHORT SETUP или
  NO SETUP и винаги точния текст: *"This is a rule-based hypothetical setup, not a guarantee of future price movement."*
* **Offline teacher** — без ключ: речник, intent router за чата, rule-based trade review, weekly coach, journal review.
* **Anthropic provider** — официалният `anthropic` SDK (`ANTHROPIC_MODEL`, `AI_EFFORT`), server-side fallbacks; при
  недостъпно API се показва offline обяснението.
* **SafetyFilter** (`ai/safety.py`) маха „guaranteed“, „100% win“, „risk-free“, „easy money“, „BUY NOW“ и
  ценови прогнози („BTC will reach…“, „цената ще достигне…“) на английски и български от всеки изход.

## 8. Academy и labs

* **Learning path Level 0–10** (`academy/levels.py`): market basics → charts & candlesticks → technical analysis →
  indicators → price action → risk management → leverage & margin → strategies → backtesting → psychology →
  advanced analysis. 11 модула, 117 урока, 11 quiz-а, XP и правило за отключване. Уроците `leverage` и
  `market-structure` имат alias routes (`/learn/leverage-basics`, `/learn/market-structure-basics`), защото
  `/learn/leverage` и `/learn/market-structure` са лабораториите (`lesson_href` / `lib/lessons.ts`, покрито с тестове от двете страни).
* **Interactive candle + drill-down:** `GET /api/learn/candle-drilldown` показва по-малките свещи вътре в една свещ.
* **Candlestick Lab** (`/learn/candlesticks`): 24 модела с числови правила (`analysis/candles.py`), отчитани на
  последната свещ на модела (без lookahead), примери от реални/demo графики с историческа статистика (с бележка за
  малка извадка и „not a prediction“) и practice с HMAC-подписани рундове.
* **Market Structure Lab** (`/learn/market-structure`): потребителят маркира HH/HL/LH/LL и BREAKOUT/RETEST/FAKEOUT
  върху затворени свещи; HMAC token заключва прозореца, проверката е детерминистична и обяснена.
* **Leverage Lab** (`/learn/leverage`, `risk/leverage.py`): margin, liquidation цена, сценарии и sizing — точно
  като `PaperBroker.order_estimate` (вкл. spread и такси). Никога не препоръчва leverage.
* **Trade Simulator** (`/simulator`): what-if план → линк, който само **попълва** билета в `/trade`; никога не праща поръчка.

## 9. Market Replay V2

* `POST /api/replay`: инструмент, timeframe, начална дата или preset (random / trend / range / high_volatility /
  breakout), брой свещи, режим `trade` (paper поръчки през `PaperBroker`) или `predict` (само решения).
* **Скритото бъдеще:** сървърът връща свещи само до курсора; бъдещето и режимът на preset-а се разкриват едва след finish.
  Стъпките са по реални свещи (пропускат нощи/уикенди при акции и FX).
* Решения LONG / SHORT / WAIT със stop/target, проверка на живо (chasing, срещу структурата…), точкуване, сравнение
  със стратегия и AI history review (`GET /api/replay/{id}/review`).

## 10. Strategy Builder, Backtesting, Bot Lab

* **DSL v2** (`strategies/rules.py`, `structure_ops.py`): условия IF / AND / THEN върху цена, индикатори, обем,
  structure операнди (higher high/low, uptrend, break above swing high…) и candle patterns; stop/target правила,
  regime филтър. v1 дефинициите дават идентични резултати (fingerprint тест). 6 шаблона.
* **Backtest:** сигнал на close на свещ i → вход на open на i+1 (без lookahead); размер от Risk Engine; изпълнение през
  **същия PaperBroker**. Метрики: trades, win rate, net P/L, profit factor, max drawdown, average R, expectancy, streaks, equity curve.
* **Validation:** размер на извадката, разпределение по режими, in-sample vs out-of-sample, walk-forward,
  параметрична чувствителност (overfitting), стрес тест с по-високи разходи, дял на разходите. Текстът никога не казва
  „печеливша стратегия“; винаги: *Past backtest performance does not guarantee future results.*
* **Bot Lab:** paper ботове (`forward` или `warm_start`), STOPPED / RUNNING / PAUSED, лог, статистика и coach;
  Celery beat ги движи на 30 s (или lazy без Celery). До 25 бота на потребител.

## 11. Command Center, анализи, журнал, настройки

* `GET /api/dashboard` (Command Center): market overview по класове, movers, watchlist, сметка (margin, експозиция),
  risk статус (OK / WARNING / LIMIT), прогрес по нивата, ботове, AI insights (поведение, режим на пазара, следваща
  стъпка) и next actions. Липсващи данни → DATA NOT AVAILABLE в съответния ред.
* `/api/stats/{report,performance,behavior}`, `/api/risk/{status,rules,position-size,ruin}`, `/api/journal` (V2: AI
  review, `limit/offset/total`), `/api/challenges`, `/api/ai/coach`.
* `/api/settings`: risk правила, execution реализъм, `app_mode` (`learn` | `trade` работно пространство),
  `explain_mode` (обяснения на термините, default ON), beginner/advanced. Непознати ключове се изхвърлят, типовете се валидират.
* `/api/system/data-sources` и `/api/system/ai`: кой доставчик обслужва всеки клас, наличие на ключ (никога самият
  ключ), проверка на връзката и как да се включи.

## 12. Frontend

* **Shell:** групирано странично меню (HOME, TRADING, STRATEGIES, LEARN, ANALYTICS, SETTINGS), превключвател
  LEARN / TRADE, Beginner / Advanced, Explain mode (`e`), command palette (`/` или `Ctrl/⌘+K`: активи, уроци,
  страници, лаборатории), помощ за клавишите (`?`), guided tour.
* **Design system** „Crystal Terminal“ (`app/globals.css` tokens, `components/ui`): Card, PageHeader, Section, StatTile,
  Tabs (ARIA), Skeleton*, EmptyState, ErrorState, **DataNotAvailable**, **SourceBadge**, PaperBadge, Disclaimer, Term
  (речник), VirtualList, Drawer/Modal/Popover…
* **Правила:** loading → Skeleton, празно → EmptyState, грешка → ErrorState с retry, липсващи пазарни данни →
  DataNotAvailable; числата са tabular (`.num`); всяка страница работи и на 390 px ширина.
* **Proxy:** `app/api/[...path]/route.ts` препраща към `BACKEND_URL`; `output: "standalone"` за Docker image-а.

## 13. Background jobs

| Задача | Кога | Без Celery |
|---|---|---|
| `run_backtest` | worker, при `POST /api/backtests` | FastAPI background task |
| `sync_paper_accounts` | beat, на 20 s (SL/TP, лимитни поръчки, stop-out) | lazy при всяка заявка към сметката |
| `run_bots` | beat, на 30 s | lazy: GET заявките към Bot Lab обработват новите затворени свещи |
| `sync_catalog` | beat, дневно 03:17 UTC, само при `CATALOG_AUTO_SYNC=true` | CLI `python -m app.market.discovery` |

Celery beat трябва да е **една** инстанция.

## 14. Security model

* Пароли: `scrypt` със salt. Сесии: 256-bit random token, в DB само HMAC-SHA256 hash, HttpOnly + SameSite=Lax cookie,
  `Secure` в production, задължителен `x-ta-client` header (CSRF), rate limit на login/register, security headers.
* **Никога** не се съхраняват private keys, seed phrases, payment данни или API ключове с trading/withdrawal права
  (тест проверява имената на колоните; `PUT /settings` изхвърля непознати ключове като `seed_phrase`).
* Ключовете за данни/новини/AI са само в environment, никога в DB, frontend, отговори или логове.
* В production стартът спира, ако `SECRET_KEY` не е сменен.
* Guest изолация: потребител B не може да чете/променя ресурси на A (тествано за 29 типа ресурси).
* Всички входове — pydantic + строги граници; списъците са ограничени (pagination, `limit`).
* Външни данни: само официални API-та, rate limiting + кеш; без scraping, без заобикаляне на CAPTCHA/auth.

## 15. Тестове

* **Backend** (`backend/tests`, pytest): ~930 теста — paper engine (leverage, margin, liquidation, FX, partial fills,
  SL/TP), backtest без lookahead, replay hidden future, labs, AI safety и режими, provider chains и DATA NOT
  AVAILABLE, миграция ⇄ модели, auth/CSRF/изолация, safety инварианти (live adapter, без private endpoints). Мрежата е
  mock-ната (`httpx.MockTransport`) — тестовете не излизат в интернет.
* **Frontend** (`npm run test:unit`): Node test runner върху чистата логика в `components/**/__tests__` и `lib/__tests__`.
* **E2E** (`e2e/walkthrough.mjs`): Playwright минава през всяка страница с реално действие + mobile pass (390×844).

## 16. Бъдещи exchange интеграции (без смесване с paper)

* Бъдещ live adapter трябва да е **отделен пакет/услуга** със собствени credentials (криптирани, least privilege, без
  withdrawal/transfer права), отделни таблици (`live_*`), изрично потвърждение от потребителя и собствен risk gate.
  Paper таблиците и engine-ът не се променят.
* Market data providers (read-only) остават отделни от execution — реални данни могат да се ползват с paper execution.
* Тази версия **не** включва и не може да включи live trading.
