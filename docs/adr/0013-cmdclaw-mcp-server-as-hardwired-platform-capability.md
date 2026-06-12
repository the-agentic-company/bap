---
status: proposed
---

# Expose the Bap MCP Server as a hard-wired platform capability

Every **Generation** — chat, coworker, or coworker run — gets the **Bap MCP
Server** (`apps/mcp/servers/cmdclaw`) unconditionally. Its tools (run chats; list,
create, and run coworkers; upload documents; add skills) let the agent operate
Bap itself: a chat can build and trigger coworkers, a coworker can orchestrate
other coworkers.

This is the first **Platform MCP Server** (see `CONTEXT.md`): it is *not* a
**Workspace MCP Server**. It does not appear in the **Toolbox**, is not governed by
the **Workspace MCP Server Allowlist**, and cannot be removed per chat or per
coworker. It is injected at the session/reconciliation layer
(`sessionMcpServers` in `opencode-session.ts` / `opencode-mcp-reconciliation.ts`),
not seeded as a `workspaceMcpServer` row the way Galien and Modulr are.

## Decision details

- **Identity:** calls act as the Generation's acting user — the chat **User**, or
  the **Coworker**'s owner for triggered runs. Auth reuses the managed-token
  pattern (`signManagedMcpToken`, short-lived, `{userId, workspaceId, internalKey}`
  signed with `CMDCLAW_SERVER_SECRET`); the Bap MCP server accepts managed tokens
  alongside hosted OAuth with `audience: "bap"` and scope `bap`. Its public hosted
  endpoint is `https://mcp.heybap.com/bap`; the old `/cmdclaw` path is deliberately
  not accepted. Runs and resources created this way are owned by the acting user
  and count against their quotas.
- **Audit:** these calls are recorded as runtime-originated, not user-originated,
  so "the user did X" and "the user's coworker did X" remain distinguishable.
- **Recursion guard:** runs started through these tools are **Runtime-Originated
  Runs** carrying a **Spawn Depth**. The server refuses to start a run beyond
  depth 3, so coworker cycles self-extinguish instead of running away. No rate
  limiting or token budgets in v1 — depth alone removes the unbounded case.

## Alternatives considered

- **Opt-in via the Toolbox** (like Gmail/Galien/Modulr): consistent with the
  allowlist rule, but the primary use case — "make me a coworker that does X" in
  plain chat — would require users to discover and enable a toggle first.
  Rejected for friction.
- **Default-on but removable per chat/coworker:** keeps an escape hatch for
  email-triggered coworkers processing untrusted input. Rejected to keep one
  uniform capability surface; the accepted trade-off is that a crafted inbound
  email can ask an email-triggered coworker to create and run coworkers as its
  owner, bounded by Spawn Depth and visible in the audit trail.

## Consequences

- Coworkers will be authored assuming these tools always exist, which makes this
  hard to walk back — removing or gating the server later breaks prompts in the
  wild. That is why this is an ADR.
- The allowlist invariant ("runtime access is granted by explicit server
  identity") now holds for Workspace MCP Servers only; Platform MCP Servers are
  the documented exception.
- The managed platform MCP `internalKey` is `"bap"`, but
  unlike other managed servers it is never reconciled into workspace rows.
- Trigger payloads / `coworkerRun` must carry Spawn Depth from day one; runs
  started directly by users or external triggers are depth 0.
- Spawn Depth is authoritative per run: it is persisted on the `generation` (and
  `coworkerRun`) row and never inherited from the reusable `conversation`, so a
  runtime-originated turn continuing an existing conversation cannot reset the
  depth chain and a human continuing a runtime conversation is not stuck at the
  runtime's depth.

## Known follow-up (P1): scope the managed token to the tool surface

The managed token minted for the Platform MCP Server is verified by the oRPC
`protectedProcedure`, which only checks that a user and session exist. That makes
the token a full acting-user API credential, not a 9-tool credential: the
sandboxed agent can read its own `Authorization` header and replay the token
against any authenticated oRPC route, including credential-mutating ones
(`provider-auth` disconnect/setApiKey, integration toggles). For an
email-triggered coworker processing untrusted input, prompt injection therefore
reaches the full account API as the owner.

This was reviewed and **accepted for the initial cut** under the ADR's
"acts as the acting user" model, with the scoping tracked as P1 follow-up:

- Add a runtime-only oRPC auth path (a `runtimeProcedure` or middleware
  allowlist) that authorizes only the procedures the Bap MCP tools call, and
  rejects managed tokens on every other route.
- Bind the token to its generation/run (`generationId`/`jti` claim, persisted)
  and reject it once that generation is terminal, so a copied token is not a
  standalone ~20-minute API credential.

Mitigations already in place: the token is workspace-pinned (rejected when its
workspace is not the user's active workspace) and short-lived.
