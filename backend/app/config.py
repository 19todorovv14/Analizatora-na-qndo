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
    market_data_crypto: str = "demo"
    market_data_fx: str = "demo"
    market_data_stocks: str = "demo"  # stocks, indices, commodities
    binance_base_url: str = "https://data-api.binance.vision"
    twelvedata_api_key: str | None = None
    twelvedata_base_url: str = "https://api.twelvedata.com"
    market_http_timeout: float = 10.0

    # --- News (optional) ----------------------------------------------------
    finnhub_api_key: str | None = None

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

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
