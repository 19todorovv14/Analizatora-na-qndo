"""LLM abstraction layer.

* `offline` (default) — no LLM. The teacher, reviewer and coach produce deterministic,
  rule-based explanations. Works with zero configuration.
* `anthropic` — Claude through the official Anthropic Python SDK. Set
  AI_PROVIDER=anthropic and ANTHROPIC_API_KEY in backend/.env.

The LLM is only ever asked to EXPLAIN data that the quantitative engine already computed;
its output always passes through the safety filter.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from functools import lru_cache

from app.config import get_settings

log = logging.getLogger(__name__)


class LLMError(RuntimeError):
    pass


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def complete(self, system: str, messages: list[dict], max_tokens: int | None = None) -> str:
        """`messages` = [{"role": "user"|"assistant", "content": str}, ...]."""


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, effort: str, max_tokens: int, timeout: float):
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=2)
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens

    def complete(self, system: str, messages: list[dict], max_tokens: int | None = None) -> str:
        a = self._anthropic
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                system=system,
                messages=messages,
                output_config={"effort": self.effort},
                # If a safety classifier declines, the API re-runs the request on Anthropic's
                # recommended fallback model instead of returning a refusal.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except a.AuthenticationError as exc:
            raise LLMError("ANTHROPIC_API_KEY е невалиден.") from exc
        except a.PermissionDeniedError as exc:
            raise LLMError("API ключът няма достъп до избрания модел.") from exc
        except a.NotFoundError as exc:
            raise LLMError(f"Моделът '{self.model}' не е намерен.") from exc
        except a.RateLimitError as exc:
            raise LLMError("AI доставчикът ограничи заявките (rate limit). Опитай след малко.") from exc
        except a.APIStatusError as exc:
            raise LLMError(f"AI доставчикът върна грешка {exc.status_code}.") from exc
        except a.APIConnectionError as exc:
            raise LLMError("Няма връзка с AI доставчика.") from exc
        if resp.stop_reason == "refusal":
            raise LLMError("AI моделът отказа заявката.")
        text = "".join(block.text for block in resp.content if block.type == "text").strip()
        if not text:
            raise LLMError("Празен отговор от AI модела.")
        return text


@lru_cache
def get_llm() -> LLMProvider | None:
    """Configured LLM, or None for the offline teacher."""
    s = get_settings()
    if s.ai_provider == "anthropic":
        if not s.anthropic_api_key:
            log.warning("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — using the offline teacher.")
            return None
        return AnthropicProvider(
            s.anthropic_api_key, s.anthropic_model, s.ai_effort, s.ai_max_tokens, s.ai_timeout_seconds
        )
    return None


def provider_status() -> dict:
    s = get_settings()
    llm = get_llm()
    return {
        "configured": s.ai_provider,
        "active": llm.name if llm else "offline",
        "model": s.anthropic_model if llm else None,
        "note": "Offline teacher: детерминистични обяснения без външен AI."
        if llm is None
        else "Claude обяснява изчисления от engine-а анализ; числата идват само от данните.",
    }
