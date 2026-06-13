# HQ — Chief-of-Staff Operating System

A personal command center for running many projects with an AI chief of staff —
**always available, almost never wastefully burning tokens.**

Full vision: [docs/HQ-SPEC.md](docs/HQ-SPEC.md).

> Path-portable: all state lives under `~/ppp2/hq/`, so it travels on a USB stick
> and runs on any machine with Node. No dependencies.

## Build status

| Component              | Status                         |
| ---------------------- | ------------------------------ |
| Token Governor (spine) | ✅ v0 — built                  |
| Project Index          | ✅ v0 — built (+ descriptions) |
| KPI feeds              | ✅ v0 — built (git, opt. CI)   |
| Dashboard              | ✅ v0 — self-contained HTML    |
| Daily brief + refresh  | ✅ v0 — built                  |
| Docs site              | ⬜ next                        |
| Auth / VPS hosting     | ⬜                             |

## Everyday use

```bash
bin/refresh.sh                 # rebuild index+KPIs+descriptions, re-render dashboard (cron-safe)
bin/refresh.sh --ci            # also pull GitHub Actions status (network)
xdg-open dashboard.html        # open the cockpit (gauge + projects + search)
node bin/brief.js              # daily heads-up: uncommitted/unpushed/stale repos + fuel
node bin/index.js find <kw>    # "where is this?" (searches names, paths, descriptions)
node bin/governor.js status    # fuel gauge
```

## Daily automation (cron)

Refresh every 30 min and write a brief each morning (logs to `~/logs/`):

```cron
*/30 * * * *  /home/chris/ppp2/hq/bin/refresh.sh        >> ~/logs/hq-refresh.log 2>&1
30 7   * * *  node /home/chris/ppp2/hq/bin/brief.js      >> ~/logs/hq-brief.log 2>&1
```

Set up on whichever machine is primary. All commands are zero-token and deterministic.

## Project Index

Searchable map of your work folders + documents. **Index, never reorganize** — it only
reads and records; nothing is moved. Per-machine (run `build` on each computer).

```bash
node bin/index.js build                    # crawl roots → data/index.json (zero tokens)
node bin/index.js find art marketing       # "where is this?" search
node bin/index.js find --type doc taxes    # docs only
node bin/index.js find --type project crm  # top-level projects only
node bin/index.js stats                    # counts by root / status / type
```

Roots, skip-dirs, doc extensions, and archive/inactive folder names live in
`index-config.json`. Status (active / inactive / archived) is inferred from folder
names like `a-inactive/` and `archived/`.

## Token Governor

Tracks token spend in a rolling 5-hour window from an append-only ledger and reports
a fuel gauge against an _estimated_ quota.

**Honest limitation:** the real 5-hour quota is **not queryable** — we only learn the
wall by hitting it. This tool tracks what we log (accurate) and compares it to a
configured estimate (tunable). Bias conservative; keep a reserve.

### Commands

```bash
# log a cost (e.g. after a subagent reports its subagent_tokens)
node bin/governor.js add --project art-platform --label "i18n" --tokens 171759 --kind agent

# full status + fuel gauge + OK/CAUTION/HALT level
node bin/governor.js status

# one-line gauge (for the dashboard / quick checks)
node bin/governor.js gauge

# set the estimated quota once you observe a real wall (use the rolling-window
# spend at the moment everything died)
node bin/governor.js set-quota 2000000
```

### Config (`config.json`)

| Key                      | Meaning                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `window_hours`           | Rolling window (5).                                               |
| `estimated_quota_tokens` | Estimated 5h allowance. `null` until observed. Tune over time.    |
| `soft_ceiling_pct`       | Stay under this % for background building (70).                   |
| `halt_pct`               | At this %, halt projects, persist state, check in (85).           |
| `reserve_tokens`         | Floor never spent on building — held for live human needs (200k). |

### Data (`data/token-ledger.jsonl`)

Append-only, one JSON object per line: `{ ts, project, label, tokens, kind }`.
Git-trackable, portable, no database.

## Policy (the why)

The 5-hour quota is the real wall — when it hits zero, background agents die with no
output (happened 2026-06-13). The reserve exists so capacity is always held back for
live/urgent needs (e.g. real-time rerouting when plans blow up), never fully consumed
by background building.
