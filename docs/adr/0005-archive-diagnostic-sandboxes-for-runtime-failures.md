# Archive Diagnostic Sandboxes For Runtime Failures

CmdClaw archives Daytona sandboxes for a short, bounded period after platform-suspect runtime failures so operators can recover the filesystem state that existed when the failure happened. The first eligible failures are `runtime_no_progress_after_prompt`, `runtime_progress_stalled`, and runtime-turn `runtime_error`. The archive is evidence for debugging, not an active runtime for continuing the Generation.

Archived Diagnostic Sandboxes are retained for three days, referenced from Generation debug metadata, and then deleted automatically. If archival fails, the Generation still terminalizes normally and CmdClaw falls back to normal cleanup. Normal user-facing failures, cancellations, auth waits, approval denials, run-deadline parking, and non-Daytona sandboxes continue to use the standard cleanup path.

**Considered Options**

- Always delete sandboxes after failures: minimizes retention and cost, but makes retrospective debugging difficult once a user reports a runtime-boundary failure.
- Preserve every failed sandbox: maximizes forensic data, but retains too much user and provider filesystem state for ordinary product failures.
- Archive only high-signal runtime failure sandboxes with short TTL: keeps useful evidence for the failures that are hardest to debug while bounding cost and privacy exposure.
