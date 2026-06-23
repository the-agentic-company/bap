# PRD: Runtime Progress Stall Watchdog

## Problem Statement

Bap can leave a **Generation** waiting until the full run deadline even after the runtime has already made **Runtime Progress** and then stopped. In the diagnosed production chat, OpenCode completed an initial assistant step, ran one `executor_execute` tool call, received a normal tool result, created a second assistant continuation message with zero parts and zero tokens, then stayed silent until Bap aborted the prompt at the 15-minute deadline.

From the user's perspective, this looks like a fast query becoming inexplicably stuck. From the operator's perspective, the terminal state is misleading: the **Generation** parks as `run_deadline` instead of failing fast as a runtime-boundary stall, and the most useful diagnostic evidence is only available if someone manually recovers the OpenCode session snapshot.

## Solution

Bap should treat "progress happened, then stopped" as a first-class runtime failure: **Runtime Progress Stall**. A **Generation** that has observed **Runtime Progress** but then receives no further **Runtime Progress** for 3 minutes should fail terminally with `runtime_progress_stalled`, capture a redacted **Runtime Diagnostic Snapshot**, abort the OpenCode session, and archive the diagnostic sandbox when eligible.

The fix should also tighten the domain model by renaming the persisted and in-memory "last runtime event" concept to **Last Runtime Progress**. Transport events, empty assistant message creation, session setup, cache work, and stream reconnects must not keep a **Dormant Generation** alive.

Suggested Linear label/status: `ready-for-agent`.

## User Stories

1. As a user, I want a runtime stall after a tool result to fail quickly, so that I am not left waiting for the 15-minute run deadline.
2. As a user, I want the chat to stop showing active generation when the runtime is no longer progressing, so that the UI reflects reality.
3. As a user, I want a clear retryable failure instead of an indefinite wait, so that I know the current attempt did not complete.
4. As a user, I want normal long-running work that continues producing **Runtime Progress** to keep running, so that productive runs are not interrupted.
5. As an operator, I want `runtime_progress_stalled` to be distinct from `runtime_no_progress_after_prompt`, so that initial runtime silence and post-progress stalls can be grouped separately.
6. As an operator, I want the terminal **Canonical Service Event** to classify this as a timed-out runtime failure, so that SLOs and alerts reflect the failure without confusing it with `run_deadline`.
7. As an operator, I want the failure phase to be `runtime`, so that I can distinguish runtime stalls from bootstrap, approval, auth, and run deadline behavior.
8. As an operator, I want the normalized error code to be `runtime_progress_stalled`, so that logs, metrics, traces, and debug artifacts can be correlated by one bounded code.
9. As an operator, I want **Last Runtime Progress** recorded precisely, so that I can see when the runtime last made meaningful progress.
10. As an operator, I want `stalledMs` recorded when the watchdog fires, so that I can validate timeout behavior.
11. As an operator, I want the last progress kind recorded, so that I can tell whether the stall happened after text, reasoning, a tool call, a tool result, a question, a permission request, or terminal state.
12. As an operator, I want a safe summary of the last progress event, so that I can debug without exposing prompts, model output, raw tool inputs, or raw tool results.
13. As an operator, I want the active assistant message summarized when possible, so that zero-part and zero-token OpenCode continuation hangs are visible.
14. As an operator, I want a **Runtime Diagnostic Snapshot** captured before teardown, so that runtime-boundary state is available after the failure.
15. As an operator, I want only a bounded snapshot index in product state, so that Postgres stays queryable and small.
16. As an operator, I want detailed diagnostic data in object storage, so that larger runtime probes and safe log tails do not bloat product rows.
17. As an operator, I want the diagnostic sandbox archived under the existing short retention policy, so that filesystem/runtime state is available for platform-suspect failures.
18. As an operator, I want diagnostic capture failure to be non-blocking, so that a failed snapshot does not create another **Dormant Generation**.
19. As an engineer, I want the stale-progress watchdog inside the OpenCode runner, so that it has live access to prompt state, event-loop state, runtime client, session id, and sandbox.
20. As an engineer, I want the watchdog to use **Last Runtime Progress**, so that raw transport activity cannot mask a runtime stall.
21. As an engineer, I want the existing no-initial-progress behavior preserved, so that a prompt with no **Runtime Progress** still fails as `runtime_no_progress_after_prompt`.
22. As an engineer, I want completed tool results to count as **Runtime Progress**, so that the watchdog does not fire while tools are completing normally.
23. As an engineer, I want empty assistant message creation not to count as **Runtime Progress**, so that OpenCode zero-token continuation hangs are detected.
24. As an engineer, I want duplicate or no-op runtime events not to count as **Runtime Progress**, so that repeated state echoes cannot keep a **Generation** alive.
25. As an engineer, I want `last_runtime_event_at` renamed to `last_runtime_progress_at`, so that the schema matches the domain model.
26. As an engineer, I want `lastRuntimeEventAt` renamed to `lastRuntimeProgressAt`, so that TypeScript code does not preserve misleading terminology.
27. As an engineer, I want `markRuntimeActivity` renamed to `markRuntimeProgress`, so that future runtime integrations update the timestamp only for meaningful progress.
28. As an engineer, I want a big-bang rename rather than compatibility aliases, so that the codebase has one canonical term.
29. As an engineer, I want the runtime diagnostic snapshot schema to support both no-initial-progress and progress-stalled reasons, so that both failure modes share the same artifact pattern.
30. As an engineer, I want no automatic retry in this patch, so that fail-fast detection and diagnostics ship before recovery semantics are designed.
31. As an engineer, I want no duplicate tool execution risk from automatic recovery, so that a stall after a write tool cannot be retried accidentally.
32. As an engineer, I want tests that reproduce progress-then-stall behavior, so that this production failure mode cannot regress.
33. As an engineer, I want tests that prove terminal telemetry classification, so that dashboards do not collapse this into generic runtime or run deadline failures.
34. As an engineer, I want tests that prove diagnostic snapshots are redacted, so that sensitive content is not stored in debug artifacts.
35. As a future agent, I want glossary and ADR language to name this failure mode, so that runtime lifecycle changes use the same vocabulary.

## Implementation Decisions

- Introduce `runtime_progress_stalled` as a `Generation` completion reason.
- Treat `runtime_progress_stalled` as terminal `error` status, not a paused or parked **Generation**.
- Map `runtime_progress_stalled` to terminal outcome `timed_out`.
- Map `runtime_progress_stalled` to failure phase `runtime`.
- Use `runtime_progress_stalled` as the normalized error code.
- Use a 3-minute default threshold for detecting a **Runtime Progress Stall**.
- Replace the current one-shot no-progress suppression behavior with a sliding watchdog that repeatedly evaluates stale **Runtime Progress** while the prompt is active.
- Preserve the existing no-initial-progress behavior: if no **Runtime Progress** occurs after prompt send within the threshold, fail as `runtime_no_progress_after_prompt`.
- Add a distinct progress-stalled branch: if **Runtime Progress** has happened and `now - lastRuntimeProgressAt` reaches the threshold, fail as `runtime_progress_stalled`.
- The watchdog should live in the OpenCode normal runner's prompt and event-loop orchestration, not in a queue or maintenance job.
- The watchdog should race against event-loop consumption, prompt completion, cancellation, session idle, session error, and durable human waits.
- The watchdog must not fire while the **Generation** is intentionally waiting for approval, authentication, or runtime question handling.
- Completed tool results count as **Runtime Progress**.
- Tool use creation/running state counts as **Runtime Progress** when it creates user-visible tool state.
- Text deltas and reasoning deltas count as **Runtime Progress** when accepted by the translator.
- Runtime permission and question requests count as **Runtime Progress**.
- Runtime terminal idle and runtime terminal error count as **Runtime Progress** and short-circuit stall detection.
- Prompt completion counts as **Runtime Progress**.
- Empty assistant message creation does not count as **Runtime Progress**.
- `server.connected`, session setup, sandbox preparation, session replay, cache writes, stream reconnects, subscribe RPC activity, and transport-only events do not count as **Runtime Progress**.
- Duplicate runtime events that do not append, broadcast, terminalize, or create durable pending action state do not count as **Runtime Progress**.
- Rename the persisted `Generation` timestamp from "last runtime event" to **Last Runtime Progress** using the canonical schema name `last_runtime_progress_at`.
- Rename the TypeScript lifecycle field to `lastRuntimeProgressAt`.
- Rename the in-memory lifecycle method to `markRuntimeProgress`.
- Perform the rename as a big-bang schema and code change. Do not add dual-read fallback logic or long-lived compatibility aliases.
- Update lifecycle creation, turn intake, turn runner, lifecycle store, suspension, finalization, recovery, diagnostics, and tests to use **Last Runtime Progress** language.
- Extend the **Runtime Diagnostic Snapshot** reason vocabulary to include `runtime_progress_stalled`.
- Store only a bounded diagnostic index in `Generation` debug metadata.
- The debug index should include snapshot id, storage key, upload status, reason, session id, sandbox id, event counters, `lastRuntimeProgressAt`, `stalledMs`, and last progress kind.
- Store the full diagnostic payload in object storage under the existing diagnostic snapshot pattern.
- The full snapshot may include safe probe summaries, active assistant message summary, event-loop counters, status shapes, and redacted log tail.
- The full snapshot must not include raw prompts, raw model output, raw tool inputs, raw tool results, credentials, cookies, tokens, authorization headers, file contents, or unredacted environment variables.
- Include `runtime_progress_stalled` in diagnostic sandbox archive eligibility under the same three-day retention policy as other platform-suspect runtime failures.
- If snapshot capture or sandbox archival fails, still terminalize the **Generation** as `runtime_progress_stalled`.
- Do not implement automatic retry or recovery for this PRD.
- Recovery after progress stalls should be designed later, with explicit write-tool and idempotency rules.
- Update glossary/ADR language to document **Runtime Progress Stall**, **Last Runtime Progress**, runtime diagnostic snapshot eligibility, and archived diagnostic sandbox eligibility.

## Testing Decisions

- Tests should assert external lifecycle behavior: terminal status, completion reason, stream status, diagnostic index shape, runtime abort, canonical telemetry fields, and sandbox archival eligibility.
- Tests should not duplicate internal implementation logic in a way that becomes a second watchdog implementation.
- Add a runtime lifecycle test where a prompt emits **Runtime Progress**, completes a tool result, then emits no further meaningful progress for 3 minutes.
- That test should assert terminal status `error`, completion reason `runtime_progress_stalled`, runtime abort called, diagnostic snapshot captured, and no `run_deadline` parking.
- Add a complementary no-initial-progress test proving no **Runtime Progress** still yields `runtime_no_progress_after_prompt`.
- Add translator or runtime driver tests proving completed tool result marks **Runtime Progress**.
- Add translator or runtime driver tests proving accepted text and reasoning deltas mark **Runtime Progress**.
- Add translator or runtime driver tests proving permission and question requests mark **Runtime Progress**.
- Add translator or runtime driver tests proving empty assistant `message.updated` does not mark **Runtime Progress**.
- Add translator or runtime driver tests proving session setup, `server.connected`, and duplicate no-op updates do not mark **Runtime Progress**.
- Add diagnostic snapshot tests proving `runtime_progress_stalled` snapshots include `lastRuntimeProgressAt`, `stalledMs`, last progress kind, and safe active assistant message summary.
- Add diagnostic snapshot redaction tests proving prompts, model output, raw tool payloads, credentials, cookies, tokens, authorization headers, file contents, and raw environment values are absent.
- Add canonical terminal event tests proving `runtime_progress_stalled` maps to outcome `timed_out`, failure phase `runtime`, and normalized code `runtime_progress_stalled`.
- Add sandbox archival eligibility tests proving `runtime_progress_stalled` follows the existing bounded archival path.
- Add schema/lifecycle tests or migration checks proving the renamed **Last Runtime Progress** field is read and written consistently.
- Prior art exists in generation manager tests for no-progress diagnostics, run-deadline parking, interrupt suspension, diagnostic snapshots, terminal event emission, and diagnostic sandbox archival. Extend those patterns.
- Focused verification should run the generation manager/runtime tests, diagnostic snapshot tests, canonical generation event tests, and any migration/schema tests touched by the rename.

## Out of Scope

- Automatic retry or recovery after `runtime_progress_stalled`.
- Designing idempotency rules for safe continuation after a stall.
- Replacing OpenCode or changing the runtime provider.
- Fixing the upstream OpenCode/provider stall itself.
- Changing the full 15-minute run deadline for productive **Generations**.
- Changing approval, authentication, or **Waiting Generation** behavior.
- Adding raw prompts, model output, raw tool inputs/results, credentials, cookies, tokens, authorization headers, file contents, or unredacted environment variables to diagnostics.
- Keeping all failed sandboxes alive by default.
- Broad chat UI redesign.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

- This PRD follows the glossary terms **Generation**, **Runtime Progress**, **Last Runtime Progress**, **Runtime Progress Stall**, **Dormant Generation**, **Waiting Generation**, **Runtime Diagnostic Snapshot**, **Archived Diagnostic Sandbox**, and **Canonical Service Event**.
- The diagnosed production conversation was `ef60d5d2-69b8-4316-949f-04b140a1e6de`.
- The relevant generation was `5d61e8de-e4d7-46b2-8f67-dd9ad6c785c4`.
- The OpenCode session snapshot showed a completed first assistant tool step followed by a second assistant message with zero parts, zero tokens, and `MessageAbortedError` only after Bap aborted at the 15-minute deadline.
- The snapshot was stored as an OpenCode session snapshot, not as a **Runtime Diagnostic Snapshot**. This PRD ensures future similar failures produce the runtime diagnostic artifact automatically.
- ADR 0004 records the Runtime Diagnostic Snapshot storage pattern and has been updated to include progress stalls.
- ADR 0005 records archived diagnostic sandbox eligibility and has been updated to include progress stalls.
- Suggested Linear label/status: `ready-for-agent`.
