# Trading Academy — образователна платформа за trading и paper trading

**LEARN → UNDERSTAND → PRACTICE → BACKTEST → PAPER TRADE → REVIEW → IMPROVE**

Trading Academy е уеб платформа, в която човек може да научи как работят пазарите, да чете графики,
да тества стратегии върху исторически данни и да търгува **само с виртуални пари** ($10,000 paper акаунт),
преди изобщо да мисли за реален риск.

> ⚠️ **Това не е бот за „стабилни доходи“.** Никоя система не може да гарантира печалба. Платформата
> съществува, за да покаже честно дали една идея има предимство — включително когато отговорът е „не“.
> Всички сделки са симулирани. Няма реални поръчки, депозити, тегления или управление на истински средства.

---

## Съдържание

1. [Какво има вътре](#какво-има-вътре)
2. [Бърз старт (Docker)](#бърз-старт-docker)
3. [Демонстрация в 16 стъпки](#демонстрация-в-16-стъпки)
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
16. [Структура на проекта](#структура-на-проекта)

Подробният architecture plan (stack, комуникация, DB schema, paper engine, AI, backtesting, security,
бъдещи exchange интеграции) е в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Какво има вътре

| Модул | Какво прави |
|---|---|
| **Charts** | TradingView-подобен терминал (Lightweight Charts): свещи, обем, 1m–1W, индикатори (SMA, EMA, Bollinger Bands, VWAP, RSI, MACD, ATR, ADX, Volume SMA, Highest/Lowest), чертане (trend line, horizontal line, ray, rectangle, text, measure), сравнение на timeframes. |
| **Trading Academy** | Уроци от Level 0 до Price Action, интерактивни свещи с hover OHLC, анимирани сценарии, за всеки индикатор: *What it is / What it measures / How it is calculated / Uses / Common mistakes / When it fails*, quiz-ове, XP и прогрес. |
| **AI Teacher** | Обяснява пазара във формат OBSERVATION → ANALYSIS → HYPOTHESIS, никога като сигурност. Чат, „Teach me why“, decision panel. Работи offline (rule-based) или с Claude. |
| **Paper Trading** | Виртуален акаунт: market/limit/stop поръчки, SL/TP, частично затваряне, такси, spread, slippage, latency, partial fills, margin и ликвидация. |
| **Risk engine** | Position size calculator, R:R, предупреждения („This trade risks an unusually large portion of your account.“) — образователни, не блокиращи. |
| **Trade review** | Директна критика на всяка сделка: вход без стоп, преместен стоп, риск над правилото, R multiple, MFE/MAE. |
| **Strategy Builder** | Визуални правила IF / AND / THEN върху индикатори и цена, stop/target правила, regime филтър, шаблони. |
| **Backtesting Lab** | Сигнал на close → вход на следващия open (без lookahead), същият paper engine с разходи, validation: sample size, режими, drawdown, stress test, out-of-sample, overfitting. |
| **Bot Lab** | Paper ботове по стратегия (STOPPED / RUNNING / PAUSED), dashboard и лог. Само виртуално изпълнение. |
| **Signal engine** | LONG SETUP / SHORT SETUP / NO TRADE / WAIT с причини, market regime и confidence, който **не е** вероятност за печалба. |
| **Market Replay** | Търгуване върху минал период свещ по свещ, без да виждаш бъдещето. |
| **Journal, Stats, Psychology** | Дневник, performance report, откриване на поведение (revenge trading, overtrading…), седмичен AI Coach с NEXT LESSONS. |
| **Challenges, Dashboard, Watchlist** | Предизвикателства с XP, начално табло, списък за наблюдение. |

Всичко работи веднага с **DEMO данни** (детерминистични синтетични свещи, ясно маркирани като DEMO в UI)
и **offline AI** — не е нужен нито един API ключ.

---

## Бърз старт (Docker)

```bash
git clone https://github.com/19todorovv14/Analizatora-na-qndo.git
cd Analizatora-na-qndo
docker compose up --build
```

След като контейнерите станат healthy:

- Уеб приложение: **http://localhost:3000**
- API документация (Swagger): **http://localhost:8000/docs**
- Health check: http://localhost:8000/api/health → `"execution_mode": "paper", "live_trading": false`

Вход:

- **START LEARNING** или **OPEN PAPER TRADING** на началната страница създава изолиран guest профил с $10,000
  виртуални пари, без регистрация (по-късно може да го запазиш с имейл и парола чрез „Запази профила“).
- или демо акаунт: **`demo@trading-academy.local` / `Demo12345`**

---

## Демонстрация в 16 стъпки

| # | Действие | Къде |
|---|---|---|
| 1 | Отвори chart | **Charts** |
| 2 | Виж candlesticks (задръж мишката за OHLC) | Charts |
| 3 | Смени timeframe | лентата 1m … 1W над графиката |
| 4 | Добави indicator | бутон **ƒx** → напр. RSI, MACD |
| 5 | Прочети урок | **Learn** → напр. „Candlestick“ |
| 6 | Направи quiz | Learn → Quiz: Level 0 |
| 7 | Отвори paper account | **Paper Trading** |
| 8 | Направи виртуален trade | Order panel → BUY / SELL |
| 9 | Постави SL/TP | полета Stop Loss / Take Profit (бързи бутони 1%, 2R…) |
| 10 | Затвори позицията | Positions → Close (или частично) |
| 11 | Виж P/L | Positions / History / метриките на акаунта |
| 12 | Направи trade review | History → **AI review** |
| 13 | Създай strategy | **Strategies** → нова или копие от шаблон |
| 14 | Стартирай backtest | **Backtesting** → Run backtest |
| 15 | Създай paper bot | **Bot Lab** → Create paper bot → ▶ Start |
| 16 | Виж performance report | **Statistics** |

При първото влизане guided tour показва основните зони. Бутоните „Why am I seeing this?“ и иконите ⓘ
обясняват всеки елемент. Превключвателят **Beginner / Advanced** в горната лента сменя нивото на детайл.

---

## Installation

Изисквания:

| Начин | Нужно |
|---|---|
| Docker (препоръчително) | Docker Engine 24+ с Compose v2 |
| Локално | Python 3.11+ (тествано с 3.12/3.13), Node.js 20.9+ (тествано с 22), npm |
| По избор | PostgreSQL 14+ и Redis 6+ (за production-подобна среда без Docker) |

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
в базата данни и не се изпраща към браузъра.

- `/.env.example` — за `docker compose` (копирай като `.env` в корена)
- `/backend/.env.example` — за локален backend (копирай като `backend/.env`)
- `/frontend/.env.example` — за локален frontend (копирай като `frontend/.env.local`)

### Backend

| Променлива | Default | Описание |
|---|---|---|
| `APP_ENV` | `development` | `development` / `production` / `test`. В production стартът спира, ако `SECRET_KEY` не е сменен. |
| `DATABASE_URL` | `sqlite:///./trading_academy.db` | Production: `postgresql+psycopg://user:pass@host:5432/db` |
| `AUTO_CREATE_TABLES` | `true` | Създава таблиците при старт (dev). В production използвай Alembic. |
| `SEED_DEMO_DATA` | `true` | Активи, уроци, шаблони за стратегии и демо потребител (идемпотентно). |
| `USE_CELERY` | `false` | `true` → backtest-ите вървят в Celery worker, beat синхронизира SL/TP и ботове. |
| `REDIS_URL` | — | Broker за Celery, напр. `redis://localhost:6379/0`. |
| `SECRET_KEY` | `dev-insecure-…` | Дълга случайна стойност. Използва се за HMAC на session токените. |
| `COOKIE_SECURE` | `false` | `true` зад HTTPS. |
| `SESSION_DAYS` | `30` | Валидност на сесията. |
| `CORS_ORIGINS` | `http://localhost:3000` | Разделени със запетая. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `20` | Опити за вход/регистрация на IP в минута. |
| `MARKET_DATA_CRYPTO` | `demo` | `demo` / `binance` / `twelvedata` |
| `MARKET_DATA_FX` | `demo` | `demo` / `twelvedata` |
| `MARKET_DATA_STOCKS` | `demo` | `demo` / `twelvedata` (акции, индекси, стоки) |
| `BINANCE_BASE_URL` | `https://data-api.binance.vision` | Публичен read-only market data endpoint. |
| `TWELVEDATA_API_KEY` | — | Ключ от twelvedata.com. |
| `FINNHUB_API_KEY` | — | По избор: новини (никога не се ползват като сигнал). |
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

Освен backend променливите: `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

---

## Database setup

**Development — SQLite (по подразбиране).** Нищо не се инсталира: при старт backend-ът създава
`backend/trading_academy.db` (WAL mode, foreign keys включени) и зарежда demo данните.

**PostgreSQL.**

```bash
createuser trading --pwprompt
createdb trading_academy -O trading

# backend/.env
DATABASE_URL=postgresql+psycopg://trading:<парола>@localhost:5432/trading_academy
AUTO_CREATE_TABLES=false

cd backend
alembic upgrade head        # схемата (28 таблици)
python -m app.seed          # активи, уроци, шаблони, демо потребител — може да се пуска многократно
```

**Миграции при промяна на моделите** (`backend/app/models/`):

```bash
cd backend
alembic revision --autogenerate -m "описание"
alembic upgrade head
alembic upgrade head --sql   # само показва SQL-а, без да го изпълнява
```

Основни таблици: `users`, `user_sessions`, `assets`, `watchlist_items`, `candles`, `indicators`, `strategies`,
`strategy_rules`, `paper_accounts`, `paper_orders`, `paper_positions`, `paper_trades`, `paper_events`,
`replay_sessions`, `journal_entries`, `lessons`, `learning_progress`, `quiz_results`, `challenge_progress`,
`bots`, `bot_runs`, `bot_logs`, `backtests`, `backtest_trades`, `risk_events`, `ai_sessions`, `ai_messages`.
Описание на всяка — в `docs/ARCHITECTURE.md`.

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

По избор, фонови задачи с Celery (иначе backtest-ите вървят като FastAPI background tasks, а paper
акаунтите и ботовете се синхронизират, когато потребителят отвори приложението):

```bash
docker run -d -p 6379:6379 redis:7-alpine
# backend/.env: USE_CELERY=true, REDIS_URL=redis://localhost:6379/0
celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info
```

Полезни команди:

```bash
cd backend && ruff check .          # lint
cd frontend && npm run lint         # ESLint (вкл. React Compiler правила)
cd frontend && npx tsc --noEmit     # type check
```

Как да добавиш:

- **индикатор** — функция в `backend/app/indicators/__init__.py`, запис в `INDICATOR_CATALOG` и клон в `compute()`; Strategy Builder-ът го взима от API-то, а менюто ƒx на графиката — от `frontend/lib/indicators.ts`.
- **урок** — `backend/app/academy/content/`; seed-ът го записва в `lessons`.
- **актив** — `backend/app/market/catalog.py` (spread, такси, стъпка на количеството, leverage, символи при доставчиците).

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

# frontend
cd frontend && npm ci && npm run build
BACKEND_URL=http://127.0.0.1:8000 node .next/standalone/server.js
# (standalone изходът изисква копиране на .next/static и public до server.js — виж frontend/Dockerfile)
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

Пазарните данни са **read-only**. Изпълнението на сделки винаги остава PAPER, независимо откъде идват цените.
UI-ят показва източника до всяка графика (DEMO / Binance / Twelve Data).

Доставчикът се избира отделно за всеки клас активи:

| Клас | Активи | Възможни доставчици |
|---|---|---|
| Crypto (`MARKET_DATA_CRYPTO`) | BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT | `demo`, `binance`, `twelvedata` |
| Forex (`MARKET_DATA_FX`) | EUR/USD, GBP/USD, AUD/USD | `demo`, `twelvedata` |
| Други (`MARKET_DATA_STOCKS`) | XAU/USD, WTI/USD, SPX, NDX, GER40, AAPL, TSLA, NVDA | `demo`, `twelvedata` |

**Demo** — синтетични данни със смяна на режими (тренд/range/висока волатилност), съгласувани между
всички timeframes, без „надникване“ в бъдещето за текущата свещ. Работят offline и са маркирани DEMO.

**Binance (crypto, без ключ):**

```env
MARKET_DATA_CRYPTO=binance
# BINANCE_BASE_URL=https://data-api.binance.vision   (публичен market-data endpoint)
```

Използват се само публичните `klines` и `ticker` endpoints. Не се изисква и не се приема API ключ.
Заявките минават през rate limiter (под публикуваните лимити) и кратък кеш; при 429/418 клиентът спира.

**Twelve Data (forex, акции, индекси, стоки, crypto):**

1. Регистрация на https://twelvedata.com → API key.
2. В `.env`:
   ```env
   TWELVEDATA_API_KEY=<ключ>
   MARKET_DATA_FX=twelvedata
   MARKET_DATA_STOCKS=twelvedata
   ```
3. Безплатният план е 8 заявки/минута — клиентът го спазва автоматично (по-бавно зареждане при много графики).
   Някои инструменти (индекси, стоки) може да изискват платен план; тогава UI-ят показва грешката на доставчика.

**Нов доставчик:** наследи `MarketDataProvider` (`backend/app/market/base.py`), имплементирай `supports`,
`get_candles`, `get_ticker`, регистрирай го в `_FACTORIES` в `backend/app/market/registry.py` и добави символите
в `provider_symbols` в `catalog.py`. Доставчиците нямат достъп до paper engine-а и обратно.

**Новини (по избор):** `FINNHUB_API_KEY` от finnhub.io. Новините се показват като контекст и рисков фактор,
никога като сигнал за вход.

---

## AI provider setup

Количествените изчисления (индикатори, режим, нива, risk, backtest) **винаги** се правят от кода.
AI само **обяснява** вече изчислените данни, а всеки отговор минава през safety филтър, който спира
фрази като „BUY NOW“, „guaranteed profit“, „100% win“, „risk-free“, „easy money“.

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
3. Рестартирай backend-а. `GET /api/ai/status` показва активния provider.

Заявките използват официалния `anthropic` Python SDK с включени server-side fallbacks (`fallbacks="default"`):
ако моделът откаже заявка, API-то я изпълнява автоматично с препоръчания резервен модел вместо да върне отказ.
Ако API-то е недостъпно, платформата показва offline обяснението, т.е. нищо не спира да работи.

**Друг LLM:** наследи `LLMProvider` в `backend/app/ai/providers.py` (един метод `complete`) и го добави в `get_llm`.

---

## Testing

```bash
cd backend
pytest                 # 144 теста
pytest --cov=app       # с coverage
ruff check .
```

Покритие: paper trading, position sizing, risk calculations, orders, stops, take profits, fees, slippage,
partial fills, ликвидация, backtesting (без lookahead, validation), индикатори, strategy engine, signal engine,
database constraints, authentication и sessions, CSRF, API endpoints, AI safety филтър и гаранцията, че live
trading адаптер не може да бъде създаден.

Frontend:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

---

## Docker

`docker-compose.yml` стартира:

| Service | Image | Роля |
|---|---|---|
| `frontend` | `frontend/Dockerfile` (Next.js standalone, node:22-alpine) | Уеб приложението, порт 3000 |
| `backend` | `backend/Dockerfile` (python:3.12-slim) | `alembic upgrade head` → seed → uvicorn, порт 8000 |
| `worker` | същият image | Celery worker (backtests) |
| `beat` | същият image | Celery beat: SL/TP на отворени paper позиции (20 s), paper ботове (30 s) |
| `postgres` | postgres:17-alpine | База данни (volume `pgdata`) |
| `redis` | redis:7-alpine | Broker за Celery |

```bash
docker compose up --build            # всичко
docker compose up -d --build         # във фон
docker compose logs -f backend       # логове
docker compose down                  # спиране
docker compose down -v               # спиране + изтриване на базата
FRONTEND_PORT=8080 docker compose up # друг порт
```

Контейнерите вървят като non-root потребител; backend-ът има healthcheck и frontend/worker/beat изчакват
базата да е мигрирана.

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
| Графиката е празна | Отвори `/api/market/candles?symbol=BTC/USDT&timeframe=1h` и виж грешката. При Twelve Data — ключ, лимит на плана или неподдържан инструмент. Върни `demo` за проверка. |
| „Provider 'binance' does not support EUR/USD“ | Binance има само crypto. За forex/акции използвай `twelvedata` или `demo`. |
| Backtest стои „pending“ | При `USE_CELERY=true` worker-ът трябва да върви и да вижда Redis (`docker compose logs worker`). |
| AI отговаря с offline обяснения въпреки ключа | `AI_PROVIDER=anthropic`, рестарт на backend-а, `GET /api/ai/status`. Грешките от API-то са в backend лога. |
| `alembic upgrade head` → таблицата вече съществува | Базата е създадена с `AUTO_CREATE_TABLES=true`. За нова база: `alembic upgrade head`; за съществуваща dev база: `alembic stamp head`. |
| `docker compose build` → `CERTIFICATE_VERIFY_FAILED` при pip/npm | Мрежата ти минава през TLS-прихващащ proxy (корпоративен). Добави CA сертификата му в image-а или build-вай от мрежа без прихващане. |
| Порт 3000/8000 е зает | `FRONTEND_PORT=3001 BACKEND_PORT=8001 docker compose up` |
| SQLite `database is locked` | Една dev база е за един backend процес. За повече процеси използвай PostgreSQL. |

---

## Security model

- **Само виртуални средства.** `LIVE_TRADING_AVAILABLE = False` (`backend/app/exchange/registry.py`).
  `get_adapter()` връща единствено `PaperExchangeAdapter`, а всеки друг режим хвърля `LiveTradingDisabledError`.
  Тест проверява, че това не може да се заобиколи.
- **Разделение LIVE MARKET DATA ↔ PAPER EXECUTION.** Доставчиците на данни само четат цени, а paper engine-ът
  само симулира. Всеки отговор от API-то носи header `X-Execution-Mode: paper`.
- **Никога не се съхраняват** private keys, seed phrases, exchange API ключове, withdrawal/transfer права или
  платежни данни. Платформата не ги иска никъде.
- Пароли: scrypt. Сесии: случаен токен в HttpOnly, SameSite=Lax бисквитка, в базата се пази само HMAC hash.
- CSRF защита чрез задължителен header, rate limit за вход, security headers, валидация на всички входове (pydantic).
- Външни данни само през официални API-та, със спазване на rate limits. Без scraping и без заобикаляне на CAPTCHA или автентикация.
- Ако в бъдеще се добави реална борса, планът (отделен модул, encrypted storage, least privilege, без
  withdrawal/transfer права, изрично включване от потребителя) е описан в `docs/ARCHITECTURE.md` §9. Тази версия
  **не** го активира.

---

## Структура на проекта

```
.
├── docker-compose.yml
├── .env.example
├── docs/ARCHITECTURE.md
├── backend/                     FastAPI + SQLAlchemy + Alembic + Celery
│   ├── Dockerfile
│   ├── alembic/                 миграции
│   ├── app/
│   │   ├── api/                 REST endpoints (/api/...)
│   │   ├── models/              SQLAlchemy модели
│   │   ├── market/              MarketDataProvider: demo, Binance, Twelve Data
│   │   ├── paper_engine/        PaperBroker — симулация на изпълнение
│   │   ├── exchange/            ExchangeAdapter (само PaperExchangeAdapter)
│   │   ├── risk/                risk engine, position sizing
│   │   ├── indicators/          технически индикатори
│   │   ├── analysis/            структура, режим, signal engine
│   │   ├── strategies/          strategy DSL и оценка на правила
│   │   ├── backtesting/         backtester, метрики, validation
│   │   ├── bots/                paper ботове
│   │   ├── ai/                  LLM abstraction, teacher, review, coach, safety
│   │   ├── academy/             уроци, quiz-ове, challenges
│   │   ├── psychology/          откриване на поведение
│   │   ├── journal/ news/
│   │   ├── services/            бизнес логика
│   │   └── workers/             Celery задачи
│   └── tests/
└── frontend/                    Next.js (App Router) + React + TypeScript + Tailwind
    ├── Dockerfile
    ├── app/                     страници + /api proxy към backend-а
    ├── components/              charts, trading, academy, strategy, backtest, ai, journal, risk, shell, ui
    └── lib/                     API клиент, hooks, форматиране
```

---

*Образователен софтуер. Нищо в платформата не е инвестиционен съвет. Резултатите от backtest и paper trading
не гарантират бъдещи резултати.*
