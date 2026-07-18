"""Data models and bug-report body parsing.

Bug reports are plain-text R2 objects written by the worker's
handleBugReport:

    date: <ISO>
    email: <email or "(none)">

    --- DESCRIPTION ---
    <description>

    --- DIAGNOSTICS ---
    <diagnostics or "(none)">
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

BUG_STATUSES = ["new", "ack", "in-progress", "fixed", "wontfix", "spam"]
ACTIONABLE_BUG_STATUSES = {"new", "ack", "in-progress"}
SUBSCRIBER_STATUSES = ["new", "contacted", "beta", "unsubscribed"]

_DESCRIPTION_MARKER = "--- DESCRIPTION ---"
_DIAGNOSTICS_MARKER = "--- DIAGNOSTICS ---"


@dataclass
class BugBody:
    date: str = ""
    email: str = ""
    description: str = ""
    diagnostics: str = ""
    platform: str = ""

    @property
    def first_line(self) -> str:
        return (
            self.description.strip().splitlines()[0] if self.description.strip() else ""
        )


def parse_bug_body(text: str) -> BugBody:
    """Split a raw bug-report body into its sections."""
    body = BugBody()
    head, _, rest = text.partition(_DESCRIPTION_MARKER)
    description, _, diagnostics = rest.partition(_DIAGNOSTICS_MARKER)
    body.description = description.strip()
    body.diagnostics = diagnostics.strip()
    for line in head.splitlines():
        key, _, value = line.partition(":")
        value = value.strip()
        if key == "date":
            body.date = value
        elif key == "email" and value != "(none)":
            body.email = value
    match = re.search(r"^platform:\s*(\S+)", body.diagnostics, re.MULTILINE)
    if match:
        body.platform = match.group(1)
    return body


@dataclass
class Bug:
    """One row from GET /api/admin/bugs, plus the lazily fetched body."""

    key: str
    size: int
    uploaded: str
    status: str
    status_updated_at: str | None = None
    body: BugBody | None = None

    @property
    def basename(self) -> str:
        return self.key.rsplit("/", 1)[-1]

    @property
    def actionable(self) -> bool:
        return self.status in ACTIONABLE_BUG_STATUSES


@dataclass
class Subscriber:
    email: str
    subscribed_at: str
    source: str = ""
    platforms: list[str] = field(default_factory=list)
    note: str = ""
    status: str = "new"
    status_updated_at: str | None = None

    @classmethod
    def from_record(cls, record: dict) -> Subscriber:
        return cls(
            email=record.get("email", ""),
            subscribed_at=record.get("subscribedAt", ""),
            source=record.get("source", ""),
            platforms=record.get("platforms", []),
            note=record.get("note", ""),
            status=record.get("status", "new"),
            status_updated_at=record.get("statusUpdatedAt"),
        )
