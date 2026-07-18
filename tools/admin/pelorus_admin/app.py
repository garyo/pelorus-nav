"""Pelorus Nav admin TUI: browse and triage bug reports and signups.

Email-client layout: a table of one-line summaries above a detail pane for
the highlighted row. See README.md for keybindings and setup.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import os
import sys
from pathlib import Path

from rich.text import Text
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical, VerticalScroll
from textual.theme import BUILTIN_THEMES
from textual.widgets import DataTable, Footer, Static, TabbedContent, TabPane

from .api import AdminClient
from .models import Bug, Subscriber, parse_bug_body

# Colors chosen to stay readable on both light and dark backgrounds.
STATUS_STYLES = {
    "new": "bold #d75f00",
    "ack": "#0087af",
    "in-progress": "bold #0087af",
    "fixed": "#008700",
    "wontfix": "dim",
    "spam": "dim red",
    "contacted": "#0087af",
    "beta": "#008700",
    "unsubscribed": "dim",
}


def styled_status(status: str) -> Text:
    return Text(status, style=STATUS_STYLES.get(status, ""))


# textual-light on a pure white background instead of its default med-gray.
LIGHT_THEME = dataclasses.replace(
    BUILTIN_THEMES["textual-light"],
    name="pelorus-light",
    surface="#ffffff",
    panel="#f0f0f0",
    background="#ffffff",
)


def terminal_prefers_dark() -> bool:
    """Best-effort terminal background detection via COLORFGBG
    ("fg;bg", bg 0-6 or 8 = dark). Textual can't query the terminal
    directly, so default to light when unknown."""
    colorfgbg = os.environ.get("COLORFGBG", "")
    _, _, bg = colorfgbg.rpartition(";")
    return bg.isdigit() and (int(bg) < 7 or int(bg) == 8)


class ListDetailPane(Vertical):
    """Shared shape: DataTable over a scrollable detail view."""

    def compose(self) -> ComposeResult:
        table = DataTable(cursor_type="row")
        table.zebra_stripes = True
        yield table
        with VerticalScroll(id="detail"):
            yield Static(id="detail-text")

    @property
    def table(self) -> DataTable:
        return self.query_one(DataTable)

    @property
    def detail_scroll(self) -> VerticalScroll:
        return self.query_one("#detail", VerticalScroll)

    def show_detail(self, text: Text | str) -> None:
        self.query_one("#detail-text", Static).update(text)
        self.detail_scroll.scroll_home(animate=False)

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.row_key is not None and event.row_key.value is not None:
            self.highlight_row(event.row_key.value)

    def highlight_row(self, row_key: str) -> None:
        raise NotImplementedError


class BugsPane(ListDetailPane):
    BINDINGS = [
        Binding("a", "toggle_actionable", "actionable only"),
        Binding("d", "download", "download"),
        Binding("k", "set_status('ack')", "ack"),
        Binding("i", "set_status('in-progress')", "in-prog"),
        Binding("f", "set_status('fixed')", "fixed"),
        Binding("w", "set_status('wontfix')", "wontfix"),
        Binding("x", "set_status('spam')", "spam"),
        Binding("u", "set_status('new')", "new"),
    ]

    bugs: list[Bug]
    actionable_only = True

    def on_mount(self) -> None:
        self.bugs = []
        self.table.add_column("status", key="status", width=11)
        self.table.add_column("date", key="date", width=16)
        self.table.add_column("platform", key="platform", width=8)
        self.table.add_column("email", key="email", width=26)
        self.table.add_column("summary", key="summary")

    @property
    def client(self) -> AdminClient:
        return self.app.client  # type: ignore[attr-defined]

    def current_bug(self) -> Bug | None:
        table = self.table
        if not table.row_count:
            return None
        row_key = table.coordinate_to_cell_key(table.cursor_coordinate).row_key
        return next((b for b in self.bugs if b.key == row_key.value), None)

    @work(exclusive=True, group="bugs-refresh")
    async def refresh_data(self) -> None:
        self.bugs = await self.client.list_bugs()
        self.bugs.sort(key=lambda b: b.uploaded, reverse=True)
        self.rebuild_table()
        await self.fetch_bodies()

    async def fetch_bodies(self) -> None:
        sem = asyncio.Semaphore(8)

        async def fill(bug: Bug) -> None:
            async with sem:
                bug.body = parse_bug_body(await self.client.get_bug_body(bug.key))
            self.refresh_bug_row(bug)

        await asyncio.gather(*(fill(b) for b in self.bugs if b.body is None))

    def visible_bugs(self) -> list[Bug]:
        if self.actionable_only:
            return [b for b in self.bugs if b.actionable]
        return self.bugs

    def rebuild_table(self) -> None:
        table = self.table
        table.clear()
        for bug in self.visible_bugs():
            table.add_row(*self.row_cells(bug), key=bug.key)
        if not table.row_count:
            self.show_detail("(no bug reports match the filter)")

    def row_cells(self, bug: Bug) -> list[Text | str]:
        body = bug.body
        return [
            styled_status(bug.status),
            bug.uploaded[:16].replace("T", " "),
            body.platform if body else "…",
            (body.email or "-") if body else "…",
            body.first_line[:160] if body else "…",
        ]

    def refresh_bug_row(self, bug: Bug) -> None:
        table = self.table
        if bug.key not in table.rows:
            return
        for column_key, cell in zip(
            ("status", "date", "platform", "email", "summary"), self.row_cells(bug)
        ):
            table.update_cell(bug.key, column_key, cell, update_width=True)
        current = self.current_bug()
        if current is bug:
            self.highlight_row(bug.key)

    def highlight_row(self, row_key: str) -> None:
        bug = next((b for b in self.bugs if b.key == row_key), None)
        if bug is None:
            return
        if bug.body is None:
            self.show_detail("(loading…)")
            return
        body = bug.body
        header = Text()
        header.append(f"{bug.key}\n", style="dim")
        header.append("date:     ").append(f"{body.date}\n")
        header.append("email:    ").append(f"{body.email or '(none)'}\n")
        header.append("platform: ").append(f"{body.platform or '?'}\n")
        header.append("status:   ").append_text(styled_status(bug.status))
        if bug.status_updated_at:
            header.append(f"  (set {bug.status_updated_at[:16].replace('T', ' ')})")
        header.append("\n\n")
        header.append(body.description, style="bold")
        header.append("\n\n--- DIAGNOSTICS ---\n", style="dim")
        header.append(body.diagnostics)
        self.show_detail(header)

    def action_toggle_actionable(self) -> None:
        self.actionable_only = not self.actionable_only
        self.rebuild_table()
        self.app.notify(
            "Showing actionable only" if self.actionable_only else "Showing all"
        )

    def action_download(self) -> None:
        bug = self.current_bug()
        if bug is None or bug.body is None:
            return
        downloads = Path.home() / "Downloads"
        path = (downloads if downloads.is_dir() else Path.home()) / bug.basename
        raw = (
            f"date: {bug.body.date}\nemail: {bug.body.email or '(none)'}\n\n"
            f"--- DESCRIPTION ---\n{bug.body.description}\n\n"
            f"--- DIAGNOSTICS ---\n{bug.body.diagnostics}\n"
        )
        path.write_text(raw)
        self.app.notify(f"Saved {path}")

    @work(group="bug-status")
    async def action_set_status(self, status: str) -> None:
        bug = self.current_bug()
        if bug is None or bug.status == status:
            return
        await self.client.set_bug_status(bug.key, status)
        bug.status = status
        self.refresh_bug_row(bug)
        self.app.notify(f"{bug.basename[:24]}… → {status}")


class SignupsPane(ListDetailPane):
    BINDINGS = [
        Binding("c", "set_status('contacted')", "contacted"),
        Binding("t", "set_status('beta')", "beta"),
        Binding("x", "set_status('unsubscribed')", "unsub"),
        Binding("u", "set_status('new')", "new"),
    ]

    subscribers: list[Subscriber]

    def on_mount(self) -> None:
        self.subscribers = []
        self.table.add_column("status", key="status", width=13)
        self.table.add_column("subscribed", key="subscribed", width=16)
        self.table.add_column("platforms", key="platforms", width=12)
        self.table.add_column("email", key="email")

    @property
    def client(self) -> AdminClient:
        return self.app.client  # type: ignore[attr-defined]

    def current_subscriber(self) -> Subscriber | None:
        table = self.table
        if not table.row_count:
            return None
        row_key = table.coordinate_to_cell_key(table.cursor_coordinate).row_key
        return next((s for s in self.subscribers if s.email == row_key.value), None)

    @work(exclusive=True, group="signups-refresh")
    async def refresh_data(self) -> None:
        self.subscribers = await self.client.list_subscribers()
        self.rebuild_table()

    def rebuild_table(self) -> None:
        table = self.table
        table.clear()
        for sub in self.subscribers:
            table.add_row(*self.row_cells(sub), key=sub.email)
        if not table.row_count:
            self.show_detail("(no signups)")

    def row_cells(self, sub: Subscriber) -> list[Text | str]:
        return [
            styled_status(sub.status),
            sub.subscribed_at[:16].replace("T", " "),
            ",".join(sub.platforms) or "-",
            sub.email,
        ]

    def refresh_subscriber_row(self, sub: Subscriber) -> None:
        for column_key, cell in zip(
            ("status", "subscribed", "platforms", "email"), self.row_cells(sub)
        ):
            self.table.update_cell(sub.email, column_key, cell, update_width=True)
        if self.current_subscriber() is sub:
            self.highlight_row(sub.email)

    def highlight_row(self, row_key: str) -> None:
        sub = next((s for s in self.subscribers if s.email == row_key), None)
        if sub is None:
            return
        text = Text()
        text.append(f"{sub.email}\n", style="bold")
        text.append("subscribed: ").append(f"{sub.subscribed_at}\n")
        text.append("source:     ").append(f"{sub.source}\n")
        text.append("platforms:  ").append(f"{', '.join(sub.platforms) or '(none)'}\n")
        text.append("status:     ").append_text(styled_status(sub.status))
        if sub.status_updated_at:
            text.append(f"  (set {sub.status_updated_at[:16].replace('T', ' ')})")
        if sub.note:
            text.append("\n\nnote: ", style="dim").append(sub.note)
        self.show_detail(text)

    @work(group="subscriber-status")
    async def action_set_status(self, status: str) -> None:
        sub = self.current_subscriber()
        if sub is None or sub.status == status:
            return
        await self.client.set_subscriber_status(sub.email, status)
        sub.status = status
        self.refresh_subscriber_row(sub)
        self.app.notify(f"{sub.email} → {status}")


class AdminApp(App):
    TITLE = "Pelorus Nav Admin"

    CSS = """
    ListDetailPane DataTable { height: 45%; }
    ListDetailPane #detail {
        height: 1fr;
        border-top: solid $primary;
        padding: 0 1;
    }
    """

    BINDINGS = [
        Binding("ctrl+n,n,down", "cursor_down", "next", show=False),
        Binding("ctrl+p,p,up", "cursor_up", "prev", show=False),
        Binding("ctrl+v", "detail_scroll(1)", "scroll detail", show=False),
        Binding("alt+v", "detail_scroll(-1)", "scroll detail up", show=False),
        Binding("b", "show_tab('bugs')", "bugs"),
        Binding("s", "show_tab('signups')", "signups"),
        Binding("r", "refresh", "refresh"),
        Binding("ctrl+t", "toggle_dark", "light/dark", show=False),
        Binding("q,ctrl+c", "quit", "quit"),
    ]

    def __init__(self, base_url: str, token: str) -> None:
        super().__init__()
        self.client = AdminClient(base_url, token)
        self.base_url = base_url

    def compose(self) -> ComposeResult:
        with TabbedContent():
            with TabPane("Bugs", id="bugs"):
                yield BugsPane()
            with TabPane("Signups", id="signups"):
                yield SignupsPane()
        yield Footer()

    def on_mount(self) -> None:
        self.register_theme(LIGHT_THEME)
        self.theme = "textual-dark" if terminal_prefers_dark() else "pelorus-light"
        self.sub_title = self.base_url
        self.query_one(BugsPane).refresh_data()
        self.query_one(SignupsPane).refresh_data()
        self.query_one(BugsPane).table.focus()

    def on_tabbed_content_tab_activated(
        self, event: TabbedContent.TabActivated
    ) -> None:
        # Keep focus on the table so the pane's triage keybindings work
        # (focus otherwise lands on the tab-header bar).
        self.active_pane().table.focus()

    async def on_unmount(self) -> None:
        await self.client.close()

    def active_pane(self) -> ListDetailPane:
        active = self.query_one(TabbedContent).active
        pane_type = BugsPane if active == "bugs" else SignupsPane
        return self.query_one(pane_type)

    def action_cursor_down(self) -> None:
        self.active_pane().table.action_cursor_down()

    def action_cursor_up(self) -> None:
        self.active_pane().table.action_cursor_up()

    def action_detail_scroll(self, direction: int) -> None:
        scroll = self.active_pane().detail_scroll
        if direction > 0:
            scroll.scroll_page_down()
        else:
            scroll.scroll_page_up()

    def action_show_tab(self, tab: str) -> None:
        self.query_one(TabbedContent).active = tab
        self.active_pane().table.focus()

    def action_toggle_dark(self) -> None:
        self.theme = "pelorus-light" if self.theme == "textual-dark" else "textual-dark"

    def action_refresh(self) -> None:
        self.active_pane().refresh_data()
        self.notify("Refreshing…")


def find_token() -> str | None:
    """PELORUS_ADMIN_TOKEN env var, else ADMIN_TOKEN from the repo's
    .env or .dev.vars (both gitignored)."""
    token = os.environ.get("PELORUS_ADMIN_TOKEN")
    if token:
        return token
    repo_root = Path(__file__).parents[3]
    for name in (".env", ".dev.vars"):
        path = repo_root / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "ADMIN_TOKEN":
                return value.strip().strip("'\"") or None
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Pelorus Nav admin TUI")
    parser.add_argument(
        "--url",
        default=os.environ.get("PELORUS_ADMIN_URL", "https://pelorus-nav.com"),
        help="Worker base URL (default: %(default)s)",
    )
    args = parser.parse_args()
    token = find_token()
    if not token:
        sys.exit(
            "No admin token found.\n"
            "Set PELORUS_ADMIN_TOKEN, or put ADMIN_TOKEN=... in the repo's\n"
            ".env or .dev.vars."
        )
    AdminApp(args.url, token).run()


if __name__ == "__main__":
    main()
