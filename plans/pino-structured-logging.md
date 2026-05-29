# Replace service logging with Pino stdout JSON

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows the repository skill at `.agents/skills/execplan/SKILL.md`.

## Purpose / Big Picture

CmdClaw service logs currently pass through patched `console.*` calls and a custom HTTP export to Vector. That path loses native `Error` fields, so Render can show a useful error while VictoriaLogs receives `{}`. After this change, service-side Operational Logs, Canonical Service Events, and accepted Client Observations all emit structured JSON lines to stdout or stderr through a Pino-backed logger. Render and Vector ingest process output, while metrics and traces continue through OpenTelemetry exporters. A human can see this working by running the focused observability tests and by inspecting emitted log records: native `Error` instances include bounded message and stack details, Operational Logs use `event.kind="operational_log"` plus a dotted snake case `event`, and Canonical Service Events keep their canonical envelope.

## Progress

- [x] (2026-05-29T15:21:56Z) Created the goal and read the implementation PRD, ADR 0008, observability docs, and current observability utility.
- [x] (2026-05-29T15:21:56Z) Wrote this ExecPlan under `plans/`.
- [x] (2026-05-29T15:32:54Z) Built the Pino-backed logger facade and tests for Error Diagnostic serialization, redaction, context, Operational Log shape, and stdout transport.
- [x] (2026-05-29T15:32:54Z) Refactored the observability runtime to remove console interception and app-side log fetches while preserving metrics/traces and semantic APIs.
- [x] (2026-05-29T15:32:54Z) Replaced service `logServerEvent` call sites with explicit Operational Log calls through the shared logger.
- [x] (2026-05-29T15:32:54Z) Ran focused tests, core type checking, web checking, and final searches; all required validation passed.

## Surprises & Discoveries

- Observation: The current working tree already contains documentation changes for Operational Logs and ADR 0008, plus an existing Pino dependency in `packages/core/package.json` and `bun.lock`.
  Evidence: `rg -n '"pino"|pino@' packages/core/package.json bun.lock` finds `pino` in both files.
- Observation: `logServerEvent` is widely used in generation/runtime/sandbox service code, so removing it requires mechanical but careful call-site migration.
  Evidence: `rg -n "logServerEvent\\(" packages/core apps/web` lists generation maintenance, queue, streams, manager, turn intake, runtime, sandbox, SLO, and web generation router call sites.
- Observation: The web check caught only three mechanical `no-useless-spread` lint findings after the call-site migration.
  Evidence: The first `bun run check:web` failed on spread-only issues in `apps/web/src/server/orpc/routers/generation.ts`; after removing those unnecessary spreads, rerunning the same command passed with `Found 0 warnings and 0 errors.`

## Decision Log

- Decision: Treat the PRD and ADR 0008 as binding for this implementation: stdout JSON is the only log transport, semantic APIs remain distinct, and service runtimes must not intercept `console.*`.
  Rationale: This is the final form agreed with the user and prevents preserving the current band-aid.
  Date/Author: 2026-05-29 / Codex
- Decision: Convert existing generic `logServerEvent` usages to Operational Logs by default.
  Rationale: The PRD says former generic logs should only become Canonical Service Events when an authoritative operation contract already exists in docs or tests.
  Date/Author: 2026-05-29 / Codex
- Decision: Keep tests that previously asserted `logServerEvent` behavior by mocking the new logger and translating records back into the old assertion shape.
  Rationale: This preserves the behavioral intent of the service tests while production code stops importing or calling the retired API.
  Date/Author: 2026-05-29 / Codex

## Outcomes & Retrospective

Implemented the PRD acceptance criteria for the service logging path. Operational Logs now flow through a Pino-backed logger facade, semantic observability records write through the same stdout JSON sink, service console interception and app-side Vector log export were removed, and production `logServerEvent` usage was eliminated. Focused validation passed. Remaining unrelated worktree files such as `afk.md` were not touched.

## Context and Orientation

The current PRD is `docs/prd/pino-structured-logging.md`. It defines the desired final form for service logging. An Operational Log is a structured process-level diagnostic record that helps debug service runtime behavior but is not the authoritative fact for a service-owned operation. A Canonical Service Event is the authoritative context-rich record for an operation such as an RPC request, worker job, or terminal Generation lifecycle step. A Client Observation is browser-originated evidence accepted through an allowlisted server endpoint. An Error Diagnostic is a redacted summary of a failure with safe fields such as name, message, stack, normalized code, category, provider, and upstream status.

The main implementation file today is `packages/core/src/server/utils/observability.ts`. It initializes OpenTelemetry metrics and traces, patches console output, forwards logs to Vector with `fetch`, builds telemetry envelopes, and exposes `logServerEvent`, `emitCanonicalServiceEvent`, `emitClientObservation`, metrics helpers, and trace helpers. The current console patching and `forwardLogPayload` path must be removed. The semantic APIs for Canonical Service Events, Client Observations, metrics, and spans must remain.

The focused existing test file is `packages/core/src/server/utils/observability.test.ts`. It already tests Vector URL resolution, telemetry attribute normalization, trace id format, and the temporary Error serialization helpers. This test suite should be rewritten or extended around the new logger facade and refactored observability behavior.

Service call sites import and call `logServerEvent` in many files under `packages/core/src/server/services`, `packages/core/src/server/runtime`, `packages/core/src/server/sandbox`, `packages/core/src/server/execution`, and `apps/web/src/server/orpc/routers/generation.ts`. These calls should become explicit Operational Log calls through the new logger. Existing `emitCanonicalServiceEvent` and `emitClientObservation` call sites should remain semantic.

## Plan of Work

First, create a logger facade in core server utilities. The facade will use Pino, but call sites will import the CmdClaw logger type and helpers rather than Pino directly. It will normalize field names, drop forbidden fields, bound strings, arrays, and stacks, serialize errors into Error Diagnostics, attach runtime fields and active trace/span identifiers, and emit Operational Logs with `event.kind="operational_log"` and dotted snake case `event` names. It will support child loggers with bound context and a test sink so behavior can be asserted without noisy test output.

Second, refactor `packages/core/src/server/utils/observability.ts` so `initializeObservabilityRuntime` initializes service identity and OpenTelemetry metrics/traces only. Remove `patchConsole`, `buildConsolePayload`, `forwardLogPayload`, pending log exports, and the Vector `/logs` URL from runtime state. Preserve Vector URL resolution for metrics and traces. Make `emitCanonicalServiceEvent` and `emitClientObservation` write their normalized payloads through the logger transport while retaining span enrichment. Remove `logServerEvent` from the public API.

Third, migrate service `logServerEvent` call sites. Each call becomes `logger.info`, `logger.warn`, or `logger.error` with a dotted snake case `event` and a useful human `msg`. Details and context should be merged into the logger record, with product pivots supplied explicitly. Do not promote generic log calls to Canonical Service Events during this pass unless the file already uses an explicit canonical API for that contract.

Fourth, update tests. Add focused logger tests for `Error` serialization, nested error serialization, redaction, field normalization, Operational Log shape, child context, and absence of `cmdclaw.event.name` on Operational Logs. Update observability tests to prove Canonical Service Events and Client Observations keep their semantic envelopes and no app-side log `fetch` remains. Run focused tests, `bun run --cwd packages/core check`, and relevant web checks if the web router migration affects type checking.

## Concrete Steps

Work from `/Users/baptiste/Git/cmdclaw`.

Run focused searches before migrating call sites:

    rg -n "logServerEvent\\(" packages/core apps/web
    rg -n "forwardLogPayload|patchConsole|buildConsolePayload|CMDCLAW_VECTOR_LOG_URL" packages/core apps web

After adding the logger facade and refactoring observability, run:

    bun run --cwd packages/core test:unit -- src/server/utils/observability.test.ts
    bun run --cwd packages/core check

If TypeScript errors point at web imports or aliases after migrating `apps/web/src/server/orpc/routers/generation.ts`, run:

    bun run check:web

When validation passes, search again and expect no service runtime usage of the retired API or console interception:

    rg -n "logServerEvent\\(|forwardLogPayload|patchConsole|buildConsolePayload" packages/core apps/web

## Validation and Acceptance

Acceptance comes from tests and searches. The focused observability tests must show that a native `Error` does not serialize as `{}`, that Operational Logs use `event.kind="operational_log"` and a dotted snake case `event`, that Operational Logs do not carry `cmdclaw.event.name`, that forbidden content is removed, and that explicit or child-bound context appears in emitted records. Canonical Service Event tests must show the canonical envelope still includes `cmdclaw.event.name`, `cmdclaw.event.id`, operation name, outcome, service fields, trace correlation, and span enrichment. Client Observation tests must show accepted observations keep their envelope and write through the same stdout log transport.

The code search `rg -n "logServerEvent\\(|forwardLogPayload|patchConsole|buildConsolePayload" packages/core apps/web` must return no production implementation references. `initializeObservabilityRuntime` must not patch `console.*` and must not configure an app-side `/logs` export. Metrics and traces must still resolve Vector endpoints and initialize through OpenTelemetry exporters.

## Idempotence and Recovery

All edits are source edits and can be retried safely. No database migrations, destructive commands, or external service mutations are required. If a mechanical migration creates type errors, use the compiler output to repair call sites rather than reverting unrelated user work. Do not change lint rules. Do not commit unless the user explicitly asks.

## Artifacts and Notes

Important source documents:

    docs/prd/pino-structured-logging.md
    docs/adr/0008-operational-logs-use-stdout-json.md
    docs/observability.md
    CONTEXT.md

Expected final search evidence:

    rg -n "logServerEvent\\(|forwardLogPayload|patchConsole|buildConsolePayload" packages/core apps/web
    # no matches in production code

Validation evidence captured during implementation:

    bun run --cwd packages/core test:unit -- src/server/utils/observability.test.ts src/server/services/slo-journey.test.ts src/server/services/coworker-builder-service.test.ts src/server/services/generation-manager.test.ts
    # Test Files 4 passed; Tests 149 passed, 2 skipped

    bun run --cwd packages/core check
    # exited 0

    bun run check:web
    # Tasks 6 successful; oxlint found 0 warnings and 0 errors

    rg -n "logServerEvent\\(|forwardLogPayload|patchConsole|buildConsolePayload|pendingLogExports|consolePatched|vectorLogUrl|CMDCLAW_VECTOR_LOG_URL" packages/core apps/web -g '!*.test.ts'
    # no matches

    rg -n "from [\"']pino[\"']|require\\([\"']pino[\"']\\)" packages/core apps/web apps/worker apps/ws apps/mcp
    # packages/core/src/server/utils/logger.ts only

## Interfaces and Dependencies

Use `pino` from `packages/core/package.json`. The logger facade should be exported from core server utilities so service code can import it consistently. The public logging interface should include levelled methods for Operational Logs, child logger creation with bound context, Error Diagnostic serialization, and a test-only or injectable sink for assertions. The observability module should continue to export `initializeObservabilityRuntime`, `shutdownObservabilityRuntime`, `emitCanonicalServiceEvent`, `emitClientObservation`, metric helpers, trace helpers, and telemetry normalization helpers.

Revision note 2026-05-29: Initial ExecPlan written from the PRD and repository exploration so implementation can proceed without relying on conversation memory.

Revision note 2026-05-29: Updated after implementation to record the logger facade, observability refactor, call-site migration, validation commands, and final acceptance evidence.
