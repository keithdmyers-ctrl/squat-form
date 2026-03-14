"""Simple in-memory sliding-window rate limiter (no external dependencies)."""

from __future__ import annotations

import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse

# Maximum number of unique IPs tracked before LRU eviction kicks in.
_MAX_TRACKED_IPS = 10_000


class RateLimiter:
    """Per-IP sliding-window rate limiter.

    Args:
        max_requests: Maximum number of requests allowed in the window.
        window_seconds: Length of the sliding window in seconds.
    """

    def __init__(self, max_requests: int = 10, window_seconds: int = 60) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._last_cleanup = time.monotonic()
        self._cleanup_interval = 300  # purge stale IPs every 5 minutes

    def _cleanup(self, now: float) -> None:
        """Remove entries for IPs that have no recent hits.

        If the number of tracked IPs still exceeds ``_MAX_TRACKED_IPS``
        after removing stale entries, the least-recently-used IPs are
        evicted until the limit is met.
        """
        cutoff = now - self.window_seconds
        stale_keys = [
            ip for ip, ts_deque in self._hits.items()
            if not ts_deque or ts_deque[-1] < cutoff
        ]
        for key in stale_keys:
            del self._hits[key]

        # LRU eviction: if still too many IPs, drop those with oldest last hit
        if len(self._hits) > _MAX_TRACKED_IPS:
            sorted_ips = sorted(
                self._hits,
                key=lambda ip: self._hits[ip][-1] if self._hits[ip] else 0.0,
            )
            excess = len(self._hits) - _MAX_TRACKED_IPS
            for ip in sorted_ips[:excess]:
                del self._hits[ip]

        self._last_cleanup = now

    def is_allowed(self, ip: str) -> bool:
        """Check whether *ip* may proceed; records the hit if allowed."""
        now = time.monotonic()

        # Periodic cleanup of stale entries
        if now - self._last_cleanup > self._cleanup_interval:
            self._cleanup(now)

        cutoff = now - self.window_seconds

        if ip not in self._hits:
            self._hits[ip] = deque(maxlen=self.max_requests)

        timestamps = self._hits[ip]

        # Drop expired timestamps (they're sorted, so pop from left — O(1))
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()

        if len(timestamps) >= self.max_requests:
            return False

        timestamps.append(now)
        return True


# Singleton used by the analyze endpoint
_analyze_limiter = RateLimiter(max_requests=10, window_seconds=60)


async def check_rate_limit(request: Request) -> JSONResponse | None:
    """Return a 429 JSONResponse if the caller is over the limit, else None."""
    client_ip = request.client.host if request.client else "unknown"
    if not _analyze_limiter.is_allowed(client_ip):
        return JSONResponse(
            status_code=429,
            content={
                "success": False,
                "error": (
                    "Rate limit exceeded. You can submit up to 10 analyses per minute. "
                    "Please wait a moment and try again."
                ),
            },
        )
    return None
