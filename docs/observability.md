# Observability

CmdClaw’s local observability stack is built for direct machine querying.

## Stack

- The app sends JSON logs and OTLP metrics/traces to `Vector`.
- `Vector` fans out locally to:
  - `VictoriaLogs` for logs
  - `VictoriaMetrics` for metrics
  - `VictoriaTraces` for traces
- `Grafana` is the UI.
- `vmalert` evaluates checked-in alert rules.
- `Alertmanager` sends notifications, for example to Slack.

## Canonical Service Events

CmdClaw treats one context-rich `canonical_service_event` as the authoritative
observability record for each service-owned operation, such as an RPC request,
webhook, worker job, or Generation lifecycle step. The event is built once,
enriches the active trace span, and is emitted as one structured JSON log so
VictoriaLogs remains the high-dimensional query surface while VictoriaTraces
keeps causal timing.

Browser-originated telemetry is a `client_observation`, not a Canonical Service
Event. Client observations are accepted only through an allowlisted event
contract, forwarded through the observability pipeline, and are not stored in
Postgres by default.
PostHog remains the product analytics surface for funnels, adoption, pageviews,
broad UX trends, and session replay. Session replay can support debugging when
visual context matters, but first-party client observations remain the
authoritative operational signal for browser-visible errors, generation stream
behavior, and correlation with server traces and Canonical Service Events.

Server Canonical Service Events are retained at full fidelity by default.
Client observations are rate-limited and selectively retained: failures,
visible errors, and generation stream errors are kept at full fidelity, while
low-value successful client events such as page views or normal stream
open/close observations may be sampled.

Canonical logs may include high-cardinality identifiers such as user,
workspace, conversation, Generation, trace, and sandbox identifiers because
logs are the high-dimensional debugging surface. Metrics must not use
high-cardinality labels such as user identifiers, Generation identifiers, raw
URLs, file names, or raw error messages. Trace spans may include important
lookup identifiers, but large payloads, unbounded arrays, and user content stay
out of span attributes.

Canonical Service Events and client observations must not contain credentials,
session cookies, authorization headers, OAuth codes, magic-link tokens, raw
email/document/message bodies, user prompts, model output, full request or
response bodies, file contents, or unreviewed tool inputs/results. They should
record safe summaries instead, such as byte counts, attachment counts,
Integration Type, tool name, operation, write/read classification, normalized
error code, phase timing, and route or procedure identifiers. If raw content is
needed during debugging, observability should identify the authorized product
record to inspect rather than duplicating that content into telemetry.

Telemetry attribute names use OpenTelemetry-style dotted snake_case. Prefer
official semantic convention names such as `service.name`,
`deployment.environment`, `http.route`, and `rpc.method` when they fit. Use the
`cmdclaw.*` namespace for product-specific attributes such as
`cmdclaw.event.kind`, `cmdclaw.operation.type`, `cmdclaw.generation.id`,
`cmdclaw.conversation.id`, `cmdclaw.duration_ms`, and
`cmdclaw.outcome`. TypeScript code may use camelCase internally, but emitted
telemetry is normalized to the canonical attribute names. JSON logs may retain
backend-friendly correlation aliases such as `trace_id` and `span_id`.

Generation outcome is defined by the terminal product lifecycle, not by the
request that created or observed it. A Generation is successful when it reaches
terminal `completed`; terminal errors, cancellations, and timeouts are separate
outcomes. Request-level Canonical Service Events keep their own outcome, so a
successful `generation.startGeneration` RPC can still create a Generation that
fails later.

A Generation emits one terminal Canonical Service Event. Phase timings,
approval/auth waits, tool-use summaries, retry/recovery details, token usage,
and terminal error classification belong on that event. Phase structure belongs
in trace spans and in timing fields on the terminal event, not in separate
phase-level canonical events, unless a phase is itself an independent
service-owned operation such as a worker job.

The terminal Generation Canonical Service Event is emitted by the server-side
lifecycle owner that persists terminal completion, failure, cancellation, or
timeout. Request handlers emit request-level Canonical Service Events, and
browser streams emit client observations; neither owns the terminal Generation
record. This prevents duplicate terminal events when multiple clients subscribe,
streams reconnect, or recovery paths resume a Generation.

Every Canonical Service Event has a stable `cmdclaw.event.id` for deduplication.
Request and worker operation events may use a per-operation identifier. The
terminal Generation event uses a deterministic identity derived from the
Generation, such as `generation:{generationId}:terminal`, so recovery paths and
retries cannot accidentally create distinct authoritative terminal records.
Client observations carry a browser-generated client event identifier that the
server forwards for short-window duplicate detection and query correlation.
The first-party client observation endpoint requires the normal authenticated
web session for user-linked telemetry. The server derives user and workspace
identifiers from the session, verifies access to any supplied Generation or
conversation identifiers, rate-limits by user, session, and IP, and returns a
non-blocking success response so observability failures do not break the UI.

The terminal Generation event must include the core event envelope, runtime
configuration, lifecycle timing, tool and interruption summaries, usage and
error classification, and deployment identity. Required attributes include
`cmdclaw.generation.id`, `cmdclaw.conversation.id`, `cmdclaw.user.id`,
`cmdclaw.workspace.id`, `cmdclaw.model.provider`, `cmdclaw.model.name`,
`cmdclaw.sandbox.provider`, `cmdclaw.auth.source`,
`cmdclaw.auto_approve.enabled`, `cmdclaw.skills.selected_count`,
`cmdclaw.attachments.count`, phase timing fields under `cmdclaw.phase.*`,
tool and interruption counters under `cmdclaw.tool.*`, `cmdclaw.approval.*`,
and `cmdclaw.auth_interrupt.*`, usage fields under `cmdclaw.usage.*`, and
safe error fields under `cmdclaw.error.*` and `cmdclaw.failure.phase`.

Terminal Generation events are reconstructed from durable lifecycle state at
terminal emission time. In-memory builders may enrich request and worker
operation events, but the authoritative Generation event must not depend on
process-local state that can be lost during stream reconnects, worker recovery,
or stateless runtime replacement.

Alerts and SLOs are driven primarily by low-cardinality metrics, not directly by
wide logs. Canonical Service Events provide the rich debugging record and can be
used to derive or validate metrics. Terminal Generation emission should update
metrics such as terminal counts, duration distributions, and tool-call counts
using bounded labels like outcome, model provider, sandbox provider,
Integration Type, operation, and read/write classification. High-cardinality
identifiers and raw error messages stay out of metric labels.

Canonical Service Events are a supported agent-query interface. Attribute names,
outcome values, and core field meanings should remain stable enough for agents
to query VictoriaLogs and VictoriaTraces directly by Generation id, trace id,
operation type, model, sandbox provider, outcome, failure phase, and normalized
error code. Fields should be normalized rather than embedded in human prose.

The first rollout slice is complete only when telemetry queries prove the
system works. A local or staging Generation should be queryable by
`cmdclaw.generation.id` and show the start RPC Canonical Service Event,
subscribe RPC Canonical Service Event, terminal Generation Canonical Service
Event, and related client observations. The same run should be queryable by
`trace_id` to inspect server span/log correlation. Failure queries should group
Generations by model provider, sandbox provider, failure phase, and normalized
error code. Validation must also confirm that forbidden content is absent,
terminal Generation metrics are updated, the client observation endpoint
enforces authentication and resource access, and raw client observations are
not stored in Postgres.

### Generation Rollout Acceptance Queries

Set the Generation id from a local or staging run:

```bash
GENERATION_ID=gen_...
```

Run the executable validator to prove the Generation id, trace id, terminal
metrics, and trace payload all correlate across the local Victoria backends:

```bash
bun run observability:validate-generation -- --generation-id "${GENERATION_ID}"
```

For browser journeys that should emit client observations, add
`--require-client-observation`. CLI runs do not emit browser
`client_observation` rows, so the validator reports their count but does not
require one by default.

Query the wide logs by Generation id. The result should include
`cmdclaw.generation.start_rpc`, `cmdclaw.generation.subscribe_rpc`,
`cmdclaw.generation.terminal`, and `event.kind="client_observation"` rows.

```bash
curl -G 'http://127.0.0.1:9428/select/logsql/query' \
  --data-urlencode "query=cmdclaw.generation.id:${GENERATION_ID}" \
  --data-urlencode 'limit=200'
```

Extract the run trace id from any returned row that has `trace_id`, then query
the same run by trace id:

```bash
TRACE_ID=...
curl -G 'http://127.0.0.1:9428/select/logsql/query' \
  --data-urlencode "query=trace_id:${TRACE_ID}" \
  --data-urlencode 'limit=200'
```

Check trace availability through VictoriaTraces:

```bash
curl "http://127.0.0.1:10428/select/jaeger/api/traces/${TRACE_ID}"
```

Group terminal failures by bounded dimensions:

```bash
curl -G 'http://127.0.0.1:9428/select/logsql/query' \
  --data-urlencode 'query=cmdclaw.event.name:cmdclaw.generation.terminal cmdclaw.generation.outcome:(failed OR timed_out)' \
  --data-urlencode 'limit=1000'
```

When inspecting the returned rows, group by
`cmdclaw.model.provider`, `cmdclaw.sandbox.provider`,
`cmdclaw.failure.phase`, and `cmdclaw.error.normalized_code`.

Check low-cardinality metrics. None of these metrics should include user,
workspace, conversation, Generation, trace, sandbox id, route URL, file name, or
raw error message labels.

```bash
curl -G 'http://127.0.0.1:8428/api/v1/query' \
  --data-urlencode 'query=sum by (outcome, model_provider, sandbox_provider, failure_phase, normalized_error_code) (cmdclaw_generation_terminal_total)'
```

Confirm forbidden content is absent from the canonical rows by checking that
fields such as `content`, `prompt`, `model_output`, `request_body`,
`response_body`, `authorization`, `cookie`, `token`, `tool_input`,
`tool_result`, and `file_content` are not present in emitted telemetry.

## Why This Matters For Agents

Agents such as Codex or Claude Code do not need a special SDK here. They can query the local backends directly over HTTP, correlate signals, and reason from the results.

Typical flow:

1. Query metrics from `VictoriaMetrics` with PromQL.
2. Query logs from `VictoriaLogs` with LogsQL.
3. Query traces from `VictoriaTraces` through its Jaeger-compatible API.
4. Correlate by service, route, job name, trace id, and timing.

## Main Endpoints

These host ports are configurable via `CMDCLAW_*_PORT` env vars in local worktrees.

- Metrics: `http://127.0.0.1:8428`
- Logs: `http://127.0.0.1:9428`
- Traces: `http://127.0.0.1:10428`
- Grafana: `http://127.0.0.1:3400`
- Alert rules: `http://127.0.0.1:8428/api/v1/rules`

## SLO Backfill

The local stack includes CmdClaw SLO rules generated from Pyrra YAML and shown
through Grafana. Pyrra is used only as rule/dashboard tooling; there is no
separate Pyrra UI in the local or hosted stack.

Backfill the last 30 days of production conversation reliability into local
VictoriaMetrics:

```bash
bun run --cwd apps/web slo:backfill:prod
```

The backfill reads `DATABASE_URL_PROD` with SELECT-only queries and imports
hourly cumulative samples for `cmdclaw_slo_events_total` into VictoriaMetrics.
The SLO dashboard is available in Grafana as `CmdClaw SLOs`.

Real backfill samples are written with `traffic="real"`. Synthetic replay
samples use the same metric family with `traffic="synthetic"`, so existing SLO
queries include both by default and operators can filter by traffic provenance
when debugging.

## SLO Synthetic Replay

Synthetic replay answers whether recent failed journeys pass now without
retrying every duplicate failure. The replay command reads the last 30 days from
an explicit source environment, deduplicates the latest terminal failures, runs
local synthetic journeys with remote staging or production credentials, and
imports synthetic SLO samples into local VictoriaMetrics.

Preview candidates without creating generations or metrics:

```bash
bun run --cwd apps/web slo:replay --target-env staging --dry-run --limit 25
```

Run a small replay:

```bash
bun run --cwd apps/web slo:replay --target-env staging --limit 1
```

The command requires `--target-env staging|prod`; there is no default. Replay
targets are restricted to the v1 allowlist in `apps/web/scripts/slo-replay.ts`.
Chat, coworker builder, and unknown coworker generation retries are deduplicated
by normalized first user message. Coworker run retries are deduplicated by
coworker id only. Replays do not auto-approve write actions: a denied write tool
call may still produce a successful synthetic journey if the overall run reaches
terminal `completed`.

## Staging And Production Debugging

For staging and production incidents, use the hosted Victoria endpoints together with Render cli. The Victoria endpoints provide application metrics, logs, traces; Render provides deployment state, service status, and platform/runtime logs.

Before querying hosted observability, agents must verify that Tailscale is up
and that the relevant Grafana hostname resolves:

```bash
tailscale status
dig +short grafana.ops.staging.cmdclaw.ai
dig +short grafana.ops.prod.cmdclaw.ai
```

If Tailscale is down, or if the target Grafana hostname does not resolve, stop
the debugging workflow immediately and alert the user that Tailscale appears to
be off and must be started before hosted observability can be queried.

Staging endpoints:

- Grafana: `https://grafana.ops.staging.cmdclaw.ai`
- Metrics: `https://victoria-metrics.ops.staging.cmdclaw.ai`
- Logs: `https://victoria-logs.ops.staging.cmdclaw.ai`
- Traces: `https://victoria-traces.ops.staging.cmdclaw.ai`

Production endpoints:

- Grafana: `https://grafana.ops.prod.cmdclaw.ai`
- Metrics: `https://victoria-metrics.ops.prod.cmdclaw.ai`
- Logs: `https://victoria-logs.ops.prod.cmdclaw.ai`
- Traces: `https://victoria-traces.ops.prod.cmdclaw.ai`

Render: `render ...`

## Agent Query Examples

Metrics:

```bash
curl -s --get 'http://127.0.0.1:8428/api/v1/query' \
  --data-urlencode 'query=max(cmdclaw_runtime_up{service_name="cmdclaw-web"})'
```

Logs:

```bash
curl -s http://127.0.0.1:9428/select/logsql/query \
  -d 'query=service:cmdclaw-web OR service:cmdclaw-worker' \
  -d 'limit=20'
```

Traces:

```bash
curl -s http://127.0.0.1:10428/select/jaeger/api/services
```

Rules:

```bash
curl -s http://127.0.0.1:8428/api/v1/rules
```

## Recommended Agent Workflow

When debugging a local issue:

1. Check `cmdclaw_runtime_up` and queue metrics in `VictoriaMetrics`.
2. Check recent logs in `VictoriaLogs`.
3. If the issue crosses web and worker boundaries, inspect traces in `VictoriaTraces`.
4. Make the code change, restart the app, rerun the workload, and query again.

That is the intended loop: query, correlate, reason, change, rerun.
