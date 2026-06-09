---
name: cmdclaw-debug
description: Debug CmdClaw end-to-end across coworker/chat workflows, MCP state, Daytona sandboxes, observability, and UI QA. Use when debugging CmdClaw, a CmdClaw coworker or chat flow, sandbox behavior, Daytona build issues, production-like regressions, or any issue where local fixes are not enough and the full loop must work.
---

# CmdClaw Debug

Debug CmdClaw as a full user workflow. The goal is not a plausible local patch; the goal is an end-to-end loop that works from CmdClaw entry point through sandbox execution, observability, and UI verification.

## Quick Start

1. Reproduce through the real CmdClaw path first.
2. For CLI live regressions, treat `bun test:e2e:cli:live` as the holy grail: run it first, capture every failing test, and expect it to be very long.
3. Use CmdClaw MCP, `sandbox:daytona`, observability, and the `qa` skill as needed for the real workflow.
4. If you modify sandbox behavior or files that affect the sandbox image, recreate it with `daytona:build:dev`.
5. Re-run the full loop yourself before declaring the issue fixed.

## Debug Loop

### 1. Start From CmdClaw MCP

- Start or inspect the relevant coworker or chat through CmdClaw MCP.
- Capture the user-visible failure: prompt, workflow, status, error, trace ID, sandbox ID, coworker ID, or chat ID.
- Keep the reproduction tied to the real workflow, not only a local unit or service call.

### 2. Inspect Daytona Sandbox State

Use `sandbox:daytona` when the failure involves execution, files, environment, tools, networking, or generated artifacts.

Check current sandbox files, generated output, command history, failing command output, environment variables, tool availability, stale sandbox images, and whether the issue only appears in sandbox.

If you modify sandbox setup, base image behavior, installed tools, or anything the sandbox needs at creation time, rebuild with `daytona:build:dev`. Then recreate or restart the affected sandbox and re-run the original workflow.

### 3. Use Observability

Use the `observability` skill for logs, traces, metrics, Grafana, Victoria, and alerts. Do this when the UI or sandbox symptom is downstream of backend behavior.

Look for request path and status, MCP/worker/sandbox/app-server spans, error logs with coworker/chat/sandbox identifiers, latency spikes, retries, queue stalls, dropped events, and differences between local, dev, and production-like behavior. Prefer correlating observations with the exact reproduction rather than browsing dashboards broadly.

### 4. Experience The Full Loop

Run the flow yourself as a user would: start the coworker or chat from the real entry point, wait for sandbox work, inspect generated files or output, return to the UI, and verify status, streaming, logs, artifacts, and final result. Repeat after every meaningful fix.

### 5. Work Through CLI Live E2E Failures

When the bug is in, or could affect, the CLI live path, start with:

```sh
bun test:e2e:cli:live
```

This is the highest-signal test for live CLI behavior and can take a long time. Do not skip the initial full run just because it is slow; use it to discover the complete failing set before choosing where to focus.

After the first full run:

- Fix one failing test at a time, starting with the first easy failure.
- Re-run that test individually until it is green, then move to the next failure.
- When all previously failing tests pass individually, run `bun test:e2e:cli:live` again to prove the full pipeline works.

### 6. QA The UI

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
- [ ] The relevant Daytona sandbox state has been inspected.
- [ ] Sandbox changes, if any, were rebuilt with `daytona:build:dev`.
- [ ] Logs, traces, or metrics were checked when backend behavior was involved.
- [ ] UI behavior was verified with the `qa` skill when user-facing.
- [ ] Any regression test or durable reproduction harness has passed.
- [ ] Temporary instrumentation has been removed.
