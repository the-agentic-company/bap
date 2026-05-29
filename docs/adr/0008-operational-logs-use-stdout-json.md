# Operational Logs Use Stdout JSON

CmdClaw emits log-shaped records as structured JSON lines to stdout or stderr, with Render and Vector responsible for ingesting process output into the logs backend. Operational Logs, Canonical Service Events, and accepted Client Observations share this transport, while each keeps its own semantic API and envelope. Application code does not send logs to Vector with per-log HTTP requests; direct telemetry exports are reserved for metrics and traces.

**Consequences**

Operational logging should use a shared structured logger instead of ad hoc `console.*` calls. Application code should use that logger for process diagnostics and the semantic observability APIs for Canonical Service Events, Client Observations, metrics, and spans; generic helpers that sit between those concepts should be retired rather than wrapped. Pino can own JSON formatting, levels, and standard error serialization, but emitted fields still pass through CmdClaw-owned naming, bounding, and forbidden-content normalization. Service runtimes should not intercept `console.*`; human-facing scripts may keep `console.*` for terminal output, but those lines are not Operational Logs.

Existing `logServerEvent` call sites should become Operational Logs by default. A former generic log call should be promoted to a Canonical Service Event only when the authoritative operation contract already exists in documentation or tests.

Operational Logs use `event.kind="operational_log"` and a dotted snake case `event` field. `cmdclaw.event.name` remains reserved for Canonical Service Events and Client Observations.

Runtime fields and active trace/span identifiers may be added automatically by the logging runtime. Product pivots such as Generation, conversation, User, workspace, and sandbox identifiers should be supplied explicitly at the call site or through a scoped child logger.
