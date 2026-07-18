"""HTTP client for the worker's admin API, with a disk cache for bug bodies.

Bug-report bodies are immutable, so each is fetched from R2 at most once and
kept forever in the platform cache dir.
"""

from __future__ import annotations

from pathlib import Path

import httpx
from platformdirs import user_cache_dir

from .models import Bug, Subscriber


class AdminClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        self._cache_dir = Path(user_cache_dir("pelorus-admin")) / "bugs"
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        await self._client.aclose()

    async def list_bugs(self) -> list[Bug]:
        resp = await self._client.get("/api/admin/bugs")
        resp.raise_for_status()
        return [
            Bug(
                key=b["key"],
                size=b["size"],
                uploaded=b["uploaded"],
                status=b["status"],
                status_updated_at=b.get("statusUpdatedAt"),
            )
            for b in resp.json()["bugs"]
        ]

    async def get_bug_body(self, key: str) -> str:
        cached = self._cache_dir / key.rsplit("/", 1)[-1]
        if cached.exists():
            return cached.read_text()
        resp = await self._client.get("/api/admin/bug", params={"key": key})
        resp.raise_for_status()
        cached.write_text(resp.text)
        return resp.text

    async def set_bug_status(self, key: str, status: str) -> None:
        resp = await self._client.put(
            "/api/admin/bug-status", json={"key": key, "status": status}
        )
        resp.raise_for_status()

    async def list_subscribers(self) -> list[Subscriber]:
        resp = await self._client.get("/api/subscribers")
        resp.raise_for_status()
        subs = [Subscriber.from_record(r) for r in resp.json()]
        subs.sort(key=lambda s: s.subscribed_at, reverse=True)
        return subs

    async def set_subscriber_status(self, email: str, status: str) -> None:
        resp = await self._client.put(
            "/api/admin/subscriber-status", json={"email": email, "status": status}
        )
        resp.raise_for_status()
