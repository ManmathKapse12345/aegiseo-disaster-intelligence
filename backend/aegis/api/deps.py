"""Authentication, authorisation and rate limiting."""

from __future__ import annotations

import hmac
import threading
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from aegis.config import get_settings

ROLE_RANK = {"viewer": 0, "analyst": 1, "admin": 2}


@dataclass(frozen=True)
class Identity:
    user: str
    role: str

    def has(self, role: str) -> bool:
        return ROLE_RANK.get(self.role, -1) >= ROLE_RANK[role]


def get_identity(request: Request) -> Identity:
    settings = get_settings()
    if not settings.auth_enabled:
        return Identity("local-analyst", "admin")
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    token = header[7:].strip()
    for known, (user, role) in settings.token_table.items():
        if hmac.compare_digest(known.encode(), token.encode()):  # constant-time comparison
            return Identity(user, role)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token", headers={"WWW-Authenticate": "Bearer"})


def require(role: str):
    def dep(identity: Identity = Depends(get_identity)) -> Identity:
        if not identity.has(role):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"role '{role}' required")
        return identity

    return dep


class RateLimiter:
    """Token bucket per client for mutating requests (in-process; adequate for a single API instance)."""

    def __init__(self, per_minute: int):
        self.capacity = max(1, per_minute)
        self.rate = self.capacity / 60.0
        self.buckets: dict[str, tuple[float, float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, float]:
        now = time.monotonic()
        with self.lock:
            tokens, last = self.buckets.get(key, (float(self.capacity), now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens >= 1:
                self.buckets[key] = (tokens - 1, now)
                return True, 0.0
            self.buckets[key] = (tokens, now)
            return False, (1 - tokens) / self.rate
