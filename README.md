# Trading Academy V2 — образователна платформа за trading и paper trading

**LEARN → UNDERSTAND → PRACTICE → BACKTEST → PAPER TRADE → REVIEW → IMPROVE**

Trading Academy е уеб платформа, в която човек научава как работят пазарите, чете графики, упражнява модели и
пазарна структура, разбира leverage и margin, тества стратегии върху исторически данни и търгува **само с виртуални
пари** ($10,000 paper акаунт) — преди изобщо да мисли за реален риск.

> ⚠️ **Това не е бот за „стабилни доходи“.** Никоя система не може да гарантира печалба или доход. Платформата
> съществува, за да покаже честно дали една идея има предимство — включително когато отговорът е „не“.
> Всички сделки са симулирани (PAPER). Няма реални поръчки, депозити, тегления или управление на истински средства.

---

## Съдържание

1. [Какво има вътре](#какво-има-вътре)
2. [Бърз старт (Docker)](#бърз-старт-docker)
3. [Демонстрация в 20 стъпки](#демонстрация-в-20-стъпки)
4. [Installation](#installation)
5. [Environment variables](#environment-variables)
6. [Database setup](#database-setup)
7. [Development](#development)
8. [Production](#production)
9. [Market data provider setup](#market-data-provider-setup)
10. [AI provider setup](#ai-provider-setup)
11. [Testing](#testing)
12. [Docker](#docker)
13. [Deployment](#deployment)
14. [Troubleshooting](#troubleshooting)
15. [Security model](#security-model)
16. [Known limitations](#known-limitations)
17. [Структура на проекта](#структура-на-проекта)

Подробната архитектура (каталог и доставчици, DATA NOT AVAILABLE, paper engine с per-order leverage, FX и cross
margin, AI режими, replay, labs, command center, security) е в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Какво има вътре

Всичко работи веднага с **DEMO данни** (детерминистични синтетични свещи, винаги маркирани **DEMO** в UI) и
**offline AI** — не е нужен нито един API ключ. С реални read-only доставчици (Binance, Twelve Data) същите страници
показват LIVE / DELAYED данни, а изпълнението остава **PAPER**.

### Страници

| Група | Страница | Какво прави |
|---|---|---|
| HOME | **Dashboard** `/dashboard` | Command Center: пазарен преглед по класове и movers, watchlist, paper сметка (equity, margin, експозиция), risk статус (OK / WARNING / LIMIT), прогрес по нивата, ботове, AI insights и „следваща стъпка“. |
| | **Markets** `/markets` | Explorer на ~300 инструмента (crypto, акции, ETF, forex, индекси, стоки): табове по клас, търсене, сортиране, movers, heatmap, новини и economic calendar (с Finnhub ключ). |
| | **Asset page** `/markets/BTC-USDT` | Котировка, графика, статистика, пазарни часове (open/closed), режим и тренд, AI анализ, свързани уроци, бутони към Charts и Paper Trading. |
| | **Watchlist** `/watchlist` | Наблюдавани инструменти с цена, промяна, тренд, волатилност и AI статус. |
| | **Charts** `/charts` | Pro chart терминал (Lightweight Charts): 1m–1W, индикатори (SMA, EMA, Bollinger, VWAP, RSI, MACD, ATR, ADX, Volume SMA, Highest/Lowest), чертане (trend line, horizontal line, ray, rectangle, text, measure), сравнение на timeframes, AI панел. |
| | **Search** (`/` или `Ctrl/⌘+K`) | Глобална command palette: активи („tesla“ → TSLA), уроци, страници и лаборатории. |
| TRADING | **Paper Trading** `/trade` | Терминал с графика, order ticket (market / limit / stop, SL/TP с бързи бутони, sizing по risk %, **per-order leverage** до лимита на инструмента), позиции, поръчки, история, AI панел (Strategy View, *Explain this setup*, WHY?, Ask). Fill-ове с такси, spread, slippage, latency, partial fills, cross margin и stop-out. |
| | **Trade Simulator** `/simulator` | What-if план (entry/stop/target/leverage) → резултат в $ и R; линкът само попълва билета в `/trade`, никога не праща поръчка. |
| | **Market Replay** `/replay` | Търгуване/предсказване върху минал период свещ по свещ без да виждаш бъдещето: presets (trend, range, high volatility, breakout), решения LONG / SHORT / WAIT, точкуване и AI review. |
| STRATEGIES | **Strategy Builder** `/strategies` | Правила IF / AND / THEN върху цена, индикатори, обем, market structure и candle patterns; stop/target правила, regime филтър, 6 шаблона, „Check current signal“ (rule-based hypothetical setup). |
| | **Backtesting** `/backtesting` | Сигнал на close → вход на следващия open (без lookahead), същият paper engine с разходи; метрики, equity/drawdown, validation: sample size, режими, in-sample vs out-of-sample, walk-forward, чувствителност, stress test. |
| | **Bot Lab** `/bots` | Paper ботове по стратегия (STOPPED / RUNNING / PAUSED), лог, статистика и coach. Само виртуално изпълнение. |
| LEARN | **Academy** `/learn` | Learning path LEVEL 0–10 (11 модула, 117 урока, 11 quiz-а, XP), интерактивна свещ с drill-down, обяснения *What it is / How it is calculated / When it fails*. |
| | **Candlestick Lab** `/learn/candlesticks` | 24 модела: как изглеждат, какво значат и какво НЕ значат, примери от графиката с историческа статистика, practice рундове. |
| | **Market Structure Lab** `/learn/market-structure` | Маркираш HH / HL / LH / LL и breakout / retest / fakeout върху реална графика и получаваш обяснена проверка. |
| | **Leverage Simulator** `/learn/leverage` | Margin, liquidation цена, сценарии и предупреждения при висок leverage — със същата математика като paper engine-а. Никога не препоръчва leverage. |
| | **AI Teacher** `/ai` | 8 режима: EXPLAIN, ANALYZE, TEACH ME, REVIEW TRADE, REVIEW STRATEGY, QUIZ ME, WHY?, COMPARE. Отговорите са структурирани: OBSERVATION / RULES / SCENARIO / INVALIDATION / RISK / ALTERNATIVE SCENARIO. |
| | **Challenges** `/challenges` | Упражнения с рундове и XP. |
| | **Journal** `/journal` | Дневник: setup, причина, entry/exit/stop/target, емоция, увереност, бележки, screenshot, AI review на записа. |
| ANALYTICS | **Statistics** `/stats` | Performance report, поведение (overtrading, revenge trading, преместени стопове…), седмичен AI Coach. |
| | **Performance** `/performance` | Equity & drawdown, разбивки (с предупреждение при малко сделки), месечни резултати, R distribution, най-добри/най-лоши сделки — за ръчни сделки, ботове или всички. |
| | **Risk Management** `/risk` | Position Size Calculator, risk статус (OK / WARNING / LIMIT), експозиция, risk правила (риск на сделка, дневен лимит на загуба, максимум позиции, минимален R:R) и risk events. |
| SETTINGS | **Settings** `/settings` | Learning mode (Beginner / Advanced, LEARN / TRADE работно пространство, Explain mode, guided tour), реализъм на симулацията (такси, spread, slippage, latency, partial fills, liquidation), paper сметка (leverage по подразбиране, нулиране с нов виртуален баланс), анализ (news risk, overtrading праг), запазване на guest профила. |
| | **Data Sources** `/settings/data-sources` | Кой доставчик обслужва всеки клас (DEMO / LIVE / DELAYED), наличие на ключ (самият ключ никога не се показва), проверка на връзката, как да се включи. |
| | **AI Settings** `/settings/ai` | Как работи AI Teacher: активен доставчик и модел, offline fallback, структура на отговорите, safety правила. |

Навсякъде: Beginner режим с обяснения (`<Term>` речник, Explain mode — клавиш `e`), guided tour, клавиш `?` за
всички shortcuts, мобилен изглед до 390 px.

---

## Бърз старт (Docker)

```bash
git clone https://github.com/19todorovv14/Analizatora-na-qndo.git
cd Analizatora-na-qndo
docker compose up --build
```

След като контейнерите станат healthy (първият build отнема няколко минути):

- Уеб приложение: **http://localhost:3000**
- API документация (Swagger): **http://localhost:8000/docs**
- Health check: http://localhost:8000/api/health →
  `{"status":"ok","execution_mode":"paper","live_trading":false,"market_data":{...},"ai_provider":"offline","celery":true}`

Вход:

- **START LEARNING** или **OPEN PAPER TRADING** на началната страница създава изолиран guest профил с $10,000
  виртуални пари, без регистрация (по-късно може да се запази с имейл и парола).
- или демо акаунт: **`demo@trading-academy.local` / `Demo12345`**

Без `.env` стекът тръгва с DEMO данни, offline AI и локални credentials. За реални данни виж
[Market data provider setup](#market-data-provider-setup).

---

## Демонстрация в 20 стъпки

| # | Действие | Къде |
|---|---|---|
| 1 | START LEARNING → guided tour | Landing → **Dashboard** |
| 2 | Натисни `/`, напиши „tesla“ → TSLA | Command palette → **Asset page** |
| 3 | Таб Crypto, търсене „ethereum“ | **Markets** |
| 4 | Добави инструмент в watchlist | **Watchlist** |
| 5 | Смени timeframe (4H), добави MACD, начертай horizontal line | **Charts** |
| 6 | Отвори урок → „Маркирай като завършен“ (+XP) → quiz Level 0 | **Learn** |
| 7 | Отвори Hammer → направи practice рунд | **Candlestick Lab** |
| 8 | Маркирай HH и натисни „Провери“ | **Market Structure Lab** |
| 9 | Сложи 50x → виж liquidation цената и WARNING | **Leverage Simulator** |
| 10 | Сложи „Стоп 1%“ и „Цел 2R“ → BUY market → позицията е filled | **Paper Trading** `/trade` |
| 11 | *Explain this setup* → таб WHY? | AI панела в `/trade` |
| 12 | Затвори позицията → History → AI review | `/trade` |
| 13 | Режим ANALYZE, после WHY? | **AI Teacher** |
| 14 | Start replay → LONG → Next candle → Finish + AI review | **Market Replay** |
| 15 | Шаблон → Copy & edit → Check current signal | **Strategy Builder** |
| 16 | Run backtest → метрики и Strategy validation | **Backtesting** |
| 17 | Create paper bot → ▶ Start | **Bot Lab** |
| 18 | Добави запис | **Journal** |
| 19 | Прегледай отчетите и Position Size Calculator | **Statistics**, **Performance**, **Risk** |
| 20 | Провери доставчиците и AI | **Settings** → Data Sources / AI Settings |

Същият сценарий е автоматизиран в [`e2e/walkthrough.mjs`](e2e/README.md) (61 стъпки + mobile pass).

---

## Installation

Изисквания:

| Начин | Нужно |
|---|---|
| Docker (препоръчително) | Docker Engine 24+ с Compose v2 |
| Локално | Python 3.11+ (тествано с 3.12/3.13), Node.js 20.9+ (тествано с 22), npm |
| По избор | PostgreSQL 14+ и Redis 6+ (production-подобна среда без Docker) |

Локална инсталация:

```bash
# backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env               # по избор — без .env важат безопасните defaults

# frontend
cd ../frontend
npm install
cp .env.example .env.local         # BACKEND_URL=http://localhost:8000
```

---

## Environment variables

Всички тайни (API ключове, пароли за базата) се четат **само** от environment / `.env`. Нищо тайно не се пази
в базата данни, не се изпраща към браузъра и не се пише в логовете.

- `/.env.example` — за `docker compose` (копирай като `.env` в корена)
- `/backend/.env.example` — за локален backend (копирай като `backend/.env`)
- `/frontend/.env.example` — за локален frontend (копирай като `frontend/.env.local`)

### Backend

| Променлива | Default | Описание |
|---|---|---|
| `APP_ENV` | `development` | `development` / `production` / `test`. В production стартът спира, ако `SECRET_KEY` не е сменен. |
| `DATABASE_URL` | `sqlite:///./trading_academy.db` | Production: `postgresql+psycopg://user:pass@host:5432/db` |
| `AUTO_CREATE_TABLES` | `true` | Създава таблиците при старт (dev). В Docker/production схемата е от Alembic. |
| `SEED_DEMO_DATA` | `true` | Каталог, уроци, шаблони и демо потребител (идемпотентно). |
| `USE_CELERY` | `false` | `true` → backtest-ите вървят в Celery worker, beat синхронизира SL/TP, ботове и (по избор) каталога. |
| `REDIS_URL` | — | Broker за Celery, напр. `redis://localhost:6379/0`. |
| `SECRET_KEY` | `dev-insecure-…` | Дълга случайна стойност (HMAC на session токените). |
| `COOKIE_SECURE` | `false` | `true` зад HTTPS. |
| `SESSION_DAYS` | `30` | Валидност на сесията. |
| `CORS_ORIGINS` | `http://localhost:3000` | Разделени със запетая (уеб приложението ползва same-origin proxy). |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `20` | Опити за вход/регистрация на IP в минута. |
| `MARKET_DATA_CRYPTO` | `demo` | Верига от доставчици за crypto: `demo`, `binance`, `twelvedata` или напр. `binance,twelvedata`. |
| `MARKET_DATA_FX` | `demo` | Forex: `demo` / `twelvedata`. |
| `MARKET_DATA_STOCKS` | `demo` | Акции (и ETF, индекси, стоки, ако техните променливи са празни). |
| `MARKET_DATA_ETF` / `MARKET_DATA_INDICES` / `MARKET_DATA_COMMODITIES` | празно | Отделна верига за класа; празно = веригата на акциите. |
| `BINANCE_BASE_URL` | `https://data-api.binance.vision` | Публичен read-only market data endpoint. |
| `TWELVEDATA_API_KEY` | — | Ключ от twelvedata.com. |
| `TWELVEDATA_REALTIME` | `false` | `true` само при real-time план; иначе данните са маркирани DELAYED. |
| `MARKET_HTTP_TIMEOUT` | `10` | Timeout (s) към доставчиците. |
| `MARKET_WARMUP` | `true` | Background нишка държи готови котировките за Markets (demo / Binance). |
| `MARKET_CAP_PROVIDER` | `none` | `none` / `coingecko` — market cap за crypto heatmap (без доставчик: DATA NOT AVAILABLE, плочки по 24h volume). |
| `COINGECKO_API_KEY` | — | По избор: CoinGecko demo plan ключ (изпраща се като header). |
| `CATALOG_AUTO_SYNC` | `false` | `true` → дневен sync на списъците с инструменти в Celery beat. |
| `CATALOG_BINANCE_QUOTES` | `USDT,USDC,FDUSD,BTC,ETH,EUR` | Кои Binance spot двойки да се синхронизират (по quote asset). |
| `CATALOG_TWELVEDATA_COUNTRIES` | `United States` | Държави за Twelve Data акции/ETF при sync. |
| `FINNHUB_API_KEY` | — | По избор: новини, economic и earnings calendar (само контекст, никога сигнал). |
| `AI_PROVIDER` | `offline` | `offline` / `anthropic` |
| `ANTHROPIC_API_KEY` | — | Ключ от console.anthropic.com. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Модел за AI Teacher / Coach. |
| `AI_EFFORT` | `low` | `low` / `medium` / `high` — дълбочина на обясненията. |
| `AI_MAX_TOKENS` | `4000` | Таван на отговора. |
| `AI_TIMEOUT_SECONDS` | `60` | Timeout към AI API. |

### Frontend

| Променлива | Default | Описание |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | Адрес на FastAPI, както го вижда Next.js сървърът. Браузърът говори само с `/api` на същия домейн (proxy), затова не са нужни CORS настройки и бисквитката остава first-party. Чете се при всяка заявка, т.е. един Docker image работи с всеки backend. |

### Docker compose (`/.env`)

Освен backend променливите: `FRONTEND_PORT` (3000), `BACKEND_PORT` (8000), `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`. В compose `DATABASE_URL`, `REDIS_URL` и `AUTO_CREATE_TABLES=false` са зададени автоматично.

---

## Database setup

**Development — SQLite (по подразбиране).** Нищо не се инсталира: при старт backend-ът създава
`backend/trading_academy.db` (WAL mode, foreign keys) и зарежда каталога, уроците и демо данните.

**PostgreSQL.**

```bash
createuser trading --pwprompt
createdb trading_academy -O trading

# backend/.env
DATABASE_URL=postgresql+psycopg://trading:<парола>@localhost:5432/trading_academy
AUTO_CREATE_TABLES=false

cd backend
alembic upgrade head        # 0001_initial_schema + 0002_v2 → 33 таблици
python -m app.seed          # каталог (297 инструмента), 117 урока, шаблони, демо потребител — идемпотентно
```

**Миграции при промяна на моделите** (`backend/app/models/`):

```bash
cd backend
alembic revision --autogenerate -m "описание"
alembic upgrade head
alembic upgrade head --sql   # само показва SQL-а
```

Основни таблици: `users`, `user_sessions`, `assets`, `catalog_syncs`, `watchlist_items`, `favorite_assets`,
`recent_assets`, `candles`, `strategies`, `strategy_rules`, `paper_accounts`, `paper_orders`, `paper_positions`,
`paper_trades`, `paper_events`, `replay_sessions`, `replay_decisions`, `structure_attempts`, `journal_entries`,
`lessons`, `learning_progress`, `quiz_results`, `challenge_progress`, `bots`, `bot_runs`, `bot_logs`, `backtests`,
`backtest_trades`, `risk_events`, `ai_sessions`, `ai_messages`. Описание — в `docs/ARCHITECTURE.md` §5.

**Нулиране на dev базата:** спри backend-а и изтрий `backend/trading_academy.db*`. В Docker: `docker compose down -v`.

---

## Development

Два терминала:

```bash
# 1) backend — http://localhost:8000 (Swagger: /docs)
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# 2) frontend — http://localhost:3000
cd frontend
npm run dev
```

По избор, фонови задачи с Celery (иначе backtest-ите вървят като FastAPI background tasks, а paper сметките и
ботовете се синхронизират, когато потребителят отвори приложението):

```bash
docker run -d -p 6379:6379 redis:7-alpine
# backend/.env: USE_CELERY=true, REDIS_URL=redis://localhost:6379/0
celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info
```

Синхронизация на списъка с инструменти (по избор, само публични read-only списъци):

```bash
cd backend
python -m app.market.discovery --provider binance            # Binance spot двойки
python -m app.market.discovery --provider twelvedata --kinds forex_pairs,commodities
python -m app.market.discovery --provider all
```

Полезни команди:

```bash
cd backend && ruff check .                         # lint
cd frontend && npx eslint .                        # ESLint (вкл. React Compiler правила)
cd frontend && npx tsc --noEmit --incremental false  # type check
```

Как да добавиш:

- **индикатор** — функция в `backend/app/indicators/__init__.py`, запис в `INDICATOR_CATALOG` и клон в `compute()`;
  Strategy Builder-ът го взима от API-то, а менюто на графиката — от `frontend/lib/indicators.ts`.
- **урок** — `backend/app/academy/content/` (модулът определя нивото в `academy/levels.py`); seed-ът го записва в `lessons`.
- **актив** — `backend/app/market/catalog.py` / `market/universe/` (spread, такси, стъпка, `max_leverage`, сесия,
  символи при доставчиците) или чрез discovery sync.
- **термин в речника** — `frontend/lib/glossary.ts` (`<Term k="…">`).

---

## Production

Без Docker:

```bash
# backend
export APP_ENV=production SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
export DATABASE_URL=postgresql+psycopg://... AUTO_CREATE_TABLES=false SEED_DEMO_DATA=false
export COOKIE_SECURE=true USE_CELERY=true REDIS_URL=redis://...
alembic upgrade head && python -m app.seed
uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
celery -A app.workers.celery_app worker -l info     # отделен процес
celery -A app.workers.celery_app beat -l info       # ТОЧНО една инстанция

# frontend (output: "standalone" — `next start` не се ползва)
cd frontend && npm ci && npm run build
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
BACKEND_URL=http://127.0.0.1:8000 PORT=3000 node .next/standalone/server.js
```

Чеклист:

- `SECRET_KEY` — дълъг, случаен, пази се в secret manager.
- HTTPS пред приложението и `COOKIE_SECURE=true`.
- Публично се отваря **само frontend-ът**. Backend-ът, PostgreSQL и Redis остават във вътрешната мрежа.
- Rate limit-ът за вход е в паметта на процеса — при няколко backend инстанции добави лимит и на reverse proxy-то.
- Backup на PostgreSQL (`pg_dump`) по график.
- Celery beat трябва да е една инстанция, иначе задачите се дублират.

---

## Market data provider setup

Пазарните данни са **read-only** (само публични GET заявки). Изпълнението на сделки винаги остава PAPER, независимо
откъде идват цените. Всяка графика, котировка и списък показва източника си: **DEMO**, **LIVE**, **DELAYED** или
**DATA NOT AVAILABLE**.

### Каталог

297 curated инструмента: 125 акции, 68 crypto, 40 ETF, 33 forex двойки, 16 индекса, 15 стоки (търсене по символ,
име или alias, напр. „tesla“, „gold“, „bitcoin“). Discovery sync може да добави още хиляди инструменти от публичните
списъци на Binance и Twelve Data (виж [Development](#development)); те нямат demo данни.

### Provider chains

Всеки клас активи има **верига** от доставчици:

```env
MARKET_DATA_CRYPTO=binance,twelvedata   # първият доставчик, който ПОДДЪРЖА инструмента, го обслужва
MARKET_DATA_FX=twelvedata
MARKET_DATA_STOCKS=twelvedata           # ETF, индекси и стоки ползват тази верига, ако техните са празни
MARKET_DATA_INDICES=demo
```

Правила:

- Изборът е **статичен** (по поддръжка). Ако доставчикът върне грешка, UI-ят показва грешката — платформата
  **никога** не подменя реални данни с demo данни заради авария.
- Ако никой доставчик във веригата не поддържа инструмента → **DATA NOT AVAILABLE** с причина. Числа не се измислят
  (това важи и за market cap, новини, календар и FX курсове в paper engine-а).
- DEMO данните са синтетични (смяна на режими тренд/range/висока волатилност, съгласувани между timeframes, без
  lookahead), работят offline и **винаги** са маркирани DEMO.

### Binance (crypto, без ключ)

```env
MARKET_DATA_CRYPTO=binance
# BINANCE_BASE_URL=https://data-api.binance.vision   (публичен market-data endpoint)
```

Само публичните `klines`, `ticker` и `ticker/24hr` endpoints. Не се изисква и не се приема API ключ. Rate limiter и
кратък кеш; при 429/418 клиентът спира.

### Twelve Data (forex, акции, ETF, индекси, стоки, crypto)

1. Регистрация на https://twelvedata.com → API key.
2. В `.env`:
   ```env
   TWELVEDATA_API_KEY=<ключ>
   MARKET_DATA_FX=twelvedata
   MARKET_DATA_STOCKS=twelvedata
   TWELVEDATA_REALTIME=false   # true само при real-time план
   ```
3. Безплатният план е 8 заявки/минута и ограничен брой кредити на ден. Затова котировките за Twelve Data се смятат
   **само on demand** (asset page, watchlist), а списъци за целия universe (movers, heatmap) показват, че планът не
   ги позволява. Някои инструменти изискват платен план — тогава UI-ят показва грешката на доставчика.

### По избор

- **Market cap за crypto heatmap:** `MARKET_CAP_PROVIDER=coingecko` (+ по избор `COINGECKO_API_KEY`). Без него
  плочките са по 24h volume и пише „Market cap: DATA NOT AVAILABLE“.
- **Новини и календар:** `FINNHUB_API_KEY` от finnhub.io. Показват се като контекст и рисков фактор, никога като сигнал.

**Нов доставчик:** наследи `MarketDataProvider` (`backend/app/market/base.py`), имплементирай `supports`,
`get_candles`, `get_ticker`, регистрирай го в `backend/app/market/registry.py` и добави символите на доставчика в
каталога. Доставчиците нямат методи за поръчки/трансфери и нямат достъп до paper engine-а.

Състоянието на всичко това се вижда на **Settings → Data Sources** (`GET /api/system/data-sources`).

---

## AI provider setup

Количествените изчисления (индикатори, режим, нива, структура, risk, backtest) **винаги** се правят от кода. AI само
**обяснява** вече изчислените данни. Всеки отговор:

- е структуриран: **OBSERVATION / RULES / SCENARIO / INVALIDATION / RISK / ALTERNATIVE SCENARIO**;
- минава през safety филтър, който маха „BUY NOW“, „guaranteed profit“, „100% win“, „risk-free“, „easy money“ и
  ценови прогнози („BTC will reach…“, „цената ще достигне…“) на английски и български;
- при стратегии винаги съдържа: *"This is a rule-based hypothetical setup, not a guarantee of future price movement."*

Режими на AI Teacher (`/ai`, AI панела в `/trade`, бутоните „Teach me“ в академията): **EXPLAIN, ANALYZE, TEACH ME,
REVIEW TRADE, REVIEW STRATEGY, QUIZ ME, WHY?, COMPARE**.

**Offline (по подразбиране):** `AI_PROVIDER=offline`. Детерминистичен rule-based учител, reviewer и coach. Не е нужен ключ.

**Claude (Anthropic):**

1. API ключ от https://console.anthropic.com.
2. В `.env`:
   ```env
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=<ключ>
   ANTHROPIC_MODEL=claude-opus-5-5
   AI_EFFORT=low          # low | medium | high
   ```
3. Рестартирай backend-а. `GET /api/ai/status` и **Settings → AI Settings** показват активния provider.

Заявките използват официалния `anthropic` Python SDK със server-side fallbacks. Ако API-то е недостъпно, откаже или
върне неразбираем отговор, се показва offline обяснението; секция с числа, които engine-ът не е изчислил, се заменя с
offline текста. Нищо не спира да работи.

**Друг LLM:** наследи `LLMProvider` в `backend/app/ai/providers.py` (един метод `complete`) и го добави в `get_llm`.

---

## Testing

```bash
# backend — ~930 теста, без мрежа (доставчиците са mock-нати)
cd backend
pytest
pytest --cov=app       # с coverage
ruff check .

# frontend — unit тестове (Node test runner), типове, lint
cd frontend
npm run test:unit
npx tsc --noEmit --incremental false
npx eslint .
npm run build

# e2e — Playwright walkthrough през всички страници (backend + frontend трябва да вървят)
cd e2e
npm install
npx playwright install chromium    # само първия път
BASE_URL=http://localhost:3000 npm run walkthrough
```

Backend покритие: paper engine (поръчки, стопове, take profit, такси, slippage, partial fills, per-order leverage,
margin, ликвидация, FX конверсия), position sizing, risk, backtesting (без lookahead, validation), replay (скритото
бъдеще не изтича), labs, индикатори, strategy DSL, signal engine, provider chains и DATA NOT AVAILABLE, DEMO
маркиране, миграция ⇄ модели, authentication, CSRF, guest изолация, AI safety филтър и режими, и инвариантите, че live
trading адаптер не може да бъде създаден и че няма заявки към private/trading endpoints.

Walkthrough-ът (`e2e/`) пише `OK`/`FAIL` за всяка стъпка, снимка за всяка стъпка в `e2e/shots/` и връща ненулев код
при неуспешна стъпка или неочаквана грешка в конзолата / 5xx от API-то. Подробности: [`e2e/README.md`](e2e/README.md).

---

## Docker

`docker-compose.yml` стартира:

| Service | Image | Роля |
|---|---|---|
| `frontend` | `frontend/Dockerfile` (Next.js standalone, node:22-alpine) | Уеб приложението, порт 3000 |
| `backend` | `backend/Dockerfile` (python:3.12-slim) | `alembic upgrade head` → seed → uvicorn, порт 8000 |
| `worker` | същият image | Celery worker (backtests) |
| `beat` | същият image | Celery beat: SL/TP и stop-out на paper сметките (20 s), paper ботове (30 s), catalog sync (дневно, ако е включен) |
| `postgres` | postgres:17-alpine | База данни (volume `pgdata`) |
| `redis` | redis:7-alpine | Broker за Celery |

```bash
docker compose up --build            # всичко → http://localhost:3000
docker compose up -d --build         # във фон
docker compose logs -f backend       # логове
docker compose exec backend python -m app.market.discovery --provider all   # sync на каталога (по избор)
docker compose down                  # спиране
docker compose down -v               # спиране + изтриване на базата
FRONTEND_PORT=8080 docker compose up # друг порт
```

Контейнерите вървят като non-root потребител; backend-ът има healthcheck, а frontend/worker/beat изчакват базата
да е мигрирана.

---

## Deployment

Всяка платформа, която пуска Docker контейнери, става (VPS с Docker Compose, Fly.io, Render, Railway,
Kubernetes, AWS ECS…). Най-простият вариант — един VPS:

1. Инсталирай Docker и клонирай репото.
2. Създай `.env` от `.env.example`: силен `SECRET_KEY` и `POSTGRES_PASSWORD`, `COOKIE_SECURE=true`,
   `CORS_ORIGINS=https://твоя-домейн`.
3. Остави публичен само frontend порта (премахни `ports` на backend от compose или го затвори във firewall).
4. Сложи reverse proxy с HTTPS пред порт 3000, напр. Caddy:
   ```
   trading.example.com {
       reverse_proxy localhost:3000
   }
   ```
5. `docker compose up -d --build`.
6. Обновяване: `git pull && docker compose up -d --build` (миграциите се изпълняват автоматично при старт).

При managed PostgreSQL/Redis: махни съответните services и задай `DATABASE_URL` / `REDIS_URL` към тях.

---

## Troubleshooting

| Проблем | Решение |
|---|---|
| Frontend-ът показва „Backend-ът не е достъпен“ (502) | Провери, че backend-ът върви и `BACKEND_URL` сочи към него (`curl $BACKEND_URL/api/health`). В Docker адресът е `http://backend:8000`. |
| `RuntimeError: Set SECRET_KEY…` при старт | В production (`APP_ENV=production`) задай собствен `SECRET_KEY`. |
| Вход работи, но след refresh си отново излязъл | Зад HTTP (не HTTPS) `COOKIE_SECURE` трябва да е `false`. |
| `401` на `/api/auth/me` в конзолата на началната страница | Нормално — още няма сесия. |
| `403 CSRF` при директни API заявки | Всички промени изискват header `x-ta-client: web` (frontend-ът го добавя автоматично). |
| `429 Too Many Requests` при вход | Rate limit — изчакай минута или увеличи `AUTH_RATE_LIMIT_PER_MINUTE` в dev. |
| Инструмент показва **DATA NOT AVAILABLE** | Никой доставчик от веригата на класа не го поддържа (напр. акция при `MARKET_DATA_STOCKS=binance`, или synced инструмент при `demo`). Задай подходящ доставчик — виж Settings → Data Sources. Това е нарочно: числа не се измислят. |
| Графиката показва грешка от доставчика | Отвори `/api/market/candles?symbol=BTC/USDT&timeframe=1h` и виж `detail`/`reason`. При Twelve Data — ключ, лимит на плана или неподдържан инструмент. Върни `demo` за проверка. |
| Movers / heatmap за акции казват, че планът не позволява списъка | Twelve Data се ползва само on demand (asset page, watchlist), за да не изгори кредитите на безплатния план. |
| Heatmap пише „Market cap: DATA NOT AVAILABLE“ | Задай `MARKET_CAP_PROVIDER=coingecko` (crypto). За акции/ETF доставчикът не дава market cap. |
| Поръчка → „Максималният leverage за … е Nx“ | Leverage-ът е ограничен по клас (crypto 2x, акции/ETF 5x, индекси/стоки 10–20x, forex 20–30x). |
| Поръчка в не-USD инструмент → няма курс | За FX конверсия е нужна котировка на конверсионния инструмент; без нея поръчката се отказва (DATA NOT AVAILABLE) вместо да се ползва измислен курс. |
| Backtest стои „pending“ | При `USE_CELERY=true` worker-ът трябва да върви и да вижда Redis (`docker compose logs worker`). |
| AI отговаря с offline обяснения въпреки ключа | `AI_PROVIDER=anthropic`, рестарт на backend-а, `GET /api/ai/status`. Грешките от API-то са в backend лога (без ключа). |
| `alembic upgrade head` → таблицата вече съществува | Базата е създадена с `AUTO_CREATE_TABLES=true`. За нова база: `alembic upgrade head`; за съществуваща dev база: `alembic stamp head`. |
| `docker compose build` → `CERTIFICATE_VERIFY_FAILED` при pip/npm | Мрежата ти минава през TLS-прихващащ proxy (корпоративен). Добави CA сертификата му в image-а чрез локален override файл (не го commit-вай) или build-вай от мрежа без прихващане. |
| Порт 3000/8000 е зает | `FRONTEND_PORT=3001 BACKEND_PORT=8001 docker compose up` |
| SQLite `database is locked` | Една dev база е за един backend процес. За повече процеси използвай PostgreSQL. |

---

## Security model

- **Само виртуални средства.** `LIVE_TRADING_AVAILABLE = False` (`backend/app/exchange/registry.py`).
  `get_adapter()` връща единствено paper адаптера; всеки друг режим хвърля `LiveTradingDisabledError` (HTTP 403).
  `FutureLiveExecutionAdapter` е изключен: не може да се създаде и всеки метод хвърля грешка. Няма env променлива,
  която да включи live trading. Тестове го проверяват, включително статично сканиране, че кодът не прави
  POST/PUT/PATCH/DELETE към външни услуги и не вика private/trading endpoints.
- **Разделение LIVE MARKET DATA ↔ PAPER EXECUTION.** Доставчиците на данни само четат цени, а paper engine-ът
  само симулира. Всеки отговор от API-то носи header `X-Execution-Mode: paper`.
- **Никога не се съхраняват** private keys, seed phrases, exchange API ключове, withdrawal/transfer права или
  платежни данни. Платформата не ги иска никъде; `PUT /api/settings` изхвърля непознати ключове.
- **Ключовете на доставчиците** (Twelve Data, Finnhub, CoinGecko, Anthropic) са само в environment и се редактират
  от всеки текст за грешка и лог (`redact_secrets`). Settings → Data Sources показва само дали ключ е наличен.
- **Честни данни:** DEMO винаги е маркирано; липсващи данни → DATA NOT AVAILABLE; без silent fallback от live към demo.
- **AI safety:** без „BUY NOW“, гаранции, „100% win“, „risk-free“, ценови прогнози; стратегиите са „rule-based
  hypothetical setup“; leverage никога не се препоръчва.
- Пароли: scrypt. Сесии: случаен токен в HttpOnly, SameSite=Lax бисквитка, в базата се пази само HMAC hash.
- CSRF защита чрез задължителен header, rate limit за вход, security headers, валидация на всички входове
  (pydantic, отказ на NaN/Infinity, строги типове за настройките), guest изолация между потребителите.
- Външни данни само през официални API-та, със спазване на rate limits. Без scraping и без заобикаляне на CAPTCHA
  или автентикация.
- Ако в бъдеще се добави реална борса, планът (отделен модул, encrypted storage, least privilege, без
  withdrawal/transfer права, изрично включване от потребителя) е описан в `docs/ARCHITECTURE.md` §16. Тази версия
  **не** го активира.

---

## Known limitations

- **Образователен симулатор, не борса.** Paper engine-ът моделира spread, такси, slippage, latency, partial fills,
  margin и stop-out по опростен модел (без order book, без funding/swap/overnight такси). Резултатите в paper
  trading, replay и backtest **не гарантират** бъдещи резултати.
- **DEMO данните са синтетични** — подходящи за учене на механиката, не за изводи за реален пазар.
- **Twelve Data free plan** (8 заявки/мин): котировки само on demand; universe-wide movers/heatmap за класовете на
  Twelve Data не се смятат. Някои индекси/стоки изискват платен план.
- **Synced инструментите** (discovery sync) нямат demo данни — без реален доставчик показват DATA NOT AVAILABLE.
- **Market cap** само за crypto и само с CoinGecko; **новини/календар** само с Finnhub ключ.
- **Offline AI** е rule-based: точен и безопасен, но по-шаблонен от Claude.
- **Rate limit за вход** е в паметта на процеса; **SQLite** е за един backend процес (за повече — PostgreSQL).
- Бутонът „By risk 1%“ в order ticket-а може да покаже риск малко над 1% (напр. 1.02%), защото demo цената се
  движи между последната котировка и preview-то.
- Интерфейсът е на български с английски trading термини; няма превключване на език.

---

## Структура на проекта

```
.
├── docker-compose.yml
├── .env.example
├── docs/ARCHITECTURE.md
├── e2e/                         Playwright walkthrough (npm run walkthrough)
├── backend/                     FastAPI + SQLAlchemy + Alembic + Celery
│   ├── Dockerfile
│   ├── alembic/                 миграции (0001_initial_schema, 0002_v2)
│   ├── app/
│   │   ├── api/                 REST endpoints (/api/...)
│   │   ├── models/              SQLAlchemy модели
│   │   ├── market/              каталог, provider chains (demo, Binance, Twelve Data), search, discovery, sessions, quote snapshots
│   │   ├── paper_engine/        PaperBroker — симулация на изпълнение, FX конверсия
│   │   ├── exchange/            paper адаптер, read-only market data адаптер, изключен live адаптер
│   │   ├── risk/                risk engine, position sizing, leverage математика
│   │   ├── indicators/          технически индикатори
│   │   ├── analysis/            candle patterns, структура, режим, signal engine
│   │   ├── strategies/          strategy DSL v2, шаблони, Strategy View
│   │   ├── backtesting/         backtester, метрики, validation
│   │   ├── bots/                статистика и coach за paper ботовете
│   │   ├── replay/              Market Replay: presets, scoring, review
│   │   ├── ai/                  LLM abstraction, teacher режими, review, coach, safety
│   │   ├── academy/             уроци, нива, quiz-ове, Candlestick и Market Structure Lab
│   │   ├── psychology/          откриване на поведение
│   │   ├── journal/ news/
│   │   ├── services/            бизнес логика
│   │   └── workers/             Celery задачи
│   └── tests/
└── frontend/                    Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4
    ├── Dockerfile
    ├── app/                     страници + /api proxy към backend-а
    ├── components/              ui, shell, market, charts, terminal, trading, labs, learn, ai, replay,
    │                            strategy, backtest, bots, dashboard, analytics, journal, risk
    └── lib/                     API клиент, hooks, речник, режими, hotkeys, форматиране
```

---

*Образователен софтуер. Нищо в платформата не е инвестиционен съвет. Никоя система не гарантира доход.
Резултатите от backtest, replay и paper trading не гарантират бъдещи резултати.*
