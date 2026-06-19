# Do Not Retain Diagnostic Sandboxes For Runtime Failures

Bap does not retain Daytona sandboxes for multi-day diagnostic archive after runtime failures.
Generation failures should preserve durable product state, terminal telemetry, traces, logs, and
bounded runtime diagnostic metadata, while sandbox compute is released promptly.

Daytona sandboxes created for OpenCode runtime work use provider lifecycle controls aligned with
the Generation run deadline: auto-stop follows the run deadline, and auto-delete follows shortly
after stop. Bap cleanup jobs also stop stale active Daytona runtimes and clear dead runtime
bindings when a sandbox no longer has an active running Generation.

If filesystem-level evidence is needed for a future incident class, Bap should capture a bounded
Runtime Diagnostic Snapshot or explicit artifact before cleanup. It should not preserve the entire
sandbox for days by default.

**Consequences**

- Runtime failures no longer depend on three-day sandbox retention for debugging.
- Daytona quota and cost pressure are reduced because stopped sandboxes are deleted shortly after
  the Generation timeout window.
- Operators debug runtime failures from Canonical Service Events, Operational Logs, traces,
  terminal Generation state, and bounded diagnostic snapshots instead of reconnecting to old
  sandboxes.

**Considered Options**

- Retain failed sandboxes for three days: useful for filesystem forensics, but it keeps user and
  provider filesystem state around too long and can exhaust Daytona quota when cleanup misses a
  runtime binding.
- Delete all failed sandboxes immediately: minimizes quota pressure, but can discard useful
  bounded diagnostic evidence before it is captured.
- Use short provider lifecycle cleanup plus durable telemetry and bounded diagnostic artifacts:
  keeps operational evidence while avoiding long-lived sandbox retention.
