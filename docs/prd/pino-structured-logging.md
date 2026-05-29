# PRD: Pino Structured Logging

## Problem Statement

CmdClaw currently loses important error details in telemetry because service logs are reconstructed from patched `console.*` calls and forwarded to Vector with custom JSON serialization. Native `Error` objects often become `{}` in the telemetry log payload even when Render shows the full error message and stack in platform logs.

The current logging path also blurs distinct observability concepts. **Canonical Service Events** are authoritative service-owned operation records, **Client Observations** are browser-originated evidence, and **Operational Logs** are process-level diagnostics. A generic middle layer makes it too easy to treat all of them as the same kind of telemetry.

The user wants the final form, not a compatibility band-aid: Pino should own structured JSON logging mechanics, CmdClaw should own safety and observability semantics, and service runtimes should not intercept `console.*`.

## Solution

CmdClaw will replace the service logging path with a Pino-backed structured logger that emits JSON lines to stdout or stderr. Render and Vector will ingest process output into VictoriaLogs. Application code will not send log records to Vector with per-log HTTP requests.

The implementation will preserve the existing semantic APIs for **Canonical Service Events**, **Client Observations**, metrics, and traces. **Operational Logs** will use a separate logger API and will not be treated as authoritative operation records. Existing generic service log calls will become **Operational Logs** by default unless an authoritative canonical contract already exists in documentation or tests.

The final implementation will remove console interception from service runtimes, retire `logServerEvent` as a public/general API, and route all log-shaped records through one stdout JSON transport.

## User Stories

1. As an operator, I want Render and VictoriaLogs to show the same structured error details, so that I do not need to cross-check two systems to understand a failure.
2. As an operator, I want `Error` instances to include message, name, stack, code, cause, and upstream status when available, so that errors do not appear as `{}`.
3. As an operator, I want bounded stack traces in server-side Error Diagnostics, so that I can debug production failures without losing the line of failure.
4. As an operator, I want Operational Logs to be JSON lines on stdout or stderr, so that Render and Vector can ingest logs without application-side log export calls.
5. As an operator, I want Operational Logs to include `event.kind="operational_log"`, so that I can distinguish diagnostics from authoritative service records.
6. As an operator, I want Operational Logs to use a dotted snake case `event` field, so that diagnostic events can be queried consistently.
7. As an operator, I want `cmdclaw.event.name` reserved for Canonical Service Events and Client Observations, so that query results do not mix semantic records with process diagnostics.
8. As an operator, I want runtime fields such as service name, environment, deployment id, commit sha, and Telemetry Version on every emitted record, so that incidents can be tied to a deployed process.
9. As an operator, I want trace id and span id attached automatically when active, so that logs and traces remain correlated.
10. As an operator, I want Generation, conversation, User, workspace, sandbox, route, and RPC procedure identifiers on relevant records, so that high-cardinality debugging remains possible in logs.
11. As an operator, I want metrics and traces to continue using OpenTelemetry exporters, so that alerting and causal timing do not depend on log parsing.
12. As an operator, I want accepted Client Observations to keep their allowlisted event contract, so that browser-originated evidence remains safe and queryable.
13. As an operator, I want Canonical Service Events to keep their common envelope and span enrichment, so that existing Generation observability remains coherent.
14. As an engineer, I want a shared logger facade instead of direct Pino imports across the codebase, so that safety, naming, and future transport changes stay localized.
15. As an engineer, I want Pino to handle JSON formatting, levels, timestamps, and standard error serialization, so that CmdClaw does not reimplement logging mechanics.
16. As an engineer, I want CmdClaw-owned normalization before emission, so that forbidden fields are removed and values are bounded.
17. As an engineer, I want all log fields to follow the existing observability safety boundary, so that credentials, cookies, tokens, prompts, model output, request bodies, tool payloads, file contents, document bodies, and email bodies are not emitted.
18. As an engineer, I want product pivots supplied explicitly or through child loggers, so that log context remains visible and intentional.
19. As an engineer, I want runtime and trace context added automatically, so that repeated boilerplate does not hide application logic.
20. As an engineer, I want child loggers with bound context, so that Generation and worker modules can attach stable fields once.
21. As an engineer, I want `logServerEvent` removed rather than wrapped, so that new code must choose between Operational Logs and semantic observability APIs.
22. As an engineer, I want former generic log calls converted to Operational Logs by default, so that noisy breadcrumbs are not accidentally promoted into Canonical Service Events.
23. As an engineer, I want former generic log calls promoted only when an authoritative operation contract already exists, so that the canonical event vocabulary stays deliberate.
24. As an engineer, I want service runtimes not to intercept `console.*`, so that logging behavior is explicit and testable.
25. As an engineer, I want human-facing scripts allowed to keep `console.*` for terminal output, so that CLI presentation remains separate from Operational Logs.
26. As an engineer, I want browser `console.*` usage kept separate from server Operational Logs, so that browser-visible failures continue through Client Observations.
27. As an engineer, I want startup failures to be loggable before full OpenTelemetry initialization, so that process boot failures are not silent.
28. As an engineer, I want short-lived process flushing where diagnostics are emitted through the logger, so that final fatal errors are not lost.
29. As an engineer, I want test-mode logging to be capturable without noisy test output, so that logger behavior can be asserted directly.
30. As a reliability engineer, I want high-cardinality identifiers to stay in logs and not metric labels, so that metrics remain bounded.
31. As a reliability engineer, I want failed Canonical Service Events to include safe normalized error fields, so that failure grouping remains stable.
32. As a support engineer, I want safe User and workspace identifiers on relevant logs, so that support can investigate incidents without raw customer content.
33. As a future agent, I want stable field names for Operational Logs, Canonical Service Events, and Client Observations, so that I can query VictoriaLogs directly.
34. As a future agent, I want the final architecture documented, so that I do not reintroduce console patching or app-side log fetches.
35. As a developer, I want no lint-rule changes in this work, so that logging cleanup does not bypass repository policy.
36. As a developer, I want no product API or database schema changes, so that the rewrite is limited to observability behavior.
37. As a developer, I want existing Generation validation queries to keep working, so that observability acceptance remains meaningful.
38. As a developer, I want old local-only output left alone when it is not a service Operational Log, so that the Big Bang stays focused on deployed runtime behavior.
39. As a developer, I want tests around external log shape rather than implementation internals, so that the logger can evolve without brittle snapshots.
40. As a developer, I want documentation to explain when to use the logger versus semantic observability APIs, so that new code uses the right boundary.

## Implementation Decisions

- Use Pino as the logging engine for service-side **Operational Logs**.
- Emit all log-shaped records as structured JSON lines to stdout or stderr.
- Render and Vector own ingestion of process output into VictoriaLogs.
- Remove application-side per-log HTTP export to Vector for log records.
- Keep OpenTelemetry exporters for metrics and traces.
- Keep **Canonical Service Event** and **Client Observation** APIs semantic, but make their final log-shaped output use the same stdout JSON transport.
- Retire the generic service logging helper instead of wrapping it over Pino.
- Convert existing generic service log calls to **Operational Logs** by default.
- Promote a former generic log call to a **Canonical Service Event** only when an authoritative operation contract already exists in documentation or tests.
- Remove service runtime `console.*` interception.
- Leave human-facing script and CLI presentation output separate from **Operational Logs**.
- Do not treat browser `console.*` as server telemetry; browser-originated evidence remains **Client Observations**.
- Use `event.kind="operational_log"` for Operational Logs.
- Use a dotted snake case `event` field for Operational Log event names.
- Reserve `cmdclaw.event.name` for Canonical Service Events and Client Observations.
- Add runtime fields and active trace/span identifiers automatically.
- Require product pivots such as Generation, conversation, User, workspace, and sandbox identifiers to be supplied explicitly at the call site or through scoped child loggers.
- Provide a shared logger facade; application code should not import Pino directly.
- The logger facade is a deep module with a small public surface: emit levelled Operational Logs, create child loggers with bound context, serialize Error Diagnostics, normalize fields, and flush where needed.
- Pino owns JSON output, levels, timestamps, and standard error serialization.
- CmdClaw owns field naming, forbidden-field removal, value bounding, correlation fields, and Error Diagnostic normalization.
- Server-side Error Diagnostics may include bounded stack traces by default.
- Normalized error fields should include safe values such as error name, message, stack, normalized code, category, provider, upstream status, and cause summary when available.
- Redaction and normalization must enforce the observability forbidden-content list.
- No database schema changes are expected.
- No product API contract changes are expected.
- No lint rule or lint configuration changes are allowed without explicit user approval.
- Documentation should continue to distinguish **Operational Logs**, **Canonical Service Events**, **Client Observations**, metrics, traces, **Error Diagnostics**, and future Audit Records.

## Testing Decisions

- Tests should verify externally observable log behavior: emitted JSON shape, level mapping, error serialization, field normalization, redaction, context propagation, and transport boundaries.
- Tests should not duplicate Pino internals or assert incidental property order.
- The logger facade should have focused unit tests because it is the deep module that carries most behavior.
- Error Diagnostic tests should cover native `Error` instances, errors with causes, errors with codes, errors with upstream status, and non-Error thrown values.
- Regression tests must prove native `Error` values do not serialize as `{}`.
- Redaction tests should cover authorization headers, cookies, tokens, credentials, OAuth codes, prompts, model output, request bodies, response bodies, document content, email content, file content, tool inputs, and tool results.
- Normalization tests should prove string length, stack length, array size, and nested object bounds are enforced.
- Context tests should prove runtime fields and active trace/span identifiers are added automatically.
- Context tests should prove explicit product pivots and child logger bindings are preserved.
- Operational Log tests should prove `event.kind="operational_log"` and dotted snake case `event` are emitted, without `cmdclaw.event.name`.
- Canonical Service Event tests should prove the canonical envelope still includes `cmdclaw.event.name`, stable event id, outcome, operation fields, trace correlation, and span enrichment.
- Client Observation tests should prove accepted observations keep their allowlisted contract and are emitted through the shared stdout log transport.
- Transport tests should prove no app-side log `fetch` to Vector remains.
- Runtime initialization tests should prove OpenTelemetry metrics/traces still initialize without console patching.
- Existing observability tests around telemetry normalization and Canonical Service Events are prior art.
- Existing client observation intake tests are prior art for allowlisted browser telemetry.
- Existing Generation observability validation remains relevant after the rewrite.
- After implementation, run focused logger and observability tests first, then the core package check, then relevant web/worker checks for migrated service call sites.

## Out of Scope

- Replacing Vector, VictoriaLogs, VictoriaMetrics, VictoriaTraces, Grafana, Render, or OpenTelemetry.
- Replacing metrics or traces with logs.
- Treating every Operational Log as a Canonical Service Event.
- Expanding the Canonical Service Event vocabulary beyond contracts already documented or tested.
- Building Audit Records or an Audit Trail.
- Changing product APIs, database schemas, or user-facing behavior.
- Changing lint rules or lint configuration.
- Migrating browser developer console usage.
- Refactoring local-only scripts where `console.*` is human-facing presentation output.
- Logging raw prompts, model output, emails, documents, request bodies, response bodies, credentials, cookies, tokens, file contents, tool inputs, or tool results.
- Creating or updating Linear issues directly.

## Further Notes

- This PRD follows ADR 0008: log-shaped records use stdout JSON, while semantic APIs remain distinct.
- ADR 0003 remains binding: Canonical Service Event fields come through the shared builder and enrich spans.
- The existing patch that serialized console errors through a patched console path should be replaced, not evolved.
- The implementation should be a service logging Big Bang, not a compatibility layer that leaves deprecated service console interception behind.
- The outcome should make Render logs, VictoriaLogs records, and agent queries converge on the same structured error diagnostics.
