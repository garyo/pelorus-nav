# pelorus-admin

TUI for browsing and triaging Pelorus Nav bug reports (R2 `bug-reports/`) and
newsletter signups (SUBSCRIBERS KV), via the worker's `/api/admin/*` endpoints.

## Setup

```sh
cd tools/admin
uv sync
```

Requires the worker's `ADMIN_TOKEN` secret. The token is looked up as:
`PELORUS_ADMIN_TOKEN` env var, else `ADMIN_TOKEN=` in the repo's `.env` or
`.dev.vars` (both gitignored). With the token in one of those files, just:

```sh
bun run admin        # from the repo root
```

Options: `--url <base>` (default `https://pelorus-nav.com`, or set
`PELORUS_ADMIN_URL`). Against a local worker:

```sh
bunx wrangler dev    # the local worker accepts ADMIN_TOKEN from .dev.vars
bun run admin -- --url http://localhost:8787
```

Bug-report bodies are immutable, so they're cached forever under the platform
cache dir (`~/Library/Caches/pelorus-admin/bugs/` on macOS); only new reports
are fetched on refresh.

## Keys

| Key | Action |
| --- | --- |
| `n`/`p`, `C-n`/`C-p`, arrows | move cursor |
| `C-v` / `M-v` | scroll detail pane |
| `b` / `s` | Bugs / Signups tab |
| `r` | refresh from server |
| `q` / `C-c` | quit |

Bugs tab: `a` toggle actionable-only filter (default on; hides
fixed/wontfix/spam), `d` download the report to `./<name>.txt`, and statuses
`k` ack · `i` in-progress · `f` fixed · `w` wontfix · `x` spam · `u` new.

Signups tab: `c` contacted · `t` beta · `x` unsubscribed · `u` new.

## API smoke tests

```sh
curl -H "Authorization: Bearer $PELORUS_ADMIN_TOKEN" https://pelorus-nav.com/api/admin/bugs
curl -H "Authorization: Bearer $PELORUS_ADMIN_TOKEN" \
  "https://pelorus-nav.com/api/admin/bug?key=bug-reports/<name>.txt"
```
