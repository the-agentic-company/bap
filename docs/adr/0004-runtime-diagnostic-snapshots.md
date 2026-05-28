# Runtime Diagnostic Snapshots Are Stored As Debug Artifacts

CmdClaw stores full redacted Runtime Diagnostic Snapshots as object-storage artifacts, referenced from the Generation debug index and terminal Canonical Service Event. Runtime-boundary stalls such as `runtime_no_progress_after_prompt` and `runtime_progress_stalled` capture this artifact so operators can distinguish missing initial runtime progress from progress that later stopped. Postgres `debugInfo` stays bounded and queryable with the snapshot id, storage key, failure code, phase, and core counters, while the full artifact can contain nested runtime state, event counters, safe response shapes, and redacted log tails needed to debug runtime-boundary failures.

**Considered Options**

- Store full snapshots in Postgres: simple to query, but risks unbounded nested diagnostic data in the primary product database.
- Store full snapshots in VictoriaLogs: easy to grep, but violates the boundary between operational events and larger debug artifacts.
- Store full snapshots in object storage with Postgres/log pointers: keeps product state bounded while preserving enough detail for post-incident debugging.
