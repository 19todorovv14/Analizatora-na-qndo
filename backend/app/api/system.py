"""DATA SOURCES & AI SETTINGS info (work package S7) — read-only status for /settings/data-sources and /settings/ai.

Nothing here accepts or returns a secret: API keys are configured ONLY through server environment variables
(backend/.env) and are reported as booleans (`key_present`). Provider reachability is a cached health check
(GET …?check=true, at most once per HEALTH_TTL per provider) that never sends a key; it is disabled in tests
(APP_ENV=test) so the test suite never touches the network.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import modes as ai_modes
from app.ai.providers import get_llm, provider_status
from app.ai.safety import STANDARD_DISCLAIMER
from app.api.deps import current_user, now_ts
from app.config import get_settings
from app.database import get_db
from app.journal.performance import CLASS_LABELS_BG
from app.market import marketcap
from app.market.base import MarketDataError
from app.market.catalog import ASSET_CLASSES, all_assets
from app.market.overview import ENGINE, scrub_secrets
from app.market.providers import CLASS_PROVIDERS
from app.market.registry import PROVIDER_IDS, class_provider, get_router
from app.models import CatalogSync, User
from app.news import providers as news_providers
from app.services import settings_service
from app.strategies.meta import SETUP_DISCLAIMER

router = APIRouter(prefix="/system", tags=["system"])

HEALTH_TTL = 300  # seconds a reachability result is reused
HEALTH_TIMEOUT = 5.0
LAST_SYNCS = 10

KEYS_POLICY = (
    "API ключовете се задават САМО като environment variables на сървъра (backend/.env) и никога не се показват, "
    "не се приемат и не се записват от приложението — тук виждаш само дали ключ е наличен (да/не). "
    "Платформата използва единствено read-only пазарни данни и НИКОГА не иска ключове с trading или withdrawal "
    "права, private keys или seed phrases. Всички сделки са PAPER (виртуални пари)."
)
PAPER_NOTE = "Изпълнението на сделки винаги е PAPER (виртуално) — LIVE данните са само за четене."

PROVIDER_INFO: dict[str, dict] = {
    "demo": {
        "name": "DEMO (синтетични данни)",
        "key_env": None,
        "rate_limit": "Няма лимит — детерминистични синтетични свещи, генерирани локално.",
        "docs_url": None,
        "note": "Синтетични данни за обучение, винаги маркирани като DEMO. Не са реални цени.",
        "how_to_enable": "Включен по подразбиране (стойност demo във веригата на класа).",
    },
    "binance": {
        "name": "Binance public market data",
        "key_env": None,
        "rate_limit": "≈8 заявки/сек (token bucket, burst 16) — далеч под публичните лимити на Binance; "
        "отговорите се кешират.",
        "docs_url": "https://www.binance.com/en/binance-api",
        "note": "Реални публични крипто данни (read-only), без API ключ.",
        "how_to_enable": "Задай MARKET_DATA_CRYPTO=binance в backend/.env (или верига binance,twelvedata) и "
        "рестартирай backend-а. Не е нужен API ключ.",
    },
    "twelvedata": {
        "name": "Twelve Data",
        "key_env": "TWELVEDATA_API_KEY",
        "rate_limit": "Free plan: 8 заявки/минута (800/ден) — платформата се самоограничава до 8/мин. "
        "Пазарните класации не се изчисляват от Twelve Data; цените се зареждат on demand на страницата на "
        "актива. Basic плановете дават закъснели (DELAYED) котировки.",
        "docs_url": "https://twelvedata.com",
        "note": "Акции, ETF, Forex, индекси, стоки (и крипто) — read-only.",
        "how_to_enable": "1) Създай безплатен ключ на twelvedata.com. 2) Добави TWELVEDATA_API_KEY=<ключ> в "
        "backend/.env. 3) Задай MARKET_DATA_STOCKS=twelvedata (и/или MARKET_DATA_FX, MARKET_DATA_ETF, "
        "MARKET_DATA_INDICES, MARKET_DATA_COMMODITIES). 4) Рестартирай backend-а. При real-time план задай "
        "TWELVEDATA_REALTIME=true. Ключът остава само на сървъра.",
    },
}


# ------------------------------------------------------------------ cached reachability (health check)
_health: dict[str, dict] = {}
_health_lock = threading.Lock()


def network_checks_enabled() -> bool:
    """Reachability checks touch the network — never in tests (APP_ENV=test)."""
    return get_settings().app_env != "test"


def probe(url: str, timeout: float = HEALTH_TIMEOUT) -> dict:
    """GET `url` WITHOUT any key; any HTTP answer below 500 means the host is reachable."""
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url)
    except httpx.HTTPError as exc:
        return {"reachable": False, "latency_ms": None, "http_status": None,
                "error": scrub_secrets(f"{type(exc).__name__}: {exc}")}
    latency = round((time.perf_counter() - started) * 1000)
    ok = resp.status_code < 500
    return {"reachable": ok, "latency_ms": latency, "http_status": resp.status_code,
            "error": None if ok else f"HTTP {resp.status_code}"}


def probe_targets() -> dict[str, str]:
    """provider id → health URL (no credentials in any of them)."""
    s = get_settings()
    return {
        "binance": f"{s.binance_base_url.rstrip('/')}/api/v3/ping",
        "twelvedata": f"{s.twelvedata_base_url.rstrip('/')}/api_usage",
        "coingecko": f"{s.coingecko_base_url.rstrip('/')}/ping",
        "finnhub": f"{s.finnhub_base_url.rstrip('/')}/",
    }


def _unchecked() -> dict:
    return {"reachable": None, "checked_at": None, "latency_ms": None, "http_status": None, "error": None,
            "stale": True}


def health(provider_id: str, now: int) -> dict:
    """Cached reachability of a provider ({reachable: bool|None, checked_at, latency_ms, http_status, error, stale})."""
    if provider_id == "demo":
        return {"reachable": True, "checked_at": now, "latency_ms": 0, "http_status": None, "error": None,
                "stale": False, "local": True}
    with _health_lock:
        hit = _health.get(provider_id)
    if hit is None:
        return _unchecked()
    return {**hit, "stale": now - hit["checked_at"] >= HEALTH_TTL}


def refresh_health(provider_ids: list[str], now: int) -> list[str]:
    """Probe the providers whose cached result is missing or older than HEALTH_TTL (in parallel). Returns the
    provider ids that were probed now. No-op when network checks are disabled."""
    if not network_checks_enabled():
        return []
    targets = probe_targets()
    with _health_lock:
        due = [
            p for p in dict.fromkeys(provider_ids)
            if p in targets and (p not in _health or now - _health[p]["checked_at"] >= HEALTH_TTL)
        ]
    if not due:
        return []
    with ThreadPoolExecutor(max_workers=len(due)) as pool:
        results = dict(zip(due, pool.map(lambda p: probe(targets[p]), due), strict=True))
    with _health_lock:
        for p, res in results.items():
            _health[p] = {**res, "checked_at": now}
    return due


def clear_health() -> None:
    with _health_lock:
        _health.clear()


# ------------------------------------------------------------------ data sources
def _key_present(provider_id: str) -> bool | None:
    env = PROVIDER_INFO.get(provider_id, {}).get("key_env")
    if not env:
        return None  # no key needed
    return bool(getattr(get_settings(), env.lower(), None))


def _class_chain(cls: str) -> tuple[list[str], str, str | None, bool]:
    """(chain, env var, fallback env var, inherited from the fallback?)"""
    pcls = CLASS_PROVIDERS[cls]
    s = get_settings()
    own = getattr(s, pcls.setting, None)
    inherited = bool(pcls.fallback_setting) and (own is None or not str(own).strip())
    return (
        list(pcls.chain_from_settings(s)),
        pcls.setting.upper(),
        pcls.fallback_setting.upper() if pcls.fallback_setting else None,
        inherited,
    )


def _chain_entry(cp, name: str, supported: int) -> dict:
    try:
        provider = cp.backend(name)
    except MarketDataError as exc:
        return {"id": name, "known": False, "status": "unavailable", "problem": scrub_secrets(exc),
                "supported_instruments": 0}
    problem = provider.config_problem()
    return {
        "id": name,
        "known": True,
        "name": provider.source.name,
        "status": "unavailable" if problem else provider.source.effective_status,
        "problem": scrub_secrets(problem) if problem else None,
        "supported_instruments": supported,
    }


def catalog_block(now: int) -> tuple[dict, dict[str, dict]]:
    """(catalog summary, per-class instrument counts) over curated + synced instruments — cheap, no network."""
    per_class: dict[str, dict] = {
        cls: {"total": 0, "available": 0, "by_source": {}, "by_provider": dict.fromkeys(PROVIDER_IDS, 0),
              "serving": {}}
        for cls in ASSET_CLASSES
    }
    providers = {cls: class_provider(cls) for cls in ASSET_CLASSES}
    backends = {}
    for name in PROVIDER_IDS:
        try:
            backends[name] = providers["crypto"].backend(name)
        except MarketDataError:
            continue
    by_source: dict[str, int] = {}
    total = 0
    for spec in all_assets():
        block = per_class.get(spec.asset_class)
        if block is None:
            continue
        total += 1
        block["total"] += 1
        block["by_source"][spec.source] = block["by_source"].get(spec.source, 0) + 1
        by_source[spec.source] = by_source.get(spec.source, 0) + 1
        for name, backend in backends.items():
            if backend.supports(spec):
                block["by_provider"][name] += 1
        avail = providers[spec.asset_class].availability(spec)
        if avail["available"]:
            block["available"] += 1
            pid = avail["provider_id"]
            block["serving"][pid] = block["serving"].get(pid, 0) + 1
    s = get_settings()
    return (
        {
            "total": total,
            "by_class": {cls: per_class[cls]["total"] for cls in ASSET_CLASSES},
            "by_source": by_source,
            "available": sum(b["available"] for b in per_class.values()),
            "auto_sync": bool(s.catalog_auto_sync),
            "binance_quotes": s.catalog_quotes,
            "twelvedata_countries": s.catalog_countries,
            "how_to_sync": (
                "Каталогът се разширява от публичните списъци с инструменти на Binance / Twelve Data (без ключ): "
                "`python -m app.market.discovery all` или CATALOG_AUTO_SYNC=true (Celery beat, ежедневно)."
            ),
        },
        per_class,
    )


def last_syncs(db: Session) -> list[dict]:
    rows = db.scalars(select(CatalogSync).order_by(CatalogSync.id.desc()).limit(LAST_SYNCS))
    return [
        {
            "id": r.id,
            "provider": r.provider,
            "kind": r.kind,
            "status": r.status,
            "count": r.count,
            "started_ts": r.started_ts,
            "finished_ts": r.finished_ts,
            "message": scrub_secrets(r.message or "") or None,
        }
        for r in rows
    ]


def _class_how_to(cls: str, env: str, fallback: str | None, supported: dict[str, int]) -> str:
    live = [p for p in ("binance", "twelvedata") if supported.get(p)]
    if not live:
        return "Няма реален доставчик в каталога за този клас — остава DEMO / DATA NOT AVAILABLE."
    parts = []
    for p in live:
        if p == "twelvedata":
            parts.append(f"{env}=twelvedata + TWELVEDATA_API_KEY")
        else:
            parts.append(f"{env}=binance (без ключ)")
    text = "За реални данни задай " + " или ".join(parts) + " в backend/.env и рестартирай backend-а."
    if len(live) > 1:
        text += f" Верига ({env}={','.join(live)}) използва първия доставчик, който поддържа инструмента."
    if fallback:
        text += f" Ако {env} не е зададен, се използва {fallback}."
    return text


def data_sources(db: Session, now: int) -> dict:
    s = get_settings()
    catalog, counts = catalog_block(now)
    chains = get_router().chains()
    used = sorted({p for chain in chains.values() for p in chain if p in PROVIDER_IDS})

    classes = []
    for cls in ASSET_CLASSES:
        chain, env, fallback, inherited = _class_chain(cls)
        cp = class_provider(cls)
        c = counts[cls]
        entries = [_chain_entry(cp, name, c["by_provider"].get(name, 0)) for name in chain]
        active = next((e for e in entries if e["status"] != "unavailable"), None)
        status = active["status"] if active else "unavailable"
        if not chain:
            reason = f"Няма конфигуриран доставчик ({env} е празен) — DATA NOT AVAILABLE."
        elif active is None:
            reason = "; ".join(e["problem"] for e in entries if e.get("problem")) or "DATA NOT AVAILABLE"
        else:
            reason = None
        classes.append(
            {
                "asset_class": cls,
                "label": CLASS_LABELS_BG[cls],
                "env": env,
                "fallback_env": fallback,
                "inherited": inherited,
                "chain": chain,
                "providers": entries,
                "source": cp.source.to_dict(),
                "status": status,  # live | delayed | demo | unavailable
                "available": active is not None,
                "reason": reason,
                "instruments": {
                    "total": c["total"],
                    "available": c["available"],
                    "by_source": c["by_source"],
                    "serving": c["serving"],
                    "supported_by": c["by_provider"],
                },
                "how_to_enable": _class_how_to(cls, env, fallback, c["by_provider"]),
            }
        )

    providers = {}
    for pid in PROVIDER_IDS:
        info = PROVIDER_INFO.get(pid, {})
        try:
            src = class_provider("crypto").backend(pid)
            problem = src.config_problem()
            source = src.source.to_dict()
        except MarketDataError as exc:
            problem, source = scrub_secrets(exc), None
        key_env = info.get("key_env")
        providers[pid] = {
            "id": pid,
            "name": info.get("name") or (source or {}).get("name") or pid,
            "status": (source or {}).get("status", "unavailable") if not problem else "unavailable",
            "source": source,
            "used_by": [cls for cls in ASSET_CLASSES if pid in chains.get(cls, [])],
            "configured": pid in used and problem is None,
            "key_required": key_env is not None,
            "key_env": key_env,
            "key_present": _key_present(pid),
            "problem": problem,
            **health(pid, now),
            "rate_limit": info.get("rate_limit"),
            "docs_url": info.get("docs_url"),
            "note": info.get("note"),
            "how_to_enable": info.get("how_to_enable"),
        }

    mc_name = marketcap.provider_name()
    mc_configured = mc_name == "coingecko"
    news_key = bool(s.finnhub_api_key)
    return {
        "as_of": now,
        "keys_policy": KEYS_POLICY,
        "paper_note": PAPER_NOTE,
        "classes": classes,
        "providers": providers,
        "catalog": {**catalog, "last_syncs": last_syncs(db)},
        "market_cap": {
            "provider": mc_name,
            "configured": mc_configured,
            "status": "live" if mc_configured else "unavailable",
            "key_env": "COINGECKO_API_KEY",
            "key_required": False,
            "key_present": bool(s.coingecko_api_key),
            **(health("coingecko", now) if mc_configured else _unchecked()),
            "used_for": "Размер на плочките в крипто heatmap-а (пазарна капитализация).",
            "rate_limit": "Кеш 15 минути; след грешка нов опит след 2 минути.",
            "how_to_enable": "Задай MARKET_CAP_PROVIDER=coingecko в backend/.env (публичен read-only API; "
            "по желание COINGECKO_API_KEY за demo plan) и рестартирай backend-а. Без доставчик пазарната "
            "капитализация е DATA NOT AVAILABLE — стойностите не се измислят.",
            "docs_url": "https://www.coingecko.com/en/api",
        },
        "news": {
            "provider": "finnhub" if news_key else "none",
            "configured": news_key,
            "status": "live" if news_key else "unavailable",
            "key_env": "FINNHUB_API_KEY",
            "key_required": True,
            "key_present": news_key,
            **(health("finnhub", now) if news_key else _unchecked()),
            "used_for": "Новини и календар на събития (контекст, не trading сигнал).",
            "rate_limit": "Free plan: 60 заявки/минута; новините се кешират 5 минути, календарът 30 минути.",
            "how_to_enable": news_providers.HOW_TO_ENABLE,
            "disclaimer": news_providers.DISCLAIMER,
            "docs_url": "https://finnhub.io",
        },
        "warmup": ENGINE.warmup_status(),
        "health_checks": {
            "enabled": network_checks_enabled(),
            "ttl_seconds": HEALTH_TTL,
            "method": "HTTP GET към публичен endpoint на доставчика без ключ; кешира се за ttl_seconds.",
        },
        "how_to_enable": [
            "1) Отвори backend/.env на сървъра (никога не въвеждай ключове в браузъра).",
            "2) Избери доставчик за всеки клас: MARKET_DATA_CRYPTO, MARKET_DATA_STOCKS, MARKET_DATA_FX, "
            "MARKET_DATA_ETF, MARKET_DATA_INDICES, MARKET_DATA_COMMODITIES (стойности demo, binance, twelvedata "
            "или верига, напр. binance,twelvedata).",
            "3) Добави нужните read-only ключове: TWELVEDATA_API_KEY, FINNHUB_API_KEY (новини), "
            "по желание COINGECKO_API_KEY.",
            "4) Рестартирай backend-а и обнови тази страница.",
        ],
    }


@router.get("/data-sources")
def get_data_sources(
    check: bool = Query(False, description="refresh the cached reachability (≤ once per 5 min per provider)"),
    _user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    now = now_ts()
    probed: list[str] = []
    if check:
        s = get_settings()
        wanted = [p for chain in get_router().chains().values() for p in chain if p != "demo"]
        if marketcap.provider_name() == "coingecko":
            wanted.append("coingecko")
        if s.finnhub_api_key:
            wanted.append("finnhub")
        probed = refresh_health(wanted, now)
    return {**data_sources(db, now), "checked": probed}


# ------------------------------------------------------------------ AI settings
SAFETY_RULES: list[dict] = [
    {"key": "no_predictions", "title": "Без прогнози",
     "text": "AI не предсказва цени и не казва накъде „ще отиде“ пазарът — описва данните и правилата."},
    {"key": "no_commands", "title": "Без команди за покупка/продажба",
     "text": "Фрази като BUY NOW / SELL NOW / „купи веднага“ се премахват от safety филтъра."},
    {"key": "no_guarantees", "title": "Без гаранции",
     "text": "Забранени са „guaranteed“, „100% win“, „risk-free“, „easy money“, „сигурна печалба“ и подобни."},
    {"key": "structured", "title": "Структуриран отговор",
     "text": "OBSERVATION / RULES / SCENARIO / INVALIDATION / RISK / ALTERNATIVE SCENARIO — всеки сценарий има "
     "условие за невалидност и алтернатива."},
    {"key": "engine_numbers", "title": "Числата идват от engine-а",
     "text": "Индикатори, нива и статистики се изчисляват от платформата; AI само ги обяснява и никога не "
     "измисля пазарни числа. Липсващи данни = DATA NOT AVAILABLE."},
    {"key": "hypothetical_setups", "title": "Хипотетични setup-и",
     "text": f"Rule-based setup-ите винаги носят: „{SETUP_DISCLAIMER}“"},
    {"key": "no_leverage_advice", "title": "Без препоръка за leverage",
     "text": "AI никога не препоръчва leverage; обяснява как увеличава експозицията и риска от ликвидация."},
    {"key": "paper_only", "title": "Само PAPER",
     "text": "Всички сделки са виртуални. AI няма достъп до реални сметки и не изпълнява реални поръчки."},
    {"key": "safety_filter", "title": "Safety filter",
     "text": "Всеки AI отговор (offline или Claude) минава през safety филтъра, преди да стигне до теб."},
]


def ai_settings(user: User) -> dict:
    s = get_settings()
    status = provider_status()
    llm = get_llm()
    key_present = bool(s.anthropic_api_key)
    offline = llm is None
    if s.ai_provider == "anthropic" and not key_present:
        fallback_reason = "AI_PROVIDER=anthropic, но ANTHROPIC_API_KEY липсва — използва се offline teacher."
    elif offline:
        fallback_reason = "AI_PROVIDER=offline — детерминистичен rule-based teacher, без външен AI."
    else:
        fallback_reason = None
    return {
        "provider": s.ai_provider,
        "active": status["active"],
        "model": s.anthropic_model if not offline else None,
        "configured_model": s.anthropic_model,
        "effort": s.ai_effort,
        "max_tokens": s.ai_max_tokens,
        "timeout_seconds": s.ai_timeout_seconds,
        "key_env": "ANTHROPIC_API_KEY",
        "key_present": key_present,
        "fallbacks": "server-side default",
        "offline": {
            "active": offline,
            "reason": fallback_reason,
            "explanation": "Offline teacher-ът работи без ключ и без интернет: обясненията се генерират от "
            "правилата и изчисленията на платформата (детерминистично). Ако Claude е недостъпен или върне "
            "грешка, заявката се обслужва от offline teacher-а — приложението продължава да работи.",
        },
        "status_note": status["note"],
        "output_sections": [ai_modes.TITLES[k] for k in ai_modes.STANDARD],
        "modes": [{"key": m["key"], "label": m["label"]} for m in ai_modes.modes_list()],
        "safety_rules": SAFETY_RULES,
        "standard_disclaimer": STANDARD_DISCLAIMER,
        "setup_disclaimer": SETUP_DISCLAIMER,
        "language": {
            "code": "bg",
            "note": "AI отговаря на български с английски trading термини (stop loss, take profit, breakout…).",
        },
        "explain_mode_default": bool(settings_service.user_settings(user).get("explain_mode", True)),
        "keys_policy": KEYS_POLICY,
        "how_to_enable": "AI_PROVIDER=anthropic и ANTHROPIC_API_KEY=<ключ> в backend/.env (по желание "
        "ANTHROPIC_MODEL, AI_EFFORT=low|medium|high), после рестарт на backend-а. Ключът остава само на сървъра.",
    }


@router.get("/ai")
def get_ai_settings(user: User = Depends(current_user)):
    return ai_settings(user)
