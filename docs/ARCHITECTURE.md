# Trading Academy — Architecture

> Образователна trading платформа. **Всички trading действия са виртуални (paper).**
> Няма реални поръчки, депозити, тегления, private keys или API ключове с trading/withdrawal права.

Философия: `LEARN → UNDERSTAND → PRACTICE → BACKTEST → PAPER TRADE → REVIEW → IMPROVE`

---

## 1. Stack

| Слой | Технология | Защо |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript + Tailwind | SSR/рутиране, строги типове, бърз UI |
| Charts | TradingView **Lightweight Charts** v5 + собствен SVG слой за чертане | Професионални свещи, panes за индикатори |
| Backend | Python **FastAPI** | Типизиран API, лесна интеграция с numpy и научни библиотеки |
| ORM | **SQLAlchemy 2** + Alembic миграции | PostgreSQL в production, SQLite в development/тестове |
| DB | **PostgreSQL** (prod) / SQLite (dev) | |
| Jobs | **Celery + Redis** (beat: синхронизация на paper сметки и ботове; worker: backtests). Без Redis всичко работи inline | |
| Auth | Сесии с random token (само SHA-256 hash в DB), HttpOnly cookie, CSRF header, rate limit | |
| AI | `LLMProvider` абстракция: `offline` (детерминистичен учител, по подразбиране) и `anthropic` (Claude) | |

## 2. Структура

```
backend/app/
  api/            REST routers (auth, market, academy, paper, risk, analysis/AI, strategies,
                  backtests, bots, journal, stats, dashboard, replay, challenges, settings, news)
  core/           security (пароли, сесии), rate limit
  models/         SQLAlchemy модели (всички таблици)
  market/         MarketDataProvider абстракция + demo/binance/twelvedata providers, timeframes
  indicators/     SMA, EMA, RSI, MACD, Bollinger, ATR, VWAP, Volume SMA, ADX
  analysis/       market structure, regime, support/resistance, signal engine, no-trade система
  strategies/     JSON правила + evaluator + шаблони
  paper_engine/   чист (без DB) симулатор: fees, spread, slippage, latency, partial fills, SL/TP, liquidation
  exchange/       ExchangeAdapter интерфейс + PaperExchangeAdapter + guard срещу live trading
  risk/           Risk Engine (position size, R:R, drawdown, daily loss, exposure, правила)
  backtesting/    backtest engine (използва същия paper_engine) + validation (OOS, sensitivity, costs)
  bots/           paper bot runner
  ai/             LLM providers, safety filter, teacher (analysis/chat), trade review, coach
  academy/        уроци, quizzes, challenges, progress
  psychology/     откриване на overtrading, oversizing, revenge trading, moved stops, chasing
  journal/        журнал статистики
  news/           NewsProvider (Finnhub, по избор)
  services/       връзка DB ⇄ engines (paper_service, bot_service, ...)
  workers/        Celery app + tasks
frontend/
  app/            страници (landing, dashboard, learn, charts, paper, replay, ai, strategies,
                  backtesting, bots, journal, stats, risk, challenges, settings) + API proxy
  components/     chart, drawing tools, order panel, lessons visuals, quiz, AI панели...
  lib/            API клиент, типове, форматиране
```

## 3. Как комуникират компонентите

```
Browser ──HTTP──► Next.js (UI + /api/* proxy route) ──HTTP──► FastAPI
                                                           │
            ┌──────────────────────────────────────────────┼─────────────────────┐
            ▼                      ▼                       ▼                     ▼
   MarketDataProvider        Paper Engine            Analysis / AI          PostgreSQL
   (LIVE/DEMO DATA)         (PAPER EXECUTION)       (signal, teacher)        (state)
            │                      ▲
            └──── 1m candles ──────┘   Celery beat → sync_accounts / run_bots
```

* Браузърът говори само с Next.js; `/api/*` се проксира към backend (cookie остава same-origin).
* **Market data и execution са строго разделени.** `market/` само чете цени. `paper_engine/` само симулира
  изпълнение. Никой модул в `market/` не може да прати поръчка; `exchange/registry.py` връща единствено
  `PaperExchangeAdapter`.
* Всеки отговор с данни носи `source` (`demo` = синтетични данни, `binance` = реални публични данни) —
  UI-ът винаги показва бадж „DEMO DATA“ или „LIVE DATA (read-only)“ + „PAPER EXECUTION“.

## 4. Database schema (основни таблици)

| Таблица | Предназначение |
|---|---|
| `users`, `user_sessions` | акаунти (вкл. guest/demo), режим beginner/advanced, настройки, risk правила; сесии (hash на token) |
| `assets`, `watchlist_items` | каталог инструменти (клас, прецизност, spread, такси, max leverage); watchlist |
| `market_data` | последни ticker snapshots (кеш) |
| `candles` | кеш на OHLCV от външни providers (спазване на rate limits) |
| `indicators` | snapshot на индикаторите, използвани в AI анализ (одит) |
| `strategies`, `strategy_rules` | стратегия (stop/TP/risk конфигурация) + нормализирани правила (side, group, left, op, right) |
| `paper_accounts` | виртуални сметки (manual / bot / replay), баланс, leverage, execution настройки |
| `paper_orders`, `paper_positions`, `paper_trades`, `paper_events` | поръчки, позиции (SL история, MFE/MAE, entry контекст), затворени сделки (R multiple, exit reason), лог |
| `journal_entries` | setup, reason, entry/stop/target, emotion, confidence, result, lesson, tags, screenshot |
| `lessons`, `learning_progress`, `quiz_results`, `challenge_progress` | академия и прогрес/XP |
| `bots`, `bot_runs`, `bot_logs` | paper ботове, сесии на работа, логове |
| `backtests`, `backtest_trades` | резултати, equity curve, validation |
| `risk_events` | нарушения на правила и поведенчески грешки |
| `ai_sessions`, `ai_messages` | AI чат/анализ/ревю история |
| `replay_sessions` | Market Replay курсор |

ID-тата на поръчки/позиции/сделки са UUID низове — paper engine-ът ги генерира без DB, а service слоят ги записва 1:1.

## 5. Paper trading engine

Чист Python модул (`paper_engine/broker.py`) без DB зависимости → лесно тестваем и използван от **paper trading,
replay, backtesting и ботовете** (едно и също поведение навсякъде).

* **Цени:** свещите са mid цени. `bid = mid − spread/2`, `ask = mid + spread/2`. BUY пълни на ask, SELL на bid.
* **Market order:** текуща цена + latency drift (σ·√latency) + slippage (базов bps + част от волатилността + market impact
  спрямо обема). Slippage винаги е неблагоприятен.
* **Limit:** пълни на лимит цената (или по-добре при gap). Само докосване → частично изпълнение.
* **Stop:** задейства се при пресичане, пълни на stop цената + slippage; при gap — на open цената.
* **Partial fills:** максимум `participation_rate × обем на свещта` на свещ; остатъкът чака следващите свещи.
* **SL/TP:** SL = stop поръчка (taker fee, slippage, gaps); TP = limit (maker fee). Ако SL и TP са в една свещ —
  консервативно се приема, че SL е ударен първи (`intrabar_policy=worst_case`).
* **Вътрешна траектория на свещ:** бичи бар O→L→H→C, мечи O→H→L→C — поръчки, изпълнени в свещта, получават активни SL/TP
  за остатъка от траекторията.
* **Margin & liquidation:** margin = notional / leverage (лимити по клас активи като ESMA retail: crypto 2x, FX 30x...).
  При margin level < 50% (stop-out) се затваря най-губещата позиция, докато нивото се възстанови.
* **Такси:** maker/taker по клас актив. Realized P/L е нетен от такси. R multiple = нетен P/L / първоначален риск.
* **Синхронизация:** lazy (при всяка заявка) + Celery beat. Обработват се само **затворени** 1m свещи след момента
  на създаване на поръчката (без lookahead).

## 6. AI architecture

```
Candles → Indicators → Structure → Regime → Levels → Strategy rules → Risk engine → No-trade checks → Signal
                                                                                              │
                              детерминистичен JSON анализ (числа, причини, invalidation) ◄────┘
                                              │
                         LLMProvider (offline | anthropic) — само ОБЯСНЯВА фактите
                                              │
                                     SafetyFilter (забранени фрази)
```

* Числата идват **само** от количествения engine → AI не може да „измисли“ ниво или сигнал.
* Изходът е разделен на **OBSERVATION / ANALYSIS / HYPOTHESIS**, с invalidation, алтернативен сценарий и Confidence
  (LOW/MEDIUM/HIGH — изрично „не е вероятност за печалба“).
* **Offline teacher** работи без ключ: речник от уроците, intent router за чата, rule-based trade review и weekly coach.
* **Anthropic provider** (по избор, `ANTHROPIC_API_KEY`) пише по-естествен текст върху същия JSON контекст.
* **SafetyFilter** премахва „guaranteed“, „100% win“, „risk-free“, „easy money“, „BUY NOW“ (EN+BG) от всеки изход.

## 7. Backtesting architecture

1. Свещи от provider-а за период → индикатори се изчисляват веднъж.
2. На затваряне на свещ i → strategy rules → сигнал. Поръчката се пълни на **open на свещ i+1** (без lookahead).
3. Размер на позицията от Risk Engine (risk % от equity / stop distance), ограничен от leverage.
4. Изпълнението минава през **същия PaperBroker** (fees, spread, slippage, SL/TP, intrabar policy).
5. Метрики: trades, win rate, net P/L, profit factor, max drawdown, average R, expectancy, largest win/loss, equity curve.
6. **Validation:** sample size, разпределение по market regime, in-sample vs out-of-sample (70/30),
   параметрична чувствителност (overfitting), стрес тест с 2× slippage, дял на разходите, drawdown предупреждения.
   AI никога не казва „стратегията е печеливша“ — само „на тази извадка резултатът е …“ + „Past backtest performance does
   not guarantee future results.“

## 8. Security model

* Пароли: `scrypt` (stdlib) със salt; сесийни token-и: 256-bit random, в DB само SHA-256 hash, HttpOnly + SameSite=Lax cookie,
  `Secure` в production, задължителен `X-TA-Client` header за промени (CSRF защита), rate limit на login/register.
* **Никога** не се съхраняват private keys, seed phrases, payment данни, API ключове с trading/withdrawal права.
* Външни API ключове (market data/news/AI) — само в environment variables, никога в DB или frontend.
* Всички входни данни се валидират с Pydantic; SQL само през ORM.
* Външни данни: само официални API-та, rate limiting + кеш; без scraping, без заобикаляне на CAPTCHA/auth.

## 9. Бъдещи exchange интеграции (без смесване с paper)

```
ExchangeAdapter (abstract)
 ├── PaperExchangeAdapter   ← единственият активен
 └── (бъдещи) BybitAdapter / MetaTraderAdapter — НЕ са имплементирани
```

* `exchange/registry.get_adapter(mode)` приема само `"paper"`; всичко друго хвърля `LiveTradingDisabledError`
  (покрито с тест). Няма env променлива, която да „включи“ live trading.
* Бъдещ live adapter трябва да е **отделен пакет/услуга** със собствени credentials (криптирани, least privilege,
  без withdrawal/transfer права), отделни таблици (`live_*`), изрично потвърждение от потребителя и собствен risk gate.
  Paper таблиците и engine-ът не се променят.
* Market data providers (read-only) са отделни от execution — реални данни могат да се ползват с paper execution.
