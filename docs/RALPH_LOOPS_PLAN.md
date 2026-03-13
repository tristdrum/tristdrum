# Ralph Loops build plan

This document is the canonical implementation plan for the private `Ralph Loops` section on tristdrum.com.

## Product intent

Create an owner-only dashboard section where Trist can see all Ralph projects, their current state, recent execution context, and sync health in one place.

This should feel like an operations cockpit, not a rough debug screen.

## Non-negotiable constraints

1. Local Ralph config/runtime/task sources remain the source of truth.
   - `~/.openclaw/workspace/config/ralph_projects.json`
   - Ralph runtime SQLite/log state
   - repo task files for repo-mode projects
   - Linear state for linear-mode projects
2. Supabase is a site-facing read model / projection, not the canonical source.
3. Keep the data model DRY.
   - no redundant shadow fields unless they are deliberate indexed summary columns
4. Every JSON contract must be documented and runtime-validated.
5. The first UI release is read-only.
   - no pause/resume/mutate controls in v1
6. Protect private data behind site admin auth only.
7. Production deploys happen from GitHub-connected pushes only.
   - never deploy this project via the Vercel CLI unless Trist explicitly says otherwise

## Architecture decision

Build Ralph Loops as a validated snapshot pipeline:

- local Ralph sources -> exporter -> validated snapshot JSON -> Supabase projection -> private dashboard UI

This keeps one source of truth while still giving the site a fast, queryable data source.

## Data model direction

Start simple. Do not over-normalize on day one.

### Table: `ralph_projects_current`

Purpose: one current row per Ralph project for dashboard reads.

Suggested columns:
- `project_id` text primary key
- `name` text not null
- `mode` text not null check (`mode in ('linear','repo')`)
- `enabled` boolean not null
- `health_status` text not null
- `run_status` text not null
- `usage_multiplier_pct` integer not null
- `account_pool` jsonb not null default '[]'::jsonb
- `current_item_label` text null
- `current_item_title` text null
- `last_run_started_at` timestamptz null
- `last_run_ended_at` timestamptz null
- `last_run_note` text null
- `backlog_counts` jsonb not null default '{}'::jsonb
- `source_summary` jsonb not null default '{}'::jsonb
- `snapshot_json` jsonb not null
- `snapshot_hash` text not null
- `synced_at` timestamptz not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Rules:
- `snapshot_json` is the canonical site payload
- the small scalar/json summary columns exist only to support practical filters/sorts/cards
- `snapshot_hash` avoids unnecessary writes/history churn

### Table: `ralph_project_snapshots_history`

Purpose: append-only snapshot history when a project meaningfully changes.

Suggested columns:
- `id` bigserial primary key
- `project_id` text not null references `ralph_projects_current(project_id)` on delete cascade
- `snapshot_json` jsonb not null
- `snapshot_hash` text not null
- `captured_at` timestamptz not null default now()

Rules:
- only insert when hash changes
- index `project_id, captured_at desc`

### Table: `ralph_sync_runs`

Purpose: exporter observability.

Suggested columns:
- `id` bigserial primary key
- `started_at` timestamptz not null default now()
- `finished_at` timestamptz null
- `status` text not null check (`status in ('running','success','error')`)
- `projects_seen` integer not null default 0
- `projects_changed` integer not null default 0
- `error_summary` text null
- `details_json` jsonb not null default '{}'::jsonb

## Snapshot contract

Define a runtime-validated JSON schema for a single project snapshot.

Suggested top-level shape:

```json
{
  "version": 1,
  "project": {
    "id": "tristdrum-site",
    "name": "Tristan Drummond Personal Site",
    "mode": "repo",
    "enabled": true,
    "branch": "main",
    "worktree": "/Users/tristdrum/GitHub/tristdrum",
    "usageMultiplierPct": 500,
    "accounts": ["personal"]
  },
  "source": {
    "kind": "repo",
    "repoTasksFile": "/path/.ralph/tasks.json",
    "repoPlanFile": "/path/docs/RALPH_LOOPS_PLAN.md"
  },
  "runtime": {
    "activeRun": null,
    "lastRun": null,
    "dispatchGate": null,
    "usageGate": null
  },
  "status": {
    "health": "healthy",
    "run": "idle",
    "reason": "No active run"
  },
  "backlog": {
    "counts": {
      "todo": 3,
      "in_progress": 1,
      "done": 7,
      "blocked": 0
    },
    "nextItems": []
  },
  "links": {
    "repo": "https://github.com/tristdrum/tristdrum",
    "linear": null
  },
  "meta": {
    "generatedAt": "2026-03-13T11:00:00Z",
    "sourceHash": "..."
  }
}
```

Contract rules:
- keep fields explicit and stable
- if a value cannot be derived, emit `null` deliberately rather than inventing placeholders
- validate before every remote write
- fail the sync run loudly if the payload is invalid

## Exporter plan

Build a small programmatic exporter that:

1. Reads Ralph source-of-truth data from local files/runtime state
2. Builds one validated snapshot per project
3. Computes a stable snapshot hash per project
4. Upserts `ralph_projects_current`
5. Appends to `ralph_project_snapshots_history` only when a hash changed
6. Records a row in `ralph_sync_runs`
7. Writes structured logs + keeps its own small SQLite/runtime state if needed

Implementation guidance:
- prefer TypeScript or Python, whichever matches the existing site/runtime ergonomics best
- keep one source-of-truth transformation path
- no duplicate mapping code for current vs history writes
- batch writes where practical
- leave room for future per-project detail pages without redesigning the snapshot contract

## Automation plan

Initial cadence: every 5 minutes.

The automation should:
- run the exporter
- skip redundant history writes when snapshot hashes did not change
- still record enough heartbeat/sync metadata to prove the loop is alive
- keep per-run logs
- make failures visible through `ralph_sync_runs`

Operational expectation:
- if a sync fails, the last successful data should remain visible in the site
- the dashboard should show `last synced` and stale/error indicators

## Security plan

1. Site UI access
   - only authenticated site admins can view Ralph Loops data
2. Database access
   - RLS select for site admins only
   - exporter writes should use service-role/server-side path only
   - browser should not write directly to sync tables in v1
3. Secrets
   - keep exporter secrets local / server-side only
   - never expose service-role credentials to the client

## UI plan

### v1: summary page

Route: `/dashboard/ralph-loops`

Sections:
- global summary bar
  - running
  - blocked
  - idle
  - paused
  - last sync
- project cards
  - name
  - mode
  - enabled/paused
  - health/run status pills
  - usage multiplier
  - current item / next item
  - last run note
  - quick links
- sync health panel
  - last successful sync
  - latest failure summary if any

### v2: project detail page

Route: `/dashboard/ralph-loops/:projectId`

Sections:
- project overview
- current source/runtime snapshot
- recent run history
- backlog summary
- recent snapshot history
- raw snapshot inspector for debugging

### v3: optional controls

Possible later additions, not part of v1:
- pause/resume project
- trigger sync now
- trigger Ralph cycle
- adjust usage multiplier

## Suggested implementation order

1. Add/update the plan + repo tasks so Ralph has clear direction
2. Define the snapshot JSON schema in the repo/workspace
3. Add Supabase migration for Ralph Loops tables + RLS
4. Implement exporter with validation + hash-aware upserts
5. Add 5-minute automation for the exporter
6. Build `/dashboard/ralph-loops` summary UI
7. Add detail page + sync health panels
8. Add tests and docs polish

## Acceptance criteria for the first meaningful release

A release counts as successful when:
- owner can sign in and open `/dashboard/ralph-loops`
- all Ralph projects appear in one dashboard view
- repo-mode and linear-mode projects both render correctly
- last sync time is visible
- stale/error sync states are visible
- exporter writes are schema-validated
- snapshot history is append-only and hash-aware
- all private data is protected by auth/RLS
- lint, tests, and build pass

## Ralph execution guidance

When Ralph executes this plan, favor these task boundaries:
- one focused infrastructure/data-contract task at a time
- then one focused exporter task at a time
- then one focused UI slice at a time
- keep each task small enough that it can finish in a single clean coding pass
- prefer additive, production-minded changes over speculative abstraction

## Out of scope for now

- real-time websockets/live streaming status
- public-facing Ralph data
- cross-project mutation controls from the browser
- replacing Ralph’s existing local runtime/state machinery with Supabase
