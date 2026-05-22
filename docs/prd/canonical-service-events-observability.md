# PRD: Canonical Service Events Observability

## Problem Statement

CmdClaw has JSON logs, OpenTelemetry metrics/traces, PostHog client analytics, and durable product state, but the operational story is fragmented. Debugging a Generation can require reading many log lines, checking traces separately, guessing which browser events matter, and manually joining request, worker, sandbox, and client-side symptoms.

The user wants CmdClaw to adopt the Observability Engineering-style model of wide, context-rich events: one authoritative operational record per service-owned operation, with enough structured dimensions to debug real incidents without copying sensitive product content into telemetry.

## Solution

CmdClaw will introduce **Canonical Service Events** as the authoritative observability record for service-owned operations and **Client Observations** as the first-party browser-side complement. Canonical Service Events will enrich trace spans and emit one final structured log event through the existing Vector, VictoriaLogs, VictoriaMetrics, and VictoriaTraces pipeline.

The first rollout focuses on the Generation path because it has the highest correlation pain: request lifecycle, streaming, durable terminal state, sandbox behavior, tool calls, interruptions, and browser-visible errors. The implementation will be staged through foundation, Generation instrumentation, client observation intake, and metric/query validation.

## User Stories

1. As an operator, I want one authoritative terminal Generation event, so that I can understand whether a Generation completed, failed, timed out, or was cancelled.
2. As an operator, I want phase timings on the terminal Generation event, so that I can see whether latency came from setup, model streaming, tool execution, or post-processing.
3. As an operator, I want request-level Canonical Service Events for Generation start and stream subscribe operations, so that I can distinguish request success from Generation success.
4. As an operator, I want browser Client Observations for Generation stream open, close, error, and latency markers, so that I can connect what the User saw to what the server did.
5. As an operator, I want to query by Generation id, so that I can see request, terminal, and client-side observations for one Generation.
6. As an operator, I want to query by trace id, so that I can inspect causal timing across spans and logs.
7. As an operator, I want normalized outcomes and failure phases, so that I can group failures without parsing human prose.
8. As an operator, I want model provider and sandbox provider fields, so that I can identify provider-specific or runtime-specific regressions.
9. As an operator, I want safe tool-use summaries, so that I can debug integration behavior without storing tool payloads.
10. As an operator, I want approval and auth interruption summaries, so that I can tell whether a Generation stalled on user input or credentials.
11. As an operator, I want token usage and duration metrics tied to terminal outcomes, so that reliability and cost symptoms can be correlated.
12. As an operator, I want deployment version, commit SHA, and deployment id on events, so that I can identify regressions introduced by a release.
13. As an operator, I want high-cardinality identifiers available in logs, so that I can debug a specific User, workspace, conversation, Generation, trace, or sandbox.
14. As an operator, I want metrics to avoid high-cardinality labels, so that alerts and dashboards stay stable.
15. As an operator, I want alerts and SLOs to come from metrics, so that alerting is fast, bounded, and reliable.
16. As an operator, I want Canonical Service Events to remain queryable by agents, so that Codex and other agents can diagnose failures directly from VictoriaLogs and VictoriaTraces.
17. As an engineer, I want a shared Canonical Service Event builder, so that logs and span attributes do not drift.
18. As an engineer, I want emitted telemetry names to follow OpenTelemetry-style dotted snake_case, so that fields work cleanly across observability tools.
19. As an engineer, I want TypeScript internals to be allowed to use camelCase while emission normalizes field names, so that implementation can stay idiomatic without leaking inconsistent schemas.
20. As an engineer, I want a strict denylist for telemetry content, so that credentials, prompts, model output, emails, documents, and request bodies are never copied into observability.
21. As an engineer, I want the client observation endpoint to accept only allowlisted event types, so that the browser cannot send arbitrary logs.
22. As an engineer, I want the client observation endpoint to require authentication for user-linked observations, so that telemetry cannot be used as an unauthenticated log injection surface.
23. As an engineer, I want server-side access checks for supplied Generation and conversation identifiers, so that a client cannot attach observations to resources it cannot access.
24. As an engineer, I want client observations forwarded through observability instead of stored in Postgres, so that raw operational telemetry does not become application state.
25. As an engineer, I want PostHog to remain for product analytics and session replay, so that product analytics stays separate from operational truth.
26. As an engineer, I want session replay treated as auxiliary debugging context, so that first-party observations remain the authoritative browser operational signal.
27. As an engineer, I want terminal Generation events reconstructed from durable lifecycle state, so that stateless runtime replacement and recovery do not lose the authoritative event.
28. As an engineer, I want deterministic event ids for terminal Generation events, so that recovery paths cannot double-count terminal records.
29. As an engineer, I want request and worker operation event ids, so that duplicated or retried operations can be identified.
30. As an engineer, I want browser-generated client event ids, so that duplicate Client Observations can be detected within a short window.
31. As an engineer, I want a clear boundary between observability and Audit Records, so that operational telemetry does not become the durable Audit Trail.
32. As an engineer, I want raw product content debug needs to point to authorized product records, so that observability identifies where to inspect rather than duplicating sensitive content.
33. As a support engineer, I want to find all visible client errors for a Generation, so that I can explain what the User experienced.
34. As a support engineer, I want to see whether a Generation stream reconnected or closed normally, so that I can diagnose perceived hangs.
35. As a support engineer, I want terminal Generation outcome to differ from start request outcome, so that I do not mistake “request accepted” for “agent succeeded.”
36. As a product engineer, I want product analytics and operational observations separated, so that product funnels are not polluted with low-level debugging events.
37. As a reliability engineer, I want low-cardinality terminal Generation metrics, so that SLOs can be built from stable dimensions.
38. As a reliability engineer, I want failed Generations grouped by model provider, sandbox provider, failure phase, and normalized error code, so that incident triage starts from useful clusters.
39. As a reliability engineer, I want retention and sampling policies that keep all server Canonical Service Events but selectively retain client success observations, so that signal stays useful without uncontrolled volume.
40. As a future agent, I want stable field names and documented query patterns, so that I can diagnose CmdClaw without reading source code first.

## Implementation Decisions

- Build a deep observability module that owns Canonical Service Event construction, schema normalization, denylist enforcement, span enrichment, and final structured log emission.
- Canonical Service Events use a required common envelope plus operation-specific attributes.
- Emitted telemetry uses OpenTelemetry-style dotted snake_case. Official semantic names are preferred when they fit; CmdClaw-specific fields live under `cmdclaw.*`.
- Keep backend-friendly correlation aliases such as `trace_id` and `span_id` in JSON logs when useful for VictoriaLogs and trace correlation.
- A Canonical Service Event is emitted for each service-owned operation: RPC requests, webhooks, worker jobs, and the terminal Generation lifecycle.
- Browser-originated telemetry is a Client Observation, not a Canonical Service Event.
- Client Observations are accepted only through an allowlisted contract and forwarded to the observability pipeline.
- Raw Client Observations are not stored in Postgres by default.
- PostHog remains the product analytics surface for funnels, adoption, pageviews, broad UX trends, and session replay.
- PostHog session replay can support debugging when visual context matters, but first-party Client Observations are the authoritative operational browser signal.
- Canonical Service Events are logs and spans from one source. The builder enriches active spans and emits one final structured log event.
- The terminal Generation event is emitted by the server-side lifecycle owner that persists terminal completion, failure, cancellation, or timeout.
- Request handlers emit request-level Canonical Service Events; browser streams emit Client Observations; neither owns the terminal Generation event.
- A Generation emits one terminal Canonical Service Event. Phase structure belongs in spans and timing attributes, not separate phase-level canonical events.
- Terminal Generation outcome is product lifecycle outcome: completed, failed, cancelled, or timed out. It is separate from the outcome of the request that created or observed the Generation.
- Terminal Generation events are reconstructed from durable lifecycle state at terminal emission time.
- Request and worker events may use in-memory builders because they begin and end within one operation scope.
- Every Canonical Service Event has a stable `cmdclaw.event.id`.
- The terminal Generation event id is deterministic from the Generation, such as `generation:{generationId}:terminal`.
- Client Observations carry a browser-generated client event id.
- The first-party client observation endpoint requires the normal authenticated web session for user-linked telemetry.
- The server derives User and workspace identifiers from the authenticated session, never from client-supplied identifiers.
- The client endpoint verifies access to supplied Generation and conversation identifiers.
- The client endpoint rate-limits by user, session, and IP and returns a non-blocking success response.
- Server Canonical Service Events are retained at full fidelity by default.
- Client Observations are rate-limited and selectively retained. Failures, visible errors, and Generation stream errors are kept at full fidelity; low-value successful observations may be sampled.
- Logs may include high-cardinality identifiers. Metrics must not use high-cardinality labels. Span attributes may include lookup identifiers but not large payloads or unbounded arrays.
- Canonical Service Events and Client Observations must not contain credentials, session cookies, authorization headers, OAuth codes, magic-link tokens, raw email/document/message bodies, user prompts, model output, full request or response bodies, file contents, or unreviewed tool inputs/results.
- Events record safe summaries such as byte counts, attachment counts, Integration Type, tool name, operation, write/read classification, normalized error code, phase timing, and route or procedure identifiers.
- Raw product content debugging should use authorized product records referenced by telemetry identifiers, not duplicated telemetry content.
- Alerts and SLOs are driven primarily by low-cardinality metrics.
- Terminal Generation emission updates bounded metrics for terminal counts, durations, and tool-call counts.
- Canonical Service Events are a supported agent-query interface.
- The first rollout is accepted only when Victoria queries prove cross-signal correlation by Generation id and trace id.
- **Major modules to build or modify**:
  - Canonical event builder and schema normalizer.
  - Safe telemetry field classifier and denylist enforcement.
  - Request/operation instrumentation wrapper for RPC and later webhook/worker operations.
  - Terminal Generation event projector from durable lifecycle state.
  - Client observation API contract and authenticated intake endpoint.
  - Browser-side Client Observation reporter for chat stream observations.
  - Low-cardinality Generation metrics emitter.
  - Query examples and validation scripts or documented commands.

## Testing Decisions

- Tests should verify external behavior: emitted event shape, safety filtering, access enforcement, metric labels, and queryable correlation. They should not duplicate builder internals.
- The canonical event builder and schema normalizer should have focused unit tests because they are deep modules with stable public behavior.
- The denylist and safe summary classifier should have unit tests covering credentials, auth tokens, prompts, model output, tool payloads, request bodies, file contents, and safe summary fields.
- The terminal Generation event projector should have tests that build an event from durable lifecycle state and confirm it does not require process-local runtime state.
- The client observation contract should have validation tests for allowed event types, required fields, rejected arbitrary logs, and size limits.
- The client observation endpoint should have route tests for authentication, resource access checks, rate-limit behavior where practical, non-blocking success responses, and rejection of inaccessible Generation or conversation identifiers.
- Request-level instrumentation should have tests proving start/subscribe operations emit request events distinct from terminal Generation outcome.
- Metrics tests should verify bounded labels and ensure high-cardinality identifiers are not emitted as metric labels.
- Integration or acceptance validation should run a local or staging Generation and query telemetry by Generation id and trace id.
- Prior art exists in the current observability tests for endpoint resolution, server route tests for authenticated API behavior, and Generation router tests that already mock structured server event emission.
- After implementation, run the repo’s type/lint check and targeted tests for the touched modules. For large rollout slices, also run the broader test command.

## Out of Scope

- Building a durable Audit Trail.
- Storing raw Client Observations in Postgres.
- Replacing PostHog product analytics or session replay.
- Instrumenting every route and worker in the first implementation slice.
- Logging raw prompts, model output, emails, documents, request bodies, response bodies, credentials, or tool payloads.
- Changing lint rules or lint configuration.
- Building a new observability backend outside the existing Vector, VictoriaLogs, VictoriaMetrics, VictoriaTraces, and Grafana stack.
- Creating unauthenticated client telemetry beyond a possible future narrow pre-login error path.

## Further Notes

- This PRD follows the glossary terms **Canonical Service Event**, **Client Observation**, **Generation**, **Telemetry Version**, **Audit Record**, and **Audit Trail**.
- The architectural decision to emit both logs and spans from one builder is recorded in ADR 0003.
- The implementation should proceed in four rollout slices: foundation, Generation path, worker/sandbox path, and general web surface.
- The first implementation slice should prove value before converting noisy ad hoc logs across the codebase.
- The Linear issue should use the `ready-for-agent` triage role/status because the implementation direction and acceptance criteria are specified.
