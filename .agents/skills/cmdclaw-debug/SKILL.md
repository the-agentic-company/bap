---
name: cmdclaw-debug
description: Debug CmdClaw end-to-end across coworker/chat workflows, MCP state, Daytona sandboxes, observability, and UI QA. Use when debugging CmdClaw, a CmdClaw coworker or chat flow, sandbox behavior, Daytona build issues, production-like regressions, or any issue where local fixes are not enough and the full loop must work.
---

# CmdClaw Debug

Debug CmdClaw as a full user workflow. The goal is not a plausible local patch; the goal is an end-to-end loop that works from CmdClaw entry point through sandbox execution, observability, and UI verification.

## Quick Start

1. Reproduce through the real CmdClaw path first.
2. For CLI live regressions, treat `bun test:e2e:cli:live` as the holy grail: run it first, capture every failing test, and expect it to be very long.
3. For OpenCode stream or latency issues, establish a native local OpenCode baseline and compare it with the Daytona path.
4. Use CmdClaw MCP, `sandbox:daytona`, observability, and the `qa` skill as needed for the real workflow.
5. If you modify sandbox behavior or files that affect the sandbox image, recreate it with `daytona:build:dev`.
6. Re-run the full loop yourself before declaring the issue fixed.

## Debug Loop

### 1. Start From CmdClaw MCP

- Start or inspect the relevant coworker or chat through CmdClaw MCP.
- Capture the user-visible failure: prompt, workflow, status, error, trace ID, sandbox ID, coworker ID, or chat ID.
- Keep the reproduction tied to the real workflow, not only a local unit or service call.

### 2. Inspect Daytona Sandbox State

Use `sandbox:daytona` when the failure involves execution, files, environment, tools, networking, or generated artifacts.

Check current sandbox files, generated output, command history, failing command output, environment variables, tool availability, stale sandbox images, and whether the issue only appears in sandbox.

When useful, a generation conversation ID can be used to attach to the exact sandbox that produced it and inspect the state directly:

```sh
bun run --cwd apps/sandbox daytona:sandbox -- --conversation-id <conversation-id>
```

The same helper also supports `--sandbox-id`, `--run-id`, or `--builder-coworker-id` when those identifiers are the available handle. This is attach mode: it reconnects to the existing Daytona sandbox instead of creating a fresh one.

If you modify sandbox setup, base image behavior, installed tools, or anything the sandbox needs at creation time, rebuild with `daytona:build:dev`. Then recreate or restart the affected sandbox and re-run the original workflow.

### 3. Compare Native OpenCode Against Daytona

When debugging stream behavior, token arrival, first-response latency, `opencode_ready`, `model_stream`, or suspected Daytona overhead, run the same prompt through a local native OpenCode server as a control before blaming CmdClaw orchestration.

Use the repo's OpenCode server shape as the baseline:

```sh
OPENCODE_CONFIG=/app/opencode.json opencode serve --hostname 127.0.0.1 --port 4096
```

If `/app/opencode.json` is not appropriate on the host, use an equivalent local OpenCode config, but keep the model, prompt, working directory, MCP/tool setup, and auth source as close as possible to the Daytona reproduction. Capture time to server readiness, time to first streamed event, cadence of streamed chunks, tool-call latency, total runtime, and any stalls or reconnects.

Then attach to or recreate the Daytona sandbox and run the same prompt there. Compare the native OpenCode baseline with CmdClaw's Daytona timings, especially `opencode_ready`, `prompt dispatch -> first runtime progress`, `model_stream`, tool execution, stream reconnects, and final completion persistence. If native OpenCode is also slow, treat the issue as provider/OpenCode/model behavior; if native OpenCode is fast but Daytona is slow, focus on sandbox startup, networking, file sync, MCP reconciliation, event bridging, queueing, and CmdClaw stream delivery.

### 4. Use Observability

Use the `observability` skill for logs, traces, metrics, Grafana, Victoria, and alerts. Do this when the UI or sandbox symptom is downstream of backend behavior.

Look for request path and status, MCP/worker/sandbox/app-server spans, error logs with coworker/chat/sandbox identifiers, latency spikes, retries, queue stalls, dropped events, and differences between local, dev, and production-like behavior. Prefer correlating observations with the exact reproduction rather than browsing dashboards broadly.

### 5. Experience The Full Loop

Run the flow yourself as a user would: start the coworker or chat from the real entry point, wait for sandbox work, inspect generated files or output, return to the UI, and verify status, streaming, logs, artifacts, and final result. Repeat after every meaningful fix.

### 6. Work Through CLI Live E2E Failures

When the bug is in, or could affect, the CLI live path, start with:

```sh
bun test:e2e:cli:live
```

This is the highest-signal test for live CLI behavior and can take a long time. Do not skip the initial full run just because it is slow; use it to discover the complete failing set before choosing where to focus.

After the first full run:

- Fix one failing test at a time, starting with the first easy failure.
- Re-run that test individually until it is green, then move to the next failure.
- When all previously failing tests pass individually, run `bun test:e2e:cli:live` again to prove the full pipeline works.

### 7. QA The UI

Use the `qa` skill for user-facing verification.

Check initial state, loading behavior, chat or coworker creation, streaming/status updates, error display and recovery, artifact links, sandbox output, final state, console errors, failed network requests, and desktop/mobile behavior when UI-facing.

## Fix Discipline

- Keep a concrete reproduction loop before editing.
- Patch the narrowest source responsible for the failure.
- If the sandbox image or setup changes, rebuild with `daytona:build:dev` before validation.
- Remove temporary debug logs and throwaway harnesses.
- Add regression coverage at the closest real seam when possible.
- Finish by proving the original end-to-end CmdClaw loop works.

## Done Criteria

- [ ] The original coworker or chat workflow succeeds end-to-end.
- [ ] For CLI live regressions, `bun test:e2e:cli:live` was run first, failures were recorded, each failure passed individually, and the full pipeline now passes.
- [ ] The relevant Daytona sandbox state has been inspected when needed; if a generation conversation ID is available, `bun run --cwd apps/sandbox daytona:sandbox -- --conversation-id <conversation-id>` can attach to that sandbox.
- [ ] For OpenCode stream or latency issues, a native local OpenCode server baseline was captured and compared with the Daytona reproduction.
- [ ] Sandbox changes, if any, were rebuilt with `daytona:build:dev`.
- [ ] Logs, traces, or metrics were checked when backend behavior was involved.
- [ ] UI behavior was verified with the `qa` skill when user-facing.
- [ ] Any regression test or durable reproduction harness has passed.
- [ ] Temporary instrumentation has been removed.
