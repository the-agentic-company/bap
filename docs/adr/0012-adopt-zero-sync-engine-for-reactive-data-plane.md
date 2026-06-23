---
status: proposed
---

# Adopt Rocicorp Zero as the reactive data plane for web

We are adopting [Rocicorp Zero](https://zero.rocicorp.dev) to make the web app's
core surfaces (conversation list, conversation messages, coworkers) feel instant —
Linear-style local reactive reads and optimistic writes against a synced client
replica. Zero becomes the **data plane** for a small, explicitly-chosen slice of
tables; oRPC remains the **control plane** for everything imperative, secret-bearing,
or long-running. The two never call each other — they meet only in Postgres (Zero
observes oRPC's writes via logical replication) and in shared `packages/core` domain
logic (Zero's server-side mutators delegate to the same services oRPC handlers use).

This is scoped to `apps/web`. Native `apple/` apps stay on oRPC (Zero has no Swift
client). The cutover for the synced surfaces is a Big Bang switch from React Query
polling to Zero reads — no long-lived dual read path.

## Scope (what Zero owns)

- **Synced tables:** `conversation`, `message`, `messageAttachment`, `coworker`,
  `coworkerRun`, `coworkerFolder`, and `workspaceMember` (replicated for permission
  checks only, hidden from clients by a read rule). Coworker folders are the synced coworker
  organization model; folder reads remain on Zero and must encode private vs.
  workspace-visible access in their named query. The previous coworker tag tables
  are intentionally no longer synced because tags were removed from the coworker
  organization model.
- **Explicitly NOT synced:** `generation` (holds `pendingAuth`/`debugInfo`/`sandboxId`;
  Zero has no column-level permissions, so the whole row would leak). List-level chat
  run state comes from `conversation.generationStatus` + `currentGenerationId`.
  Coworker run list rows sync only list-safe columns from `coworkerRun`, excluding
  trigger payloads, debug info, raw errors, and runtime details. Live generation detail
  stays on the existing **SSE + Redis** stream.
- **Stays on oRPC:** starting generations, integrations/OAuth, provider tokens,
  billing, sandbox control — anything with secrets, heavy side effects, or
  non-idempotent external calls.
- **Writes:** lightweight edits to the synced slice (rename/archive/reorder, create
  /edit coworker, toggles) go through Zero custom mutators (optimistic on the client,
  server half validates via `packages/core`). Imperative ops stay on oRPC.

## Key decisions

- **Postgres stays on Render** (managed, Frankfurt). Render now supports logical
  replication as a publisher (Pro plan + ≥10 GB storage; off by default). `zero-cache`
  runs as a new Render private service with a persistent disk, connecting over the
  direct (non-pooled) internal connection string.
- **Auth:** mint a short-lived JWT via Better Auth's JWT plugin carrying `userId`
  (+ global role) only. Workspace membership is resolved **live** by joining the
  replicated `workspaceMember` table inside read permissions — so removing a member
  cuts access immediately (no token-staleness window).
- **IDs:** no migration needed — target tables already use app-generated
  `text` UUIDs (`crypto.randomUUID()`), with no Postgres-default IDs.
- **Working set:** eager-sync a recent window (~90 days / a few hundred conversations,
  capped) for an all-local feel; older history loads on-demand.
- **Schema:** keep Zero's `schema.ts` as an explicit audited client-facing schema
  for the synced slice.

## Considered options

- **Keep everything on oRPC + build bespoke realtime/optimistic UI** — rejected: more
  hand-rolled cache/websocket machinery to reach a Linear feel, and still no synced
  client replica.
- **Move Postgres to Neon / RDS / Cloud SQL** for guaranteed logical replication —
  rejected once Render was confirmed to support it; avoids a cross-cloud DB migration.
- **Self-managed Postgres on Render** — rejected: takes on backup/HA/upgrade ops we
  don't carry today, for no benefit over Render's managed logical replication.
- **Route live token streaming through Zero** — rejected: high-frequency JSONB
  updates on the replication stream cause write amplification and zero-cache pressure;
  the existing SSE path is already token-granular.

## Consequences

- We must operate a new stateful service (`zero-cache`): persistent high-IOPS disk,
  monitored via the existing VictoriaMetrics/Grafana stack.
- Enabling logical replication requires the Render Postgres to be on Pro plan with
  ≥10 GB storage (current prod is `basic-1gb` — needs an upgrade).
- No column-level permissions in Zero means every synced table is audited so no
  sensitive column ever reaches a client; sensitive data stays out of synced tables.
- Local dev's Postgres container must run with `wal_level=logical`.

## Open verification spikes (before committing)

1. Confirm a CDC consumer (`zero-cache`) can hold a **logical replication slot** on
   Render's managed Postgres publisher from within the private network.
2. Confirm the Better Auth → Zero **JWT** mint/verify/refresh loop.
3. Column audit of every synced table (esp. `conversation`, `coworker`) for anything
   that should not reach the row's own user.
