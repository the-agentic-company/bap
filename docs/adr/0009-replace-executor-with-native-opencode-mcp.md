# Replace Executor with native OpenCode MCP

Bap will remove its Executor-based integration foundation and use OpenCode's native MCP server support as the agent runtime integration boundary. This is a Big Bang refactor: Executor-specific product language, schema, runtime daemon setup, OpenAPI source support, and `executor_execute` behavior will be removed rather than kept behind compatibility shims. Bap will still own workspace MCP authorization and access control, then pass explicit workspace MCP server configuration into OpenCode at runtime.

**Consequences**

Workspace integration runtime configuration is modeled only as MCP. Managed integrations and custom MCP endpoints share the same **Workspace MCP Server** model, and future non-MCP integrations must be wrapped as first-party MCP servers before they are exposed to agent runtimes.

Bap configures per-generation MCP access through OpenCode's runtime MCP API before the first prompt, then uses OpenCode's MCP status API to verify which servers connected. The runtime reconciles the allowlist dynamically: stale connected servers are disconnected and every allowlisted server is upserted and connected via `mcp.add`, with a bounded per-server wait so one unreachable server cannot stall generation start. Dynamic MCP state is process-local: if OpenCode restarts mid-conversation it comes back with no MCP servers until the next generation's reconcile re-adds them, which the per-generation reconciliation requirement below already guarantees.

> **Amended 2026-06-10.** This consequence originally required writing the allowlist into the sandbox-local OpenCode config and restarting OpenCode on config changes, "because dynamic MCP add/connect calls do not make new tools reliably visible to the prompt loop." That premise no longer holds: OpenCode ≥ 1.16 exposes a first-class `mcp.add` that upserts config and connects, and tools added dynamically were verified visible and callable by the prompt loop of an existing session on 1.16.2 and 1.17.x (including the pinned sandbox version). The restart approach cost 3–5s per generation and discarded the sandbox boot warmup, so the runtime now reconciles dynamically.

Existing custom Executor and OpenAPI source records are deleted by the migration. Managed Modulr and Galien access is recreated as **Workspace MCP Servers**; custom non-MCP sources require new first-party MCP wrappers before they can return.

Bap will not replace Executor with another generic tool discovery catalog in this refactor. Models see only the allowlisted MCP tools that OpenCode exposes for the generation; any future discovery helper must be an explicit Bap MCP server rather than a hidden runtime abstraction.

If an allowlisted **Workspace MCP Server** cannot be configured or connected, Bap records a visible **Runtime Warning** and starts the **Generation** with the available servers. Missing MCP availability is surfaced to the user through product UI, not treated as a hidden operational detail.

Runtime MCP warnings are not injected into the model prompt. The model receives only the MCP tools that OpenCode successfully exposes, while the UI tells the user which requested servers were unavailable.

Runtime MCP warnings are persisted in the conversation surface as a top-of-run warning message, similar to existing visible error messages, so refreshes and history views preserve the degraded availability signal.

OpenCode MCP state is reconciled before every **Generation** against that generation's current **Workspace MCP Server Allowlist**. Reused sessions must not retain MCP servers that are no longer allowed by the user's current toolbox or coworker configuration.

The toolbox shows selectable **Workspace MCP Servers** based on Bap access policy rather than hiding them because a runtime connection may fail. Bap owns authorization; OpenCode owns the per-generation connection attempt, and Bap surfaces connection failures as visible runtime warnings.

Hosted MCP OAuth remains a separate inbound authorization concern for clients connecting to Bap-hosted MCP servers. The Executor credential path becomes outbound **Workspace MCP Authorization** for Bap configuring third-party or managed workspace MCP servers.

The first-party MCP server layout under `apps/mcp/servers/*` is independent of Executor and is not part of this refactor. The new workspace MCP model points at those existing managed server endpoints where appropriate.

Some file and URL path names that are not user-facing API contracts may temporarily retain
`executor-source` or `/sources/` while the Big Bang runtime and product semantics move to Workspace
MCP Server. They must not appear in user-facing copy, persisted runtime identifiers, database schema
names, sandbox setup, or newly introduced public API keys.
