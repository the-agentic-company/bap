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

Staging endpoints:

- Grafana: `https://ops.staging.cmdclaw.ai`
- Metrics: `https://victoria-metrics.ops.staging.cmdclaw.ai`
- Logs: `https://victoria-logs.ops.staging.cmdclaw.ai`
- Traces: `https://victoria-traces.ops.staging.cmdclaw.ai`

Production endpoints:

- Grafana: `https://ops.prod.cmdclaw.ai`
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
