"""Password hashing and session tokens (stdlib only)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from app.config import get_settings

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calc, _unb64(digest))


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """Only this keyed hash is stored, so a database leak does not leak live sessions."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < 8:
        problems.append("Паролата трябва да е поне 8 символа.")
    if password.lower() == password or password.upper() == password:
        problems.append("Използвай малки и главни букви.")
    if not any(ch.isdigit() for ch in password):
        problems.append("Добави поне една цифра.")
    return problems
