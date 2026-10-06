"""Application configuration.

All secrets (API keys, database credentials) are read from environment variables
or a local `.env` file. Nothing secret is ever stored in the database or sent to
the frontend.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Trading Academy"
    app_env: str = "development"  # development | production | test

    # --- Database -----------------------------------------------------------
    # Production: postgresql+psycopg://user:pass@host:5432/db
    database_url: str = "sqlite:///./trading_academy.db"
    auto_create_tables: bool = True  # dev convenience; production uses Alembic
    seed_demo_data: bool = True

    # --- Background jobs ----------------------------------------------------
    redis_url: str | None = None
    use_celery: bool = False  # when False, jobs run inline / in FastAPI background tasks

    # --- Security -----------------------------------------------------------
    secret_key: str = "dev-insecure-secret-change-me"
    cookie_secure: bool = False
    session_days: int = 30
    # comma separated in the environment: CORS_ORIGINS=https://a.example,https://b.example
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    auth_rate_limit_per_minute: int = 20

    # --- Market data (read-only) -------------------------------------------
    # demo        -> deterministic synthetic data, clearly labelled as DEMO
    # binance     -> Binance public market-data endpoints (no API key, read-only)
    # twelvedata  -> Twelve Data REST API (requires TWELVEDATA_API_KEY)
    # Each value is a comma-separated CHAIN, e.g. "binance,twelvedata": the first provider in the
    # chain that SUPPORTS an instrument serves it (chosen statically by support, never because of an
    # outage — provider errors are raised, never silently replaced by demo data).
    market_data_crypto: str = "demo"
    market_data_fx: str = "demo"
    market_data_stocks: str = "demo"  # stocks (+ ETFs, indices, commodities unless set below)
    market_data_etf: str | None = None  # None -> market_data_stocks
    market_data_indices: str | None = None  # None -> market_data_stocks
    market_data_commodities: str | None = None  # None -> market_data_stocks
    binance_base_url: str = "https://data-api.binance.vision"
    twelvedata_api_key: str | None = None
    twelvedata_base_url: str = "https://api.twelvedata.com"
    # Twelve Data's basic plans deliver delayed quotes for many exchanges; set true on a real-time plan.
    twelvedata_realtime: bool = False
    market_http_timeout: float = 10.0

    # --- Instrument catalog discovery (app.market.discovery, read-only reference lists) ---------
    # true: Celery beat syncs the provider instrument lists daily (needs USE_CELERY + beat)
    catalog_auto_sync: bool = False
    # Binance spot pairs are synced only for these quote assets (comma separated)
    catalog_binance_quotes: str = "USDT,USDC,FDUSD,BTC,ETH,EUR"
    # Twelve Data stocks / ETFs are synced only for these countries (comma separated, Twelve Data names)
    catalog_twelvedata_countries: str = "United States"

    # --- Markets explorer (quote snapshots, heatmap) -------------------------
    # true: a background thread precomputes the quote snapshots of the curated demo/Binance instruments at
    # startup and keeps them fresh, so market lists never compute a cold universe inside a request
    market_warmup: bool = True
    # market capitalisation for the crypto heatmap: none | coingecko (public read-only API; never invented)
    market_cap_provider: str = "none"
    coingecko_base_url: str = "https://api.coingecko.com/api/v3"
    coingecko_api_key: str | None = None  # optional CoinGecko demo key (sent as the x-cg-demo-api-key header)

    # --- News (optional) ----------------------------------------------------
    finnhub_api_key: str | None = None
    finnhub_base_url: str = "https://finnhub.io/api/v1"

    # --- AI -----------------------------------------------------------------
    # offline   -> deterministic rule-based teacher, works without any key
    # anthropic -> Claude via the official Anthropic SDK (ANTHROPIC_API_KEY)
    ai_provider: str = "offline"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    ai_effort: str = "low"  # low | medium | high
    ai_max_tokens: int = 4000
    ai_timeout_seconds: float = 60.0

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):  # allow comma separated env var
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("catalog_binance_quotes", "catalog_twelvedata_countries", mode="before")
    @classmethod
    def _blank_catalog_lists(cls, v, info):  # docker-compose passes unset variables as ""
        if v is None or (isinstance(v, str) and not v.strip()):
            return cls.model_fields[info.field_name].default
        return v

    @property
    def catalog_quotes(self) -> list[str]:
        """CATALOG_BINANCE_QUOTES as a de-duplicated, upper-case list (order kept)."""
        return _csv(self.catalog_binance_quotes, upper=True)

    @property
    def catalog_countries(self) -> list[str]:
        """CATALOG_TWELVEDATA_COUNTRIES as a de-duplicated list (order kept)."""
        return _csv(self.catalog_twelvedata_countries)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def _csv(value: str, *, upper: bool = False) -> list[str]:
    out: list[str] = []
    for part in (value or "").split(","):
        item = part.strip().upper() if upper else part.strip()
        if item and item not in out:
            out.append(item)
    return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
