# Refactor the E2B sandbox driver into deep modules under 1000 lines

Save this file as `plans/refactor-e2b-sandbox.md`.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is authored in accordance with the ExecPlan skill at `.agents/skills/execplan/SKILL.md` and applies the architecture rubric at `.agents/skills/improve-codebase-architecture/SKILL.md` (deep modules: a lot of behaviour behind a small interface; the deletion test before any extraction; the interface is the test surface).

## Purpose / Big Picture

`packages/core/src/server/sandbox/e2b.ts` is the driver that talks to the E2B cloud-sandbox SDK on behalf of a conversation. It currently sits at 1270 lines, over the hard 1000-line ceiling. The file mixes four different concerns plus a slab of dead code, which makes it hard for a maintainer (or an AI agent) to find where one concern lives. After this change the same public behaviour is delivered by several smaller files, each a deep module with a small interface, and every file is comfortably under 1000 lines.

Nothing a caller can observe changes. Every symbol that other files import from `@bap/core/server/sandbox/e2b` keeps the same name, signature, and runtime behaviour. The proof is: the package typechecks clean (it did before, it does after), the broader package keeps compiling, and `oxlint` reports zero `eslint(max-lines)` diagnostics on the target file and every new file.

## Progress

- [x] (2026-06-18) Read target file, both skill files, mapped every external importer of each export.
- [x] (2026-06-18) Confirmed dead code: `cleanupAllSandboxes`, `writeSkillsToSandbox`, `getSkillsSystemPrompt`, `writeResolvedIntegrationSkillsToSandbox`, `getIntegrationSkillsSystemPrompt` are neither exported from e2b.ts nor referenced inside it; live equivalents live in `prep/skills-prep.ts`. Baseline `tsc` of packages/core is clean.
- [x] (2026-06-18) Authored this ExecPlan.
- [x] (2026-06-18) Milestone 1 — delete dead code; verify tsc + lint.
- [x] (2026-06-18) Milestone 2 — extract the E2B runtime plumbing module (`e2b/runtime.ts`).
- [x] (2026-06-18) Milestone 3 — extract sandbox provisioning (`e2b/provisioning.ts`).
- [x] (2026-06-18) Milestone 4 — extract session lifecycle (`e2b/session.ts`).
- [x] (2026-06-18) Milestone 5 — extract admin + backend adapter (`e2b/admin.ts`, `e2b/backend.ts`); reduce `e2b.ts` to a thin re-export barrel.
- [x] (2026-06-18) Final verification: tsc, lint (zero max-lines), line counts.

## Surprises & Discoveries

- Observation: nearly 190 lines of e2b.ts is dead. The skills helpers (`writeSkillsToSandbox`, `getSkillsSystemPrompt`, `writeResolvedIntegrationSkillsToSandbox`, `getIntegrationSkillsSystemPrompt`) and `cleanupAllSandboxes` carry no `export` and have no in-file callers. Their live successors are in `packages/core/src/server/sandbox/prep/skills-prep.ts`, which every real importer (`pre-prompt-assets.ts`, `opencode-normal-runner.ts`) uses.
  Evidence: `grep -n "export" e2b.ts` shows these five functions lack `export`; grepping the whole repo for them finds only the prep/skills-prep and opencode-session copies.
- Observation: `getOrCreateSandbox` and `getSandboxStateDurable` share a non-trivial "connect, build serverUrl, health-check, hydrate client, else mark-dead" routine, and `getOrCreateBareSandbox`/`getOrCreateSandbox` share an identical create-VM block. This shared shape is the deep seam to concentrate.
  Evidence: lines 289-488 contain three copies of the connect+health pattern and two copies of the Sandbox.create block.

## Decision Log

- Decision: Delete the dead skills/cleanup functions rather than re-home them.
  Rationale: The deletion test says deleting them makes complexity vanish with zero callers — they are pass-throughs to nothing. Re-homing would move dead weight. The live behaviour already exists in `prep/skills-prep.ts`.
  Date/Author: 2026-06-18 / refactor agent.

- Decision: Split into an `e2b/` directory of focused modules and turn `e2b.ts` into a thin re-export barrel that preserves the existing import path `@bap/core/server/sandbox/e2b`.
  Rationale: Importers reference the `e2b` specifier by path; keeping a barrel preserves every public import with no edits at call sites. The four live concerns (runtime plumbing, provisioning, session, admin+backend) are cohesive and each is a deep module: a lot of E2B-SDK / DB-runtime behaviour behind a handful of functions.
  Date/Author: 2026-06-18 / refactor agent.

- Decision: Concentrate the duplicated "connect + health-check + hydrate-or-mark-dead" logic into a single deep helper (`connectHealthyRuntime`) inside `e2b/provisioning.ts`, used by both `getOrCreateSandbox` and `getSandboxStateDurable`.
  Rationale: This passes the deletion test — deleting it would re-spread the same connect/health/markDead sequence across two call sites. It hides real behaviour (port resolution, https URL, fetch health probe, client creation, dead-runtime bookkeeping) behind one call. That is depth, not a shallow move.
  Date/Author: 2026-06-18 / refactor agent.

## Outcomes & Retrospective

Completed. `e2b.ts` went from 1270 lines to an 18-line re-export barrel. Five focused modules were created under `e2b/`: `runtime.ts` (144), `provisioning.ts` (275), `session.ts` (432), `admin.ts` (114), `backend.ts` (82). The largest is `e2b/session.ts` at 432 lines. ~190 lines of dead code were deleted. The duplicated connect+health-check routine was concentrated into one `connectHealthyRuntime` helper used by both `getOrCreateSandbox` and `getSandboxStateDurable`, and the duplicated VM-create block into `createSandboxVm`. `tsc` for packages/core stays clean; `oxlint` reports zero `eslint(max-lines)` diagnostics across the barrel and all five new files. No public symbol changed name or signature, so no call site outside the `e2b/` directory needed editing.

## Context and Orientation

The repository is a TypeScript monorepo. The package under work is `packages/core`. The target file is `packages/core/src/server/sandbox/e2b.ts`. It is the E2B adapter behind the `SandboxBackend` interface declared in `packages/core/src/server/sandbox/types.ts`.

A "sandbox" here is a remote micro-VM from the `e2b` SDK (`import { Sandbox } from "e2b"`) running an OpenCode server. A "conversation" is a user chat; its runtime row in the `conversationRuntime` table records which `sandboxId` and OpenCode `sessionId` currently serve it. "OpenCode" is the agent server running inside the sandbox; the SDK client type is `OpencodeClient` from `@opencode-ai/sdk`.

The live public surface of e2b.ts — every symbol imported by code outside the file — is exactly:

- `getOrCreateBareSandbox(config, onLifecycle?, telemetry?)` — used by `sandbox/opencode-session.ts`.
- `getOrCreateSession(config, options?)` — used by `sandbox/opencode-session.ts`.
- `getSandboxStateDurable(conversationId)` — used by `apps/web/src/server/internal/memory.ts` and internally by the backend adapter.
- `injectProviderAuth(client, userId, options?)` — used by `sandbox/opencode-session.ts`.
- `killSandbox(conversationId, reason?)` — used by `sandbox/services/paused-sandbox-cleanup.ts` and the backend adapter.
- `isE2BConfigured()` — used by `apps/web/src/server/instance/health.ts`, `apps/web/src/server/orpc/routers/admin-sandbox.ts`, `services/sandbox-usage-snapshot.ts`.
- `listAllE2BSandboxes()` — used by `admin-sandbox.ts`, `services/sandbox-usage-snapshot.ts`.
- `killE2BSandboxById(sandboxId)` — used by `admin-sandbox.ts`.
- `E2BSandboxBackend` (class) — used by `sandbox/factory.ts`.
- `SandboxConfig` (type) — exported; no external importer found, but keep exporting it because `getOrCreateBareSandbox`/`getOrCreateSession` accept it and re-export is cheap.

These five symbols are dead (not exported, not referenced inside e2b.ts) and must be deleted: `cleanupAllSandboxes`, `writeSkillsToSandbox`, `getSkillsSystemPrompt`, `writeResolvedIntegrationSkillsToSandbox`, `getIntegrationSkillsSystemPrompt`.

## Plan of Work

The decomposition keeps the existing path `e2b.ts` as a barrel and introduces a sibling `e2b/` directory. Each new module is a deep module: small interface, substantial behaviour.

`e2b/runtime.ts` — the low-level E2B/runtime-state plumbing every other module needs. Exports: `TEMPLATE_NAME`, `SANDBOX_TIMEOUT_MS`, `resolveSandboxAppUrl()`, `SandboxConfig` (interface), `SessionInitStage` (type), `SessionInitLifecycleCallback` (type), `SandboxState` (interface), `getConversationRuntimeState()`, `connectSandboxById()`, `applySandboxTimeout()`, `logLifecycle()`, `formatErrorMessage()`. This is the shared vocabulary the provisioning and session modules speak. Deletion test: deleting it would re-spread DB runtime-state queries and SDK connect/timeout wrangling across three call sites — it earns its keep.

`e2b/provisioning.ts` — turning a config into a running sandbox + OpenCode client. Exports: `getOrCreateBareSandbox()`, `getOrCreateSandbox()` (internal export, used by session module), `getSandboxStateDurable()`. Internally concentrates two duplications into private helpers: `createSandboxVm(config, telemetryContext, onLifecycle)` (the Sandbox.create + env + timeout + SANDBOX_ID echo block) and `connectHealthyRuntime(sandboxId, model)` (connect → build serverUrl → health-probe → hydrate client, returning the `SandboxState` or null). These helpers are the real depth: a lot of SDK/HTTP behaviour behind one call.

`e2b/session.ts` — turning a sandbox into a ready OpenCode session for a conversation. Exports: `getOrCreateSession()`, `injectProviderAuth()`. Private: `replayConversationHistory()`. Depends on `provisioning.ts` for `getOrCreateSandbox` and on `runtime.ts` for logging/state.

`e2b/admin.ts` — fleet operations independent of a single conversation. Exports: `killSandbox()`, `listAllE2BSandboxes()`, `killE2BSandboxById()`, `isE2BConfigured()`. Private: `killConnectedSandbox()`.

`e2b/backend.ts` — the `SandboxBackend` adapter. Exports: `E2BSandboxBackend`. Depends on `provisioning.ts` (`getSandboxStateDurable`), `admin.ts` (`killSandbox`, `isE2BConfigured`).

`e2b.ts` — becomes a re-export barrel: `export { ... } from "./e2b/..."` for every live public symbol, preserving the import path.

## Concrete Steps

All commands run from the worktree root `/Users/baptiste/Git/cmdclaw/.claude/worktrees/refactor-e2b-sandbox` unless a `cd` is shown.

Milestone 1 (dead code): delete the five dead functions from `e2b.ts`. Then:

    cd packages/core && bunx tsc --noEmit -p tsconfig.json

Expect no output (clean). Then from the worktree root:

    bunx oxlint --config .oxlintrc.json --format json packages/core/src/server/sandbox/e2b.ts

Expect no `eslint(max-lines)` entry (the file is now ~1080, may still be over 1000 until later milestones — that is expected mid-refactor; the hard gate is only checked at the end).

Milestones 2–5 create the `e2b/` modules and shrink `e2b.ts` to a barrel. After each, re-run the same `tsc` command and expect clean.

Final verification from the worktree root, linting the barrel and every new file:

    bunx oxlint --config .oxlintrc.json --format json packages/core/src/server/sandbox/e2b.ts packages/core/src/server/sandbox/e2b/runtime.ts packages/core/src/server/sandbox/e2b/provisioning.ts packages/core/src/server/sandbox/e2b/session.ts packages/core/src/server/sandbox/e2b/admin.ts packages/core/src/server/sandbox/e2b/backend.ts

Expect zero `eslint(max-lines)` diagnostics. And line counts:

    wc -l packages/core/src/server/sandbox/e2b.ts packages/core/src/server/sandbox/e2b/*.ts

Expect every count < 1000.

## Validation and Acceptance

Acceptance is behavioural-by-proxy because this is an internal refactor with no runnable end-to-end harness in the worktree: (1) `packages/core` typechecks with zero errors both before and after — proving every caller still resolves the same symbols with the same types; (2) `oxlint` reports zero `eslint(max-lines)` diagnostics on the target file and all new files — proving the hard gate; (3) no file outside the new `e2b/` directory is edited — proving the public interface is unchanged. There is no e2b unit test in the tree (`find packages/core/src/server/sandbox -name "*e2b*test*"` is empty), so the typecheck across all importers is the test surface.

## Idempotence and Recovery

Each milestone is committed separately, so a failed step can be reset with `git reset --hard HEAD`. Re-running `tsc`/`oxlint` is side-effect free. The barrel preserves the import path, so partial completion never breaks importers as long as every milestone leaves `e2b.ts` exporting the full live set (achieved by moving code then immediately re-exporting it).

## Interfaces and Dependencies

After completion, in `packages/core/src/server/sandbox/`:

`e2b/runtime.ts` exports:

    export const TEMPLATE_NAME: string
    export const SANDBOX_TIMEOUT_MS: number
    export function resolveSandboxAppUrl(): string
    export interface SandboxConfig { conversationId: string; generationId?: string; userId?: string; model: string; anthropicApiKey: string; integrationEnvs?: Record<string, string>; openAIAuthSource?: "user" | "shared" | null }
    export interface SandboxState { sandbox: Sandbox; client: OpencodeClient; serverUrl: string; reused: boolean }
    export type SessionInitStage = ... (unchanged union)
    export type SessionInitLifecycleCallback = (stage: SessionInitStage, details?: Record<string, unknown>) => void
    export function getConversationRuntimeState(conversationId: string): Promise<{ runtimeId: string; sandboxId: string | null; sessionId: string | null; model: string } | null>
    export function connectSandboxById(sandboxId: string): Promise<Sandbox | null>
    export function applySandboxTimeout(sandbox: Sandbox): Promise<void>
    export function logLifecycle(event: string, details: Record<string, unknown>, context?: ObservabilityContext): void
    export function formatErrorMessage(error: unknown): string

`e2b/provisioning.ts` exports `getOrCreateBareSandbox`, `getOrCreateSandbox`, `getSandboxStateDurable` with their existing signatures. `e2b/session.ts` exports `getOrCreateSession`, `injectProviderAuth`. `e2b/admin.ts` exports `killSandbox`, `listAllE2BSandboxes`, `killE2BSandboxById`, `isE2BConfigured`. `e2b/backend.ts` exports `E2BSandboxBackend`. `e2b.ts` re-exports all live symbols (including `SandboxConfig`) from these modules.
