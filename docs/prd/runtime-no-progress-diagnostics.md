# Runtime No-Progress Diagnostics

## Problem Statement

CmdClaw can leave a **Generation** looking active even when the runtime has stopped making meaningful progress. In the observed production incidents, one chat **Generation** reached the runtime boundary, sent the prompt, received only transport-level connection activity, then waited until the 15-minute run deadline. Another **Generation** entered an interruption path and later appeared stuck to the user because reconnecting clients saw no useful stream activity.

This makes production failures hard to debug. Operators can see repeated stream subscription timeouts, but they cannot quickly distinguish a long-running model turn from a **Dormant Generation**, and by the time the run ends the sandbox/runtime state needed for root-cause analysis may already be gone.

## Solution

CmdClaw should enforce a lifecycle invariant: every non-terminal **Generation** must either show **Runtime Progress** or be a **Waiting Generation** backed by durable human action. A post-prompt runtime turn that produces no **Runtime Progress** within 90 seconds should fail terminally with a precise normalized code, capture a redacted **Runtime Diagnostic Snapshot**, and surface clear user/admin feedback.

Normal users should see: "The runtime stopped responding before producing any output. Please retry."

Admin and operator surfaces should show the actual failure code, phase, runtime identifiers, counters, timings, and a pointer to the **Runtime Diagnostic Snapshot**.

## User Stories

1. As a user, I want a silent runtime failure to become visible quickly, so that I am not left waiting for a 15-minute timeout.
2. As a user, I want a clear retryable error message, so that I know what action to take next.
3. As a user, I want the conversation to stop showing as generating after the runtime fails, so that the UI does not imply work is still happening.
4. As a user, I want a missed runtime question or approval request to remain recoverable, so that reconnecting or refreshing does not hide required action.
5. As an operator, I want post-prompt runtime silence to produce a terminal failure code, so that I can search for and group these incidents.
6. As an operator, I want the failure phase recorded as `prompt_sent`, so that I can distinguish runtime no-progress from sandbox setup, bootstrap, auth, approval, and terminalization problems.
7. As an operator, I want a **Runtime Diagnostic Snapshot** captured before teardown, so that I can debug runtime-boundary failures after the sandbox is gone.
8. As an operator, I want the full diagnostic snapshot stored outside Postgres, so that product state stays bounded while detailed debug artifacts remain available.
9. As an operator, I want `debugInfo` to contain the diagnostic artifact index, so that admin pages and alerts can link to the artifact without loading the full snapshot.
10. As an operator, I want terminal **Canonical Service Events** to include the diagnostic snapshot identifier, so that logs, metrics, traces, and artifacts can be correlated.
11. As an operator, I want event counters after prompt send, so that I can tell whether the runtime emitted no events, only transport events, actionable events, or tracked turn events.
12. As an operator, I want the prompt promise state recorded when the watchdog fires, so that I can tell whether the runtime API call was still pending, resolved, or rejected.
13. As an operator, I want the event stream state recorded when the watchdog fires, so that I can tell whether the stream stayed open, ended early, errored, or was aborted.
14. As an operator, I want safe runtime identifiers recorded, so that I can correlate the failure with runtime logs and sandbox provider state.
15. As an operator, I want the runtime harness and protocol version recorded, so that failures can be grouped by runtime implementation.
16. As an operator, I want model and auth source recorded through existing telemetry conventions, so that provider-specific failures are visible.
17. As an operator, I want a safe OpenCode session state summary, so that I can tell whether CmdClaw subscribed to the wrong stream or the runtime never started the turn.
18. As an operator, I want a safe runtime log tail, so that I can see recent runtime errors without storing prompts, model output, credentials, or file contents.
19. As an operator, I want one failure code for this specific no-progress mode, so that alerts and dashboards do not collapse it into generic runtime errors.
20. As an operator, I want normal production failures to tear down sandboxes after diagnostics are captured, so that failures do not leak resources.
21. As an operator, I want explicit diagnostic runs to optionally preserve sandboxes briefly, so that I can inspect live state when the redacted snapshot is insufficient.
22. As an engineer, I want the watchdog logic encapsulated behind a testable interface, so that no-progress behavior can be verified without real OpenCode or Daytona.
23. As an engineer, I want the snapshot redaction logic tested independently, so that sensitive content cannot leak into diagnostic artifacts.
24. As an engineer, I want reconnect behavior for **Waiting Generations** to replay durable pending actions, so that stream loss does not create a false **Dormant Generation**.
25. As an engineer, I want the terminal finalizer to remain the owner of terminal **Generation** state, so that diagnostics do not create duplicate terminal paths.
26. As an engineer, I want this failure path to update metrics and terminal telemetry consistently with other failed **Generations**, so that SLOs stay accurate.
27. As an engineer, I want the UI to show user-safe copy while admin surfaces show diagnostic details, so that internal runtime details are not exposed to normal users.
28. As an engineer, I want the watchdog threshold to be fixed at 90 seconds for normal production traffic, so that behavior is predictable and easy to reason about.
29. As an engineer, I want diagnostic artifacts to have a retention strategy, so that storage does not grow indefinitely.
30. As an engineer, I want failures caused by missing **Runtime Progress** to be easy to reproduce in tests, so that future runtime integration changes do not reintroduce limbo states.

## Implementation Decisions

- Add a 90-second post-prompt watchdog that starts immediately after the prompt is sent to the runtime.
- The watchdog is satisfied only by **Runtime Progress**: tracked turn events, actionable runtime events, prompt completion, prompt rejection, explicit runtime idle, or explicit runtime error.
- Transport-only activity, event-stream subscription, sandbox preparation, session creation, session replay, cache work, and runtime connection events do not satisfy the watchdog.
- If the watchdog fires, finish the **Generation** as a terminal error rather than parking it.
- Use `runtime_no_progress_after_prompt` as the `completionReason` and normalized error code.
- Use `prompt_sent` as the failure phase.
- Show normal users the user-safe message: "The runtime stopped responding before producing any output. Please retry."
- Show admin/operator surfaces the normalized code, failure phase, runtime identifiers, timings, counters, and diagnostic snapshot pointer.
- Capture a redacted **Runtime Diagnostic Snapshot** before tearing down the runtime environment.
- Store the full **Runtime Diagnostic Snapshot** as an object-storage artifact.
- Store only a bounded diagnostic index in `debugInfo`, including snapshot id or storage key, failure code, failure phase, core timings, and core counters.
- Include the diagnostic snapshot id or storage key in the terminal **Canonical Service Event**.
- The diagnostic snapshot may include safe response shapes, event type counters, prompt promise state, event stream state, last safe event types, runtime harness/protocol, sandbox provider identifiers, session identifiers, and a redacted runtime log tail.
- The diagnostic snapshot must not contain prompts, model output, credentials, authorization headers, cookies, OAuth tokens, raw tool inputs/results, file contents, or unredacted environment variables.
- Normal production failures should tear down the sandbox after the snapshot is captured.
- Explicit admin/internal diagnostic runs may preserve a sandbox briefly after runtime failure, with short TTL and clear telemetry.
- Do not introduce a parallel debug policy mechanism; extend the existing execution policy path used by debug run deadline and approval wait controls.
- Preserve the existing terminal finalization ownership model: request handlers and streams do not own terminal **Generation** state.
- Reconnect behavior for **Waiting Generations** must synthesize or replay durable pending approval/auth/question events from persistent state when the stream has no matching event.
- The stream layer should distinguish "no new stream events" from "durable waiting action exists" so operators do not confuse **Waiting Generations** with **Dormant Generations**.
- Add rate-based alerting or dashboard grouping for `runtime_no_progress_after_prompt`, but avoid paging on a single isolated failure unless existing incident thresholds require it.

## Testing Decisions

- Tests should assert external lifecycle behavior, not implementation details. A test should observe status, emitted stream events, terminal telemetry shape, diagnostic index shape, and user-visible error behavior.
- Add focused tests for the post-prompt watchdog with a fake runtime that emits only transport connection events and never emits **Runtime Progress**.
- Add tests proving transport-only runtime events do not satisfy the watchdog.
- Add tests proving tracked turn events, actionable question/permission events, prompt resolution, prompt rejection, explicit idle, and explicit runtime error each satisfy or short-circuit the watchdog appropriately.
- Add tests proving watchdog expiry terminalizes the **Generation** with `runtime_no_progress_after_prompt`, `prompt_sent`, and failed outcome.
- Add tests proving watchdog expiry does not park the **Generation** as paused or run-deadline parked.
- Add tests proving terminal **Canonical Service Events** include the normalized code, failure phase, and diagnostic snapshot pointer.
- Add tests proving the diagnostic snapshot writer stores only a bounded index in product state and writes full detail to object storage.
- Add tests proving snapshot redaction strips prompts, model output, tool payloads, credentials, cookies, tokens, file contents, and environment variables.
- Add tests proving snapshot capture occurs before sandbox teardown.
- Add tests proving normal watchdog failure tears down the sandbox.
- Add tests proving an explicit diagnostic execution policy can preserve the sandbox for a bounded TTL.
- Add tests proving reconnecting to a **Waiting Generation** replays or synthesizes the durable pending action event.
- Add tests proving reconnecting to a terminal runtime no-progress failure yields a terminal error event and does not continue long-polling indefinitely.
- Prior art exists in current generation manager tests for run deadline parking, interrupt suspension, active generation state, stream replay, and terminal event emission. Extend those patterns rather than relying on mocks that duplicate runtime logic.
- Live or integration validation should include one controlled diagnostic run with a fake or harnessed no-progress runtime path, then query logs and artifact storage to prove correlation works.

## Out of Scope

- Fixing the underlying root cause of OpenCode no-progress incidents is out of scope for this PRD. This PRD makes the failure fast, terminal, observable, and diagnosable.
- Replacing OpenCode or changing runtime provider strategy is out of scope.
- Broad UI redesign of chat, coworker run pages, admin dashboards, or inbox is out of scope.
- Changing lint rules or lint configuration is out of scope.
- Storing raw prompts, raw model output, raw tool payloads, credentials, cookies, tokens, or file contents in diagnostics is out of scope.
- Keeping all failed production sandboxes alive by default is out of scope.
- Changing general run deadline behavior for productive long-running **Generations** is out of scope.

## Further Notes

- The agreed lifecycle invariant is: every non-terminal **Generation** must either be terminalizing, show **Runtime Progress**, or be a **Waiting Generation** backed by durable human action. Anything else is a **Dormant Generation** and should be treated as a product bug.
- This PRD relies on the glossary terms **Generation**, **Waiting Generation**, **Dormant Generation**, **Runtime Progress**, **Runtime Diagnostic Snapshot**, **Canonical Service Event**, and **Client Observation**.
- Runtime Diagnostic Snapshot storage is covered by ADR 0004.
- The initial threshold is 90 seconds. This should be treated as a product reliability constant for this failure mode, not as a substitute for the existing full run deadline.
