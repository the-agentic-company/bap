# CmdClaw

CmdClaw is a platform for building and running agents across connected company tools. This language guide keeps product terms precise across CLI, web, runtime, and integration code.

## Language

**Connected Account**:
One credential-bearing connection for one **Integration Type** under a **Connected Identity**. A **User** can have many **Connected Accounts** for the same **Integration Type**, and one conversation can use more than one of them.
_Avoid_: account, provider account, integration account

**Connected Identity**:
The internal grouping for related **Connected Accounts** that should share one user-facing **Account Label**. Each **Connected Account** belongs to one **Connected Identity** and one **Integration Type**; a **Connected Identity** has at most one **Connected Account** for a given **Integration Type**. CmdClaw can group accounts into a **Connected Identity** automatically when they share a reliable email identity, including across providers; users can correct edge cases by moving a **Connected Account** between labels. Removing or moving one **Connected Account** does not remove the **Connected Identity** while other **Connected Accounts** still belong to it.
_Avoid_: provider, account, label

**Provider Identity**:
The stable identity reported by the external provider for a **Connected Identity** or **Connected Account**. Reconnecting the same **Provider Identity** refreshes the existing **Connected Account** for that **Integration Type**; connecting a different **Provider Identity** creates or uses a different **Connected Identity**.
_Avoid_: provider account

**Email Identity**:
A reliable email address reported by a provider and used as the default grouping signal for **Connected Identities**. When multiple providers report the same reliable **Email Identity**, CmdClaw treats them as the same common-case **Connected Identity** unless the user later separates them.
_Avoid_: display email

**Integration Type**:
A supported tool category that CmdClaw can connect to, such as Gmail, Slack, GitHub, or Salesforce. An **Integration Type** can have many **Connected Accounts** for a single **User**.
_Avoid_: tool, provider, app

**Account Label**:
The user-facing label used with `--account` to choose one **Connected Identity**. The label is a lowercase ASCII slug, is managed by the UI, is globally unique per **User**, and is optional only when exactly one matching **Connected Identity** can provide a **Connected Account** for the requested **Integration Type**.
_Avoid_: selector, account flag, provider selector

**Selector Not Found**:
A selection failure that happens when a caller names an **Account Label** that does not resolve to a **Connected Identity** with a **Connected Account** for the requested **Integration Type**. This is different from missing authentication and should present available labels instead of starting a connection flow.
_Avoid_: auth required

**Tool Invocation**:
One command execution against an **Integration Type** during a conversation. A **Tool Invocation** targets exactly one **Connected Account**, while a conversation can contain many **Tool Invocations** that target different **Connected Accounts**.
_Avoid_: run, call

**Canonical Service Event**:
One authoritative, context-rich observability record emitted by a CmdClaw service-owned operation. HTTP requests, worker jobs, and generation lifecycle work each produce their own **Canonical Service Event**; browser-originated telemetry is a **Client Observation**, not an authoritative service event. **Canonical Service Events** use a required common envelope, operation-specific fields, and are correlated by trace id with **Generation** and conversation identifiers as domain pivots when available.
_Avoid_: wide event, canonical log line, request log

**Telemetry Version**:
The deployable application version recorded on observability data. **Telemetry Version** is distinct from the exact commit SHA and deployment identifier, which are recorded separately.
_Avoid_: version

**Client Observation**:
A browser-originated observability record that describes what the **User** experienced in the client and can be correlated with **Canonical Service Events** by trace id, **Generation**, or conversation identifiers. A **Client Observation** is accepted only through an allowlisted event contract; it can add evidence about page state, stream timing, or visible errors, but it is not the authoritative record of server behavior and is not application state stored in Postgres by default.
_Avoid_: client log, frontend log, browser log

**Audit Record**:
A durable product or security fact that records which actor performed which action on which resource at what time. **Audit Records** are separate from **Canonical Service Events** and are not part of the first observability rollout.
_Avoid_: audit log, observability log

**Audit Trail**:
The ordered history formed by **Audit Records**. An **Audit Trail** is product or security history, not operational telemetry.
_Avoid_: logs, telemetry

**Generation**:
One agent execution lifecycle for a conversation turn, including preparation, model streaming, tool use, interruption handling, and terminal completion or failure.
_Avoid_: run, request

**User**:
A person authenticated into CmdClaw. A **User** owns the set of **Connected Accounts** available to their CLI and agent runs.
_Avoid_: account

**Modulr Customer**:
A customer record in Modulr that belongs to one of CmdClaw's customers and can be looked up to gather business context for an agent conversation.
_Avoid_: client, account, CmdClaw customer

**Modulr Customer Email Match**:
The lookup that resolves an inbound sender email to a **Modulr Customer**, first through the customer's own email addresses and then through contact email addresses associated with the customer.
_Avoid_: client lookup, sender lookup

**Modulr Customer Record**:
A customer-owned Modulr fiche such as a policy, estimate, claim, or complaint that may have its own document classification separate from the **Modulr Customer** entity.
_Avoid_: related file, subdocument, child record

**Modulr Customer Document**:
A document classified in Modulr GED on a **Modulr Customer** or **Modulr Customer Record**. It may be internal-only or visible through the customer's Modulr extranet.
_Avoid_: attached file, related file

**Modulr Document Resource**:
The MCP resource that exposes the bytes of a selected **Modulr Customer Document** after a tool has returned a resource link.
_Avoid_: download response, inline file

**Modulr Workspace Connection**:
A workspace-owned Modulr integration connection for one broker/company database. CmdClaw derives short-lived Modulr bearer tokens from this connection when invoking Modulr MCP tools.
_Avoid_: Modulr user account, bearer credential

## Flagged Ambiguities

**account**:
Use **Connected Account** for an external provider identity. Use **User** for the authenticated CmdClaw person; the database also has a Better Auth `account` table, so plain "account" is ambiguous.

**client**:
Use **Client Observation** for browser-originated telemetry. Use **Modulr Customer** for a customer record from Modulr; Modulr's API may still expose that entity as `clients`.

## Example Dialogue

Developer: "Can one user connect two Gmail accounts?"

Domain expert: "Yes. The user has two Connected Identities, `personal` and `work`, each with a Gmail Connected Account. One conversation might read from the personal Gmail Connected Account before sending from the work Gmail Connected Account. Each Tool Invocation targets one Connected Account. When only one Connected Identity can provide Gmail, the selector can be omitted; when several can, the caller must choose one."

Developer: "What happens if the user reconnects work@gmail.com?"

Domain expert: "Because it is the same Provider Identity, CmdClaw refreshes the work Gmail Connected Account instead of creating a duplicate."
