"""Reject JSON request bodies that contain non-finite numbers (NaN, Infinity, -Infinity, 1e999).

Python's json module (used by FastAPI/Starlette to parse request bodies) accepts the non-standard constants NaN /
Infinity and turns overflowing literals such as 1e999 into inf, and pydantic float fields allow them by default.
Such a value passed `gt=0` checks, was stored (paper orders, journal entries…) and afterwards every response that
contained it failed to serialise → permanent 500s (e.g. GET /api/paper/account after an order with
"stop_loss": Infinity). No endpoint has a legitimate use for a non-finite number, so they are refused up front with
a 422 for every JSON body. Pure ASGI (the body is buffered once and replayed to the app unchanged).
"""

from __future__ import annotations

import json
import math
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
DETAIL = "Невалидно число в заявката: NaN / Infinity не са позволени."


class NonFiniteNumber(ValueError):
    pass


def _reject_constant(name: str):
    raise NonFiniteNumber(name)


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise NonFiniteNumber(text)
    return value


def has_non_finite(body: bytes) -> bool:
    """True when `body` is JSON containing a non-finite number (invalid JSON is left to the app to report)."""
    try:
        json.loads(body, parse_constant=_reject_constant, parse_float=_finite_float)
    except NonFiniteNumber:
        return True
    except ValueError:  # not JSON / not UTF-8 → FastAPI answers it as before
        return False
    return False


class RejectNonFiniteJSONMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        content_type = headers.get(b"content-type", b"").split(b";")[0].strip().lower()
        if not (content_type == b"application/json" or content_type.endswith(b"+json")):
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        disconnect: Message | None = None
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                disconnect = message
                break
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)

        if disconnect is None and has_non_finite(body):
            payload = json.dumps({"detail": DETAIL, "code": "NON_FINITE_NUMBER"}, ensure_ascii=False).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 422,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(payload)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": payload})
            return

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                if disconnect is not None:
                    return disconnect
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


# ---------------------------------------------------------------------------------------------- responses
def _finite_only(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite_only(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_finite_only(v) for v in value]
    return value


class SafeJSONResponse(JSONResponse):
    """The app's default response class: a non-finite float anywhere in a payload (an extreme ratio such as a margin
    level of 1e306 × 100, or a value stored before the request guard existed) is sent as null instead of failing
    the whole response with "Out of range float values are not JSON compliant" → 500. Normal payloads take the
    unchanged fast path."""

    def render(self, content: Any) -> bytes:
        try:
            return super().render(content)
        except ValueError:
            return super().render(_finite_only(content))
