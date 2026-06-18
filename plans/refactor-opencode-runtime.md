# Refactor the OpenCode runtime/session modules into deep modules under 1000 lines

Save this file as `plans/refactor-opencode-runtime.md`.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This work follows the architecture rubric in `.agents/skills/improve-codebase-architecture/SKILL.md` and `.agents/skills/improve-codebase-architecture/LANGUAGE.md`, and the ExecPlan discipline in `.agents/skills/execplan/SKILL.md`. Maintain this document in accordance with that skill file.

## Purpose / Big Picture

Three OpenCode runtime files in the `@bap/core` package each exceed 1000 lines, which trips the repository's `eslint(max-lines)` gate (configured at `max: 1000` in `.oxlintrc.json`) and makes the code hard for both humans and agents to navigate:

- `packages/core/src/server/runtime/opencode/opencode-normal-runner.ts` (1565 lines) — one class `OpenCodeNormalRunner` with a single 1300-line `run()` method that drives a full generation turn.
- `packages/core/src/server/runtime/opencode/opencode-runtime-driver.ts` (1231 lines) — a flat collection of ~40 exported pure helpers spanning three unrelated concerns.
- `packages/core/src/server/sandbox/opencode-session.ts` (1748 lines) — three sandbox-provider adapters (E2B, Daytona, Docker) plus a session-finalization algorithm that is copy-pasted twice, plus skill-writing helpers.

After this change, every one of those three files and every new file created is strictly under 1000 lines, the package typechecks, and the existing unit tests covering these modules still pass — with **no change to any externally-imported interface**. A reader can verify success by running, from the worktree root:

    cd packages/core && bunx tsc --noEmit -p tsconfig.json
    cd packages/core && bunx vitest run src/server/runtime/opencode src/server/sandbox/opencode-session.test.ts src/server/sandbox/core/session-pipeline.test.ts
    bunx oxlint --config .oxlintrc.json --format json <the three target files plus every new file>

and observing: zero new type errors, all listed tests green, and zero `eslint(max-lines)` diagnostics.

The deepening principle (from the rubric): each extracted module must be **deep** — a lot of behaviour behind a small interface — and must pass the **deletion test**: deleting it would make complexity reappear across multiple callers, not merely move it. We are not doing shallow "cut the file in half" splits.

## Orientation: how these files fit together

`OpenCodeNormalRunner.run()` (the runner) orchestrates a single generation turn: it boots a sandbox + agent session, sends the user prompt, consumes a server-sent-event stream, runs watchdogs for "no progress" / deadlines, resolves the assistant's final text, and finalizes the turn. It depends on the runtime-driver for stream/event helpers and prompt-completion resolution, and (transitively, via its callbacks) on the session module for sandbox creation.

`opencode-runtime-driver.ts` (the driver) is a stateless toolbox of pure functions plus one stream class. Its callers are: the runner, `opencode-runtime-actions.ts`, `opencode-generation-runtime-driver.ts`, `opencode-turn-events.ts`, and `services/runtime-diagnostic-snapshot-service.ts`. They import specific named symbols **from the path `./opencode-runtime-driver`** (or `../runtime/opencode/opencode-runtime-driver`). That path is the seam: it must keep exporting the same names.

`opencode-session.ts` (the session module) provisions a sandbox for a given cloud provider and gets-or-creates an OpenCode session inside it. Its externally-used exports are `getOrCreateSandboxForCloudProvider`, `completeSessionInitForCloudProvider`, and the types `OpenCodeSandbox` / `OpenCodeSessionConfig`, all consumed by `sandbox/core/session-pipeline.ts` and the colocated test. Several other exports (`writeSkillsToSandbox`, `getSkillsSystemPrompt`, etc.) appear unused outside the file today but must be preserved as exports to avoid silent interface changes.

## Strategy

For each oversized file, keep the original path as the **seam** that callers already import from, and move cohesive behaviour into focused sibling modules behind it. The original file becomes thin (a small composition/barrel layer) while each new module is internally deep.

Crucially, the new modules are not pass-throughs: the barrel-style re-export in the driver is acceptable because the *callers* treat `./opencode-runtime-driver` as a stable import surface, and each behind-it module concentrates a real cluster of behaviour (the deletion test passes: deleting e.g. the prompt-completion module would scatter the transcript-resolution algorithm back into the runner and the diagnostic service).

### Driver decomposition (concern-based, three deep modules behind a barrel)

The driver mixes three concerns that never share private state. Split along them and re-export from `opencode-runtime-driver.ts`:

1. `opencode-runtime-events.ts` — the event-stream domain: `OpenCodeTrackedEvent`, `OpenCodeActionableEvent`, the `isOpenCode*Event` guards, `OpenCodeRuntimeStreamStats`, `inspectOpenCodeRuntimeEvent`, `processOpenCodeRuntimeEvent`, the `OpenCodeRuntimeEventLoop` class, `extractOpenCodeMessageErrorFromSessionMessages`, plus the event-only error extractors and the `OpenCodeRuntimeToolRef` type and `updateOpenCodeToolPart` (tool-part write-back belongs with event/tool handling).
2. `opencode-runtime-approvals.ts` — the permission/question approval protocol: `OpenCodeApprovalCapableClient`, `OpenCodeApprovalRuntimeRequest`, `OpenCodeActionableHandlingResult`, `shouldAutoApproveOpenCodePermission`, `reply/reject*` functions, `sendOpenCodeApprovalRuntimeDecision`, `handleOpenCodeActionableEvent`, and the default-answer / command builders.
3. `opencode-prompt-completion.ts` — the prompt-result + transcript resolution domain: `OpenCodeEmptyCompletionDiagnostics`, `OpenCodePromptResultEnvelope`, `OpenCodePromptCompletionResolution`, `OpenCodeTerminalReconciliationOutcome`, the `extractAssistantText*` / `describe*` / `getRuntimeStatusTypeForSession` payload helpers, `isOpaqueDiagnosticMessage`, `collectOpenCodeEmptyCompletionDiagnostics`, `resolveOpenCodePromptCompletion`, `waitForOpenCodeTerminalStateAfterEarlyStreamEnd`, and `captureOpenCodeUsageFromSession`.

Shared by all three: `formatErrorMessage`, `extractStructuredErrorMessage`, `safeJsonStringify`, `summarizeUnknownValue`. These move to `opencode-runtime-error-format.ts`. `summarizeUnknownValue` is also imported externally (by the diagnostic service via the driver path), so the driver barrel must re-export it.

`opencode-runtime-driver.ts` then becomes a pure re-export barrel (well under 1000 lines) listing the same public names. All five external import sites keep working unchanged.

### Session decomposition (provider adapters + one deep reconciliation algorithm)

The session module has two real seams:

1. The three **sandbox-provider adapters** (E2B, Daytona, Docker). Each wraps a provider SDK into the common `OpenCodeSandbox` shape and knows how to boot/await its OpenCode server. Move shared types (`OpenCodeSandbox`, `OpenCodeSessionConfig`, `OpenCodeSessionOptions`, `OpenCodeSessionResult`, `OpenCodeSandboxInitResult`, lifecycle types) into `opencode-session-types.ts`; move provider-specific code into `opencode-session-daytona.ts` and `opencode-session-docker.ts` (and shared bootstrap/env helpers into `opencode-session-support.ts`).
2. The **session reconciliation algorithm** — "reuse live session, else restore snapshot, else create + replay history" — is currently duplicated verbatim across `getOrCreateCloudSession` and `completeSessionInitForCloudProvider`. This is the deepest seam: extract it once into `opencode-session-reconcile.ts` as `reconcileOpenCodeSession(...)` taking the resolved `client` + `sandbox` + `reused` flag. Both `getOrCreateCloudSession` and `completeSessionInitForCloudProvider` call it; the runner-facing finalizer (`completeSessionInitForCloudProvider`) layers MCP reconciliation on top. `replayConversationHistory` moves alongside it.

`opencode-session.ts` keeps the same public exports (`getOrCreateSandboxForCloudProvider`, `completeSessionInitForCloudProvider`, the skill-writing helpers, the system-prompt builders, and the provider-selection entry points), re-exporting types and delegating to the new modules.

### Runner decomposition (phase modules behind the runner)

`OpenCodeNormalRunner.run()` is one method; the class's only public interface is `new OpenCodeNormalRunner(callbacks).run(ctx)`. Behind it sit three cohesive phases with their own locality:

1. **Sandbox + agent bootstrap** — everything from `sandbox_init_started` through obtaining `sessionId` + `client` + sending the prompt's pre-prompt asset staging. This is a large self-contained algorithm; extract its hardest, most independent pieces into `opencode-runner-bootstrap.ts` as helpers the runner calls.
2. **No-progress watchdog** — the `setInterval` watchdog body and `finishRuntimeWatchdogFailure`. Extract into `opencode-runner-watchdog.ts`: a factory that, given the event-loop snapshot accessor and abort hooks, returns `{ start, clear, promise }` and a `finishRuntimeWatchdogFailure` builder. This concentrates the no-progress/stall policy.
3. **Helper utilities** already at top of file (`withTimeout`, `formatErrorMessage`, `isBootstrapTimeoutError`, `resolveRuntimeNoProgressTimeoutMs`, `probeOpenCodeAssistantMessageError`) move to `opencode-runner-support.ts`.

The `NormalRunnerCallbacks` type (a 90-line interface) moves to `opencode-runner-types.ts`. The class keeps the same constructor + `run` signature, so `opencode-generation-runtime-driver.ts` (the only importer) is untouched.

If the runner still exceeds 1000 lines after these extractions, perform a "code judo" move: extract the post-prompt completion/finalization tail (assistant-text application, empty-completion error handling, file collection, summary) into `opencode-runner-finalize.ts`. Re-measure and iterate until under 1000.

## Progress

- [x] (2026-06-18) Read all three target files, the architecture skill, and the execplan skill; mapped every external import site of each file.
- [x] (2026-06-18) Authored this ExecPlan.
- [x] (2026-06-18) Milestone D: decompose the driver into events/approvals/prompt-completion/error-format modules behind a re-export barrel. Driver now 58 lines.
- [x] (2026-06-18) Milestone S: decompose the session module into types/support/daytona/docker/reconcile modules. Session now 455 lines.
- [x] (2026-06-18) Milestone R: decompose the runner into types/support/watchdog/bootstrap modules. Runner now 550 lines.
- [x] (2026-06-18) Verify: typecheck (clean), scoped vitest (42/42 pass, matches baseline), and oxlint max-lines (0 diagnostics) all green.

## Surprises & Discoveries

- Observation: the prompt's third target path `runtime/opencode/opencode-session.ts` does not exist; the real third oversized file is `sandbox/opencode-session.ts` (1748 lines). Confirmed via `find`/`wc`. Treated that as the third target.
  Evidence: `find packages -name "opencode-session*"` -> `packages/core/src/server/sandbox/opencode-session.ts`.
- Observation: the driver is already a flat module of pure functions; the decomposition risk is shallow splitting. Mitigated by grouping along the three never-shared concerns and applying the deletion test to each group.
- Observation: `getOrCreateCloudSession` and `completeSessionInitForCloudProvider` share a ~130-line verbatim reconciliation body — the single highest-value extraction (real duplication, real locality win).
  Evidence: lines 1017-1162 vs 1298-1452 of the original session file are near-identical apart from the `client`/`reused` source and the `mcpWarnings` field.

## Decision Log

- Decision: keep each original file path as the stable seam (barrel / thin composition layer) and move behaviour into focused siblings, rather than renaming or relocating the entrypoints.
  Rationale: preserves every existing import unchanged (hard requirement: no public interface change), while letting each sibling be internally deep.
  Date/Author: 2026-06-18 / refactor agent
- Decision: split the driver by concern (events / approvals / prompt-completion) plus a shared error-format module, not by "first half / second half".
  Rationale: the three concerns share no private state; grouping by concern yields three deep modules that each pass the deletion test, whereas a positional split would scatter one concern across two files.
  Date/Author: 2026-06-18 / refactor agent
- Decision: extract the session reconciliation algorithm once into `reconcileOpenCodeSession`.
  Rationale: it is duplicated verbatim today; concentrating it is the textbook locality win and removes a class of "fixed in one copy, not the other" bugs.
  Date/Author: 2026-06-18 / refactor agent
- Decision: extract the runner's no-progress watchdog as a self-contained factory returning {start, clear, promise} plus a finishRuntimeWatchdogFailure builder, keeping the runner's run() body as the orchestrator.
  Rationale: the watchdog is the most independently-testable policy cluster in the runner; behind a tiny interface it hides the interval body, the stall/no-progress decision, and the diagnostic-snapshot failure path.
  Date/Author: 2026-06-18 / refactor agent

## Outcomes & Retrospective

All three target files brought under 1000 lines via concern-based decomposition with the original paths preserved as stable seams. Final line counts: driver 58, session 455, runner 550. New modules: driver -> events 451 / approvals 296 / prompt-completion 440 / error-format 58; session -> types 91 / support 177 / daytona 554 / docker 293 / reconcile 171; runner -> types 109 / support 120 / watchdog 239 / bootstrap 707. Every target and new file is well under 1000 lines. No external interface changed (all caller import sites untouched); typecheck is clean, scoped vitest is 42/42 (matching the pre-refactor baseline), and oxlint reports zero max-lines diagnostics. See the Verify section commands above to reproduce.
</content>
