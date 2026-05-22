# Canonical Service Events Are Logs And Spans

CmdClaw records each service-owned operation with one in-memory Canonical Service Event builder that enriches the active trace span and emits one final structured log event. Logs remain the query surface for high-dimensional records in VictoriaLogs, while spans remain the causal timing surface in VictoriaTraces; building both from the same event prevents drift between log context and trace attributes.

**Considered Options**

- Emit only logs: simpler to query, but loses the cross-service timing and parent-child relationships that traces already provide.
- Emit only spans: keeps causal flow, but makes high-dimensional operational querying harder and overloads traces as the only debugging surface.
- Build logs and spans separately: preserves both backends, but makes field drift likely.

**Consequences**

Canonical event fields should be added through the shared builder, not scattered across unrelated `console.*`, `logServerEvent`, and span calls. Process-level logs can still exist for failures outside a service-owned operation, but they are not the authoritative operation record.
