# HQ — Chief-of-Staff Operating System

> A personal command center for running many projects with an AI chief of staff,
> designed so the AI is _always available_ but **almost never wastefully burning tokens**.
> Status: **vision spec / living design doc**. v0 built (2026-06-13); this remains the design north-star. Last verified: 2026-06-20.

---

## 0. Why this exists

Christopher runs a growing set of AI-built projects (ppp2: art-platform, notes-world,
flashkarte, baukasten, eng-crm, …) plus non-code work (art marketing, documents).
Today the **human is the router**: he has to remember where everything lives, what state
each project is in, what the next move is, and dig through nested folders to find things.
That doesn't scale — and it's the single biggest bottleneck.

In ~6 months the realistic picture is: all current projects still live, **6–10 commercial
websites running, and a couple of paying consulting clients.** The router-in-the-head model
breaks long before that. HQ is the fix: a system that holds the map, the state, and the
fuel gauge so the human can operate _above_ the work instead of inside it.

### The accessibility stake

Christopher is ~80% physically limited. Every eliminated manual step is a disproportionate
win. HQ's success metric is **bottlenecks removed**, not features shipped. Friction is the enemy.

---

## 1. The core principle

**"Always on" ≠ "always burning."**

The expensive intelligence (the LLM chief of staff) is a _scarce, metered resource_ — treat
it like a senior consultant, not data-entry staff. The **system** runs continuously; the
**LLM participates periodically and in bounded bursts.**

Cheap, dumb, deterministic infrastructure does all the always-on work. The LLM is woken on a
schedule or on demand, reads _pre-digested_ data (never raw sources), makes judgment calls,
dispatches work, and goes back to sleep.

> Anti-pattern we are explicitly rejecting: the "500M tokens/day, computer hissing at max
> capacity" model. That only works for people for whom compute is free and infinite.
> Christopher operates under a **5-hour rolling token quota** with real-world consequences
> when it runs dry (see §4). Efficiency is a first-class requirement, not an afterthought.

---

## 2. Architecture — three layers

```
┌─ Layer 3: CHIEF OF STAFF (LLM) ──────────── tokens, metered, governed ─┐
│  Woken on schedule/on-demand. Reads digested data only. Judges,        │
│  prioritizes, decides what needs the human, dispatches subagents.      │
└────────────────────────────────────────────────────────────────────────┘
            ▲ reads digested data            ▼ dispatches bounded jobs
┌─ Layer 2: DASHBOARD (web) ───────────────── ~free to view ────────────┐
│  Renders Layer 1 data. Human + (later) clients look here.              │
│  Tabs: Index · Project KPIs · Work Board · Token Gauge · Docs          │
└────────────────────────────────────────────────────────────────────────┘
            ▲ reads data store
┌─ Layer 1: COLLECTORS (plain code) ───────── ~free, always on ─────────┐
│  Cron jobs / hooks / pollers / file-walkers. Write to one data store.  │
│  Project index, CI status, deploy status, KPIs, token ledger.          │
│  ZERO tokens. This is the part that "runs all the time."               │
└────────────────────────────────────────────────────────────────────────┘
```

**The efficiency invariant:** the only layer that costs tokens is the only layer that needs
intelligence — and it's the one with a meter on it. Everything always-on is dumb and free.

---

## 3. The organs

HQ is one system with several faces. They share one data store and one dashboard shell.

| Organ              | Role                                     | Layer                       | Token cost                             |
| ------------------ | ---------------------------------------- | --------------------------- | -------------------------------------- |
| **Project Index**  | The map — what exists, where, what state | 1 (crawl) + 3 (enrich once) | crawl free; enrichment one-time/cached |
| **Dashboard**      | The cockpit — live KPIs, work board      | 2                           | free to view                           |
| **Token Governor** | The fuel gauge + safety policy           | 1 (ledger) + 3 (policy)     | ~free                                  |
| **Docs Site**      | The manuals — rendered from files        | 1 (SSG)                     | free                                   |
| **Chief of Staff** | Reads all of it, decides, dispatches     | 3                           | metered, governed                      |

### 3.1 Project Index (findability)

**Index, do not reorganize.** The pain is _findability_, not _layout_. Moving live project
folders breaks scripts, git repos, deploy pipelines, and VPS syncs — off the table for active
projects. Reorg only ever happens with an explicit per-move human yes.

- **Cheap crawl (no tokens):** walk ppp2, Documents, marketing, etc. Record for each item:
  path, type, **status (active / inactive / archived)**, last-modified, key docs present.
  Hard-filtered: skip `node_modules`, build artifacts, `.git` internals, caches.
- **Status is first-class.** `a-inactive/` and `archived/` are _signal_, not noise — they
  answer "what am I actually working on right now."
- **Intelligent enrichment (tokens, once):** the LLM writes the one-line "what this is"
  description and categorizes ambiguous items — only for new/changed items, then cached.
- **Query:** "where's the social-media setup doc?" → keyword search over the index (zero
  tokens) → returns path/link. LLM is the fallback only for fuzzy/semantic asks.
- **Double payoff:** the chief of staff needs this map to supervise multiple projects at all.
  Building it for the human's findability simultaneously builds the AI's supervision capability.
- **Index points to files; it never replaces them.** Files remain the source of truth.

### 3.2 Dashboard (cockpit)

- Renders Layer-1 data. Free to load.
- Internal tabs: Index/search, per-project KPIs, work board, **token fuel gauge**, rendered docs.
- Built **multi-project from day one** via a **project registry** (§5) — not leguilde-shaped.

### 3.3 Token Governor — see §4 (the spine).

### 3.4 Docs Site (manuals)

- **Files stay the source of truth; render them to a site.** Markdown in repos → SSG →
  browsable, searchable, cross-linked site (nice for humans, especially on mobile/Telegram).
- Do **not** make a website/CMS the source of truth: agents are fastest on files (cheap reads,
  git history, diffs, no deploy dependency), and vendor "doc-as-app" features are lock-in.
- art-platform already has Thymeleaf SSG + themes + a `docs/` folder — reuse that machinery.
- **Truly dynamic content** (deploy status, flags, work board, token gauge) belongs on a _live
  page_, not a static `.md`. That live page IS the dashboard. Docs-site and dashboard are the
  same surface wearing two hats.

### 3.5 Chief of Staff (the LLM)

- Holds the task board across projects (in files/store, not just in-context — survives compaction).
- Woken periodically or on demand; reads digested Layer-1 data.
- Relays the human tight status: what finished, what's blocked, what needs a decision.
- Interrupts the human only for genuine forks. Routes everything else.
- Dispatches subagents for bounded work; **never runs implementer subagents in parallel on the
  same repo without worktree isolation.** Returns conclusions, not transcripts (context economy).

---

## 4. Token Governor (the spine — build first)

The safety layer the "fire-and-forget" influencers don't need but Christopher does.

### Two distinct budgets — don't conflate

1. **Context window** — the LLM's working memory for one conversation. Fills, gets compacted.
   Running out = forgetfulness, not a hard stop.
2. **5-hour rolling quota** — the actual allowance. **This is the one with real-world
   consequences.** When it hit zero on 2026-06-13, every background agent died with zero output.

The governor is pegged to **#2**.

### The real-world stake (why the reserve exists)

Precedent: Christopher was caught in a police operation at Augsburg Hauptbahnhof that wrecked
his afternoon; the AI got him out of it (live reports, alternatives, re-planning). **If the
quota had been burned on background building, that help would not have been available.** The
governor guarantees capacity is held back for exactly those moments.

### Policy

- **Ledger:** every subagent reports its cost on completion (`subagent_tokens`). Append to a
  running ledger file — per-project, per-agent, cumulative. (Workflow runs also expose
  `budget.spent()` / `budget.remaining()` natively.)
- **Soft ceiling (e.g. ~70%):** background building stays under this by default.
- **Halt threshold (85%):** stop all supervised projects, **persist their state to disk**, and
  surface: _"Chris — at 85%. I've paused all N projects [state saved]. How urgent is the
  current work, and do you want reserve held back?"_
- **Emergency reserve floor:** a chunk the system refuses to spend on building — kept for
  live/urgent human needs. Enforced as policy (the governor obeys it), since there's no
  ground-truth quota meter exposed (see limitation).
- **Honest limitation:** the 5-hour quota is **not queryable** — we only learn the wall by
  hitting it. The governor runs on _our own running tally + estimation_, not a true meter.
  Good enough to be useful, not exact. Bias conservative.

---

## 5. Multi-project & the consulting path

### Project registry

Every project emits KPIs in a **common format**; one dashboard shell renders any project.
A new project (or client) is a new **registry entry**, not a rebuild. This near-free decision
now is what makes the consulting pivot real later.

### Consulting expansion (later, not now)

- **Christopher is client zero.** Run his own shop on HQ for months first — that _is_ the best
  sales demo ("here's how I run everything").
- A client watching their project's KPIs update in real time is a strong differentiator (most
  agencies send a monthly PDF).
- **Do NOT build the multi-tenant SaaS speculatively** (violates the no-over-engineering rule).
  Per-client auth, isolation, sanitized public views (no token internals, no cross-client
  leakage), and billing are bolted on **when there's a paying client** — informed by what we
  learn living in it ourselves.

---

## 6. Security / boundaries (non-negotiable)

- **Internal data is not public.** Architecture docs, specs, work board, and especially the
  token/KPI dashboard must be **auth-protected** — leguilde.art is the _public_ gallery domain.
  Use a protected path or separate subdomain (Apache front proxy + auth pattern already exists
  on the VPS; see the VPS-migration / eng-crm auth work).
- **No secrets in prompts/chat.** `.env` files only.
- **Least privilege for agents.** Read before write; no send/publish/delete/spend without an
  understood workflow and explicit consent.
- **Receipts.** Important outputs must show proof — files, logs, tests, renders, command output.
- **No silent reorg / deletion.** Index freely; move/delete only with a per-item human yes.

---

## 7. Build sequence (cheapest provable spine first)

1. **Token ledger + governor policy** (Layer 1 ledger + gauge + 85%/reserve rules). The spine.
   Nearly free. Everything else hangs off it.
2. **Project Index crawler** over ppp2 (status-aware, hard-filtered). Solves findability _and_
   gives the chief of staff its map. One-time LLM enrichment, cached.
3. **One real KPI feed** from one project (e.g. art-platform CI status + open bug-report issues),
   collected by cron, zero tokens.
4. **Bare dashboard page** rendering ledger + index + that KPI feed. Protected URL.
5. Then iterate: more projects (registry rows), the morning heads-up brief, docs-site rendering,
   and only much later, client-facing views.

> Prove the whole hybrid loop end-to-end with almost no token spend, then scale by adding rows.

---

## 8. Environment / migration notes

- **Home base:** `~/ppp2/` (this folder holds the AI projects). HQ lives at `~/ppp2/hq/`.
- **Laptop migration (2026-06-13):** the repaired laptop returns today; `ppp2` will be
  transferred there and the laptop will become the **main computer** (≈7 years newer than the
  desktop). Keep HQ **path-portable** — assume `~/ppp2/...`, avoid machine-specific absolute
  paths in collectors and configs. Re-verify cron jobs, the data-store location, and any
  hardcoded paths after the move.
- **Quota is per-account, not per-machine** — the governor's tally survives the hardware move.
- Deployment/hosting for the dashboard: TBD (VPS behind Apache+auth is the likely home, so it's
  reachable from phone/Telegram without keeping a machine on).

---

## 9. Open questions (to resolve before/while building)

- Data store for Layer 1: flat JSON files vs SQLite vs reuse Bot Forum bus vs Open Brain? (Lean
  flat-file first for portability + git-trackability.)
- Cadence: how often do collectors refresh (15 min? 30?) and how often is the chief of staff
  woken vs purely on-demand?
- Where does the dashboard run, and how is it auth-gated (subdomain vs protected path)?
- How much does Open Brain (existing knowledge graph) serve as the semantic index backend vs a
  separate index?
- Exact soft-ceiling / halt / reserve percentages once we can observe real burn rates.

---

## 10. Non-goals (what HQ is deliberately NOT)

- Not a token-maximizing "look how much I burn" flex. The opposite — efficiency is the point.
- Not a website-as-source-of-truth. Files stay canonical.
- Not a speculative multi-tenant SaaS built before the first client.
- Not an auto-reorganizer of the filesystem. Index, propose, human approves moves.
- Not an always-running LLM. The LLM is bounded and metered; the _infrastructure_ is what's always on.
