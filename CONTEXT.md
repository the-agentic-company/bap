# Bap

Bap is a platform for building and running agents across connected company tools. This language guide keeps product terms precise across CLI, web, runtime, and integration code.

## Language

**Connected Account**:
One credential-bearing connection for one **Integration Type** under a **Connected Identity**. A **User** can have many **Connected Accounts** for the same **Integration Type**, and one conversation can use more than one of them.
_Avoid_: account, provider account, integration account

**Connected Identity**:
The internal grouping for related **Connected Accounts** that should share one user-facing **Account Label**. Each **Connected Account** belongs to one **Connected Identity** and one **Integration Type**; a **Connected Identity** has at most one **Connected Account** for a given **Integration Type**. Bap can group accounts into a **Connected Identity** automatically when they share a reliable email identity, including across providers; users can correct edge cases by moving a **Connected Account** between labels. Removing or moving one **Connected Account** does not remove the **Connected Identity** while other **Connected Accounts** still belong to it.
_Avoid_: provider, account, label

**Provider Identity**:
The stable identity reported by the external provider for a **Connected Identity** or **Connected Account**. Reconnecting the same **Provider Identity** refreshes the existing **Connected Account** for that **Integration Type**; connecting a different **Provider Identity** creates or uses a different **Connected Identity**.
_Avoid_: provider account

**Email Identity**:
A reliable email address reported by a provider and used as the default grouping signal for **Connected Identities**. When multiple providers report the same reliable **Email Identity**, Bap treats them as the same common-case **Connected Identity** unless the user later separates them.
_Avoid_: display email

**Integration Type**:
A supported tool category that Bap can connect to, such as Gmail, Slack, GitHub, or Salesforce. An **Integration Type** can have many **Connected Accounts** for a single **User**.
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

**Workspace MCP Server**:
A workspace-owned MCP server made available to agent runtimes for **Tool Invocations**. Bap treats MCP as the integration runtime boundary; managed integrations and custom MCP endpoints are both represented as **Workspace MCP Servers**.
_Avoid_: Executor source, OpenAPI source, tool catalog source

**Toolbox**:
The user-facing set of tools or integrations selected for a chat or coworker **Generation**. The **Toolbox** is backed by a **Workspace MCP Server Allowlist**, but end-user copy should prefer "tools" or "integrations" outside technical settings.
_Avoid_: Executor sources, source picker

**Workspace MCP Authorization**:
The Bap-owned credential or grant that allows a **Workspace MCP Server** to be used for a specific **User** or workspace policy. Bap remains the authority for this authorization even when OpenCode performs the runtime MCP connection.
_Avoid_: OpenCode auth, Executor auth, local token store

**Workspace MCP Server Allowlist**:
The concrete set of **Workspace MCP Servers** exposed to a chat or coworker **Generation**. User interfaces may group servers by **Integration Type**, but runtime access is granted by explicit server identity. The allowlist governs **Workspace MCP Servers** only; it does not govern **Platform MCP Servers**.
_Avoid_: allowed Executor sources, allowed integrations

**Platform MCP Server**:
A Bap-owned MCP server that is present in every **Generation** unconditionally. A **Platform MCP Server** is not a **Workspace MCP Server**: it does not appear in the **Toolbox**, is not subject to the **Workspace MCP Server Allowlist**, and cannot be removed per chat or per **Coworker**.
_Avoid_: built-in integration, default tool, hidden server

**Bap MCP Server**:
The **Platform MCP Server** that exposes Bap's own capabilities — running chats, listing, creating, and running **Coworkers**, managing **Coworker Documents**, and adding skills — so a **Generation** can operate Bap itself. Calls through the **Bap MCP Server** act as the **Generation**'s acting user (the chat **User**, or the **Coworker**'s owner) and are recorded as runtime-originated, not user-originated. Its public hosted endpoint is `https://mcp.heybap.com/bap`; the old `/bap` hosted path is not part of the public contract.
_Avoid_: self MCP, management API, internal tools

**Runtime-Originated Run**:
A chat or **Coworker** run started by a **Generation** through the **Bap MCP Server**, rather than directly by a **User** or an external trigger. A **Runtime-Originated Run** carries a **Spawn Depth**.
_Avoid_: nested run, sub-run, child generation

**Spawn Depth**:
The number of **Runtime-Originated Run** hops between a **User**- or trigger-initiated run and the current **Generation**. Runs started directly by a **User** or external trigger have **Spawn Depth** zero. The **Bap MCP Server** refuses to start a run beyond the platform's maximum **Spawn Depth** (currently three), so cycles between **Coworkers** self-extinguish instead of running away.
_Avoid_: recursion level, nesting limit, loop guard

**Canonical Service Event**:
One authoritative, context-rich observability record emitted by a Bap service-owned operation. HTTP requests, worker jobs, and generation lifecycle work each produce their own **Canonical Service Event**; browser-originated telemetry is a **Client Observation**, not an authoritative service event. **Canonical Service Events** use a required common envelope, operation-specific fields, and are correlated by trace id with **Generation** and conversation identifiers as domain pivots when available.
_Avoid_: wide event, canonical log line, request log

**Telemetry Version**:
The deployable application version recorded on observability data. **Telemetry Version** is distinct from the exact commit SHA and deployment identifier, which are recorded separately.
_Avoid_: version

**Client Observation**:
A browser-originated observability record that describes what the **User** experienced in the client and can be correlated with **Canonical Service Events** by trace id, **Generation**, or conversation identifiers. A **Client Observation** is accepted only through an allowlisted event contract; it can add evidence about page state, stream timing, or visible errors, but it is not the authoritative record of server behavior and is not application state stored in Postgres by default.
_Avoid_: client log, frontend log, browser log

**Operational Log**:
A structured process-level diagnostic record used to debug service runtime behavior. An **Operational Log** may include an **Error Diagnostic**, but it is not the authoritative record for a service-owned operation.
_Avoid_: console log, telemetry event, service event

**Error Diagnostic**:
A redacted observability summary of an exception or failure, including safe fields such as error name, message, stack, normalized code, category, provider, and upstream status when available. An **Error Diagnostic** preserves operational debugging signal without storing credentials, request bodies, provider payloads, or other forbidden content.
_Avoid_: raw error, serialized error, error object

**Audit Record**:
A durable product or security fact that records which actor performed which action on which resource at what time. **Audit Records** are separate from **Canonical Service Events** and are not part of the first observability rollout.
_Avoid_: audit log, observability log

**Audit Trail**:
The ordered history formed by **Audit Records**. An **Audit Trail** is product or security history, not operational telemetry.
_Avoid_: logs, telemetry

**Generation**:
One agent execution lifecycle for a conversation turn, including preparation, model streaming, tool use, interruption handling, and terminal completion or failure.
_Avoid_: run, request

**Authored Prompt Asset**:
Bap-authored reusable text that instructs or seeds an agent, runtime, or product flow before user-specific context is added. An **Authored Prompt Asset** is source material, not the final per-**Generation** model input and not a message from a **User**.
_Avoid_: prompt, system prompt, template

**Prompt Composition**:
The assembled model-facing instruction set for one **Generation**, built from **Authored Prompt Assets** and run-specific context. **Prompt Composition** is distinct from **Parameter Prompt**, **Agentic-App Prompt**, and **Start Message**, which are user-facing conversation concepts.
_Avoid_: system prompt, prompt file, agent prompt

**OpenCode Agent Definition**:
An **Authored Prompt Asset** that names one OpenCode runtime persona for Bap chat, **Builder Chat**, or **Coworker Run** behavior. An **OpenCode Agent Definition** is not a **Coworker Definition**.
_Avoid_: agent definition, coworker definition, agent markdown

**Coworker**:
A user-configured agent that can start a **Coworker Run** from a manual, scheduled, email, or webhook trigger.
_Avoid_: bot, automation, worker

**Coworker Folder**:
An exclusive placement and visibility container for **Coworkers** on the coworkers page. A **Coworker Folder** can contain **Coworkers** and child **Coworker Folders**; a **Coworker** or **Coworker Folder** with no parent appears at the top level of the page. Only top-level **Coworker Folders** choose a visibility boundary; nested **Coworker Folders** and contained **Coworkers** inherit it.
_Avoid_: tag, label, category

**Private Coworker Folder**:
A top-level **Coworker Folder** visible only to its owning **User**. Child **Coworker Folders** and **Coworkers** inside a **Private Coworker Folder** are private.
_Avoid_: personal tag, private category

**Workspace Coworker Folder**:
A top-level **Coworker Folder** visible to the workspace. Child **Coworker Folders** and **Coworkers** inside a **Workspace Coworker Folder** are visible to the workspace.
_Avoid_: shared tag, public category

**Coworker Run**:
One attempt by a **Coworker** to handle a manual or automated trigger. A **Coworker Run** may be actively running, waiting for human input, waiting for a continuation, or terminal; it may expose a **Generation** when the user is inspecting the underlying execution lifecycle.
_Avoid_: request, job

**Coworker Run Backlog**:
The non-terminal **Coworker Runs** for one **Coworker** that are waiting for a **Start Message**, approval, authentication, or continuation rather than actively running. Backlog is pressure on automated triggers, but it is not an active execution conflict for a manual **Run Now**.
_Avoid_: active runs, failed runs

**Auto-Disabled Coworker**:
A **Coworker** that Bap has turned off because automated triggers repeatedly produced **Coworker Run Backlog** that needs human attention. A **User** can still start a manual **Run Now** for an auto-disabled **Coworker**.
_Avoid_: failed coworker, broken coworker

**Coworker Run Reset**:
An explicit **User** action that cancels non-terminal **Coworker Runs** so an **Auto-Disabled Coworker** can receive automated triggers again. A **Coworker Run Reset** discards waiting or running work; it is not performed silently when a **User** views or edits a **Coworker**.
_Avoid_: cleanup, retry, silent reset, backlog reset

**Cancelling Coworker Run**:
A non-terminal **Coworker Run** for which a **User** has requested cancellation, while Bap is still settling the linked **Generation** or runtime cleanup. A cancelling run should not block new manual or automated starts.
_Avoid_: cancelled run, running run

**Coworker Avatar**:
The visual identity shown for a **Coworker** in Bap surfaces.
_Avoid_: agent avatar, profile picture, icon

**Builder Chat**:
A chat attached to one **Coworker** that a **User** uses to iteratively edit that **Coworker**. A **Builder Chat** is distinct from a chat created by running the **Coworker**.
_Avoid_: coworker builder conversation, builder conversation, editor chat

**File Asset**:
A private stored, agent-usable file in Bap that belongs to a workspace and records the **User** who created it. A **File Asset** is identified by Bap, not by its filename; multiple **File Assets** can have the same filename, its bytes do not change after upload, and access comes through product concepts that reference it.
_Avoid_: blob, object, raw upload

**Unattached File Asset**:
A **Ready File Asset** that is not referenced by any product concept. An **Unattached File Asset** can exist briefly after upload but is eligible for cleanup if it remains unused.
_Avoid_: orphan upload, dangling file

**Ready File Asset**:
A **File Asset** whose upload has completed and that Bap can attach to product concepts and stage into a runtime sandbox when a **Generation** starts.
_Avoid_: processed file, staged file

**Upload Session**:
A short-lived Bap-controlled upload flow that lets a **User** create a **File Asset** by sending file bytes directly to private storage under Bap authorization. A completed **Upload Session** creates a **Ready File Asset**; abandoned sessions expire and are not product-visible files.
_Avoid_: S3 upload, direct upload, upload token

**Message Attachment**:
A **File Asset** attached to a user-visible message as task-specific input for that conversation turn. A **Message Attachment** is distinct from a **Coworker Document** because it does not become persistent **Coworker** reference material unless the **User** explicitly promotes it.
_Avoid_: inline file, data URL, uploaded document

**Staged File Asset**:
A **File Asset** that Bap has made available at a Bap-owned filesystem path inside a runtime sandbox for a **Generation**. **Message Attachments** and relevant **Coworker Documents** are staged when the **Generation** starts, while the underlying storage mechanism remains private infrastructure.
_Avoid_: lazy file, remote file, storage path

**Coworker Document**:
A **File Asset** a **User** attaches to a **Coworker** so future **Coworker** **Generations** can use it as persistent reference material. A **Coworker Document** belongs to exactly one **Coworker** and is managed separately from the **Coworker**'s instructions, trigger, and **Toolbox**.
_Avoid_: doc, attachment, file upload

**Sandbox File**:
A **File Asset** produced inside a **Generation** runtime and surfaced to the **User** from the conversation. A **Sandbox File** is distinct from a **Message Attachment** because it is generated output rather than user-provided input.
_Avoid_: generated attachment, output upload

**Skill Document**:
A **File Asset** attached to a skill as reference material for agents using that skill. A **Skill Document** is distinct from a **Coworker Document** because it follows the skill rather than one **Coworker**.
_Avoid_: skill upload, skill attachment

**Coworker Definition**:
A portable serialized description of a **Coworker**, including instructions, trigger settings, **Toolbox**, optional **Coworker Documents**, and generated artifacts. A **Coworker Definition** does not include runtime state such as **Generations**, **Pending Starts**, or **Run History**.
_Avoid_: JSON, template, backup

**Run History**:
The user-facing history of **Coworker Runs**, their outcomes, and the run activity they produced for one or more **Coworkers**. **Run History** is distinct from an **Audit Trail**.
_Avoid_: coworker history, audit log

**Coworker Forwarding Alias**:
An email address that routes forwarded email to one **Coworker** configured with the `email.forwarded` trigger. A **Coworker Forwarding Alias** is distinct from user-level forwarded email routing.
_Avoid_: email alias, forwarding address

**Start Message**:
A free-text message a **User** provides before a **Coworker Run** starts so the linked **Generation** has the task-specific context it needs before work begins.
_Avoid_: launch payload, run prompt, parameter form, initial message

**Parameter**:
A specific value a **User** provides before a **Coworker Run** starts in response to a **Parameter Prompt**. A **Parameter** may be carried as the **Start Message** for that run.
_Avoid_: user input, field value

**Pending Start**:
A waiting state for a **Coworker** trigger where Bap has created the user-facing conversation and asked for a **Start Message**, but no **Generation** has started yet.
_Avoid_: paused generation, pending run, pre-run

**Needs User Input**:
The inbox-facing status for a **Pending Start**, shown to the **User** as “Needs your input.”
_Avoid_: awaiting start message, paused, approval

**Parameter Prompt**:
The coworker-authored question shown during a **Pending Start** to ask for a **Parameter**. A **Parameter Prompt** names the context the **Coworker** needs before it can start the **Coworker Run**.
_Avoid_: user input prompt, start prompt, first-run prompt

**SLO Journey**:
A low-cardinality, user-facing reliability slice whose success is measured by one authoritative terminal outcome, including failures that prevent the user from completing the workflow at all. **SLO Journey** values describe real product workflows such as chat, coworker builder, and coworker run; global SLO reporting is a rollup across journeys, not a separate journey.
_Avoid_: workflow, metric label, global journey

**Waiting Generation**:
A non-terminal **Generation** that is intentionally waiting for durable human action, such as approval or authentication, before it can continue.
_Avoid_: stuck, limbo

**Dormant Generation**:
A non-terminal **Generation** that is neither making runtime progress nor waiting on a durable human action. A **Dormant Generation** is a product bug, not a normal lifecycle state.
_Avoid_: limbo, hung run

**Runtime Progress**:
Evidence that a **Generation** has entered or advanced the runtime turn lifecycle, such as model output, tool use, runtime question or permission requests, prompt completion, or an explicit runtime terminal state. Transport connection, sandbox preparation, session creation, and cache work are not **Runtime Progress**.
_Avoid_: activity, heartbeat, connection

**Last Runtime Progress**:
The timestamp of the most recent **Runtime Progress** observed for a **Generation**. It is not updated by transport activity, sandbox preparation, session creation, cache work, or empty runtime status changes.
_Avoid_: last runtime event, last activity, heartbeat

**Runtime Progress Stall**:
A **Generation** failure where **Runtime Progress** was observed, but the runtime then stopped producing further **Runtime Progress** before reaching a terminal state or durable human wait.
_Avoid_: no progress, run deadline, timeout

**Runtime Warning**:
A non-terminal condition surfaced to the **User** when a **Generation** can continue but an expected runtime capability is degraded or unavailable. A **Runtime Warning** is visible product state, not only an **Operational Log**.
_Avoid_: soft error, hidden warning, console warning

**Agentic-App**:
A self-contained interactive application produced by a **Generation** and rendered inside the chat surface, so the **User** can view and use the result without leaving the conversation. An **Agentic-App** can send an **Agentic-App Prompt** into its conversation.
_Avoid_: canvas, artifact viewer, file preview, mini-app, preview, Generation Output Preview

**Agentic-App Prompt**:
A user message sent into the conversation from inside an **Agentic-App** rather than from the composer. It requires the **User**'s direct interaction with the **Agentic-App**, appears in the conversation like any other user message, and starts or queues a **Generation** under the conversation's existing defaults.
_Avoid_: preview prompt, mini-app prompt, button action, injected message

**Runtime Diagnostic Snapshot**:
A privileged operational artifact captured when a **Generation** fails in the runtime boundary and ordinary telemetry is insufficient to explain the failure. A **Runtime Diagnostic Snapshot** contains bounded runtime probe values, counters, event types, and pointers needed for debugging. Unlike **Operational Logs** and **Canonical Service Events**, it may include raw runtime message fields, provider errors, and log snippets because it is stored behind sensitive debug access rather than emitted into the general observability stream.
_Avoid_: dump, logs, trace

**Archived Diagnostic Sandbox**:
A stopped provider sandbox retained temporarily after a platform-suspect **Generation** failure so operators can recover and inspect runtime filesystem state. An **Archived Diagnostic Sandbox** is an operational debugging artifact, not user-facing application state, and must have bounded retention.
_Avoid_: preserved sandbox, sandbox dump, kept sandbox

**Local Runtime**:
A user-owned runtime used for local development where a **Generation** connects to the developer's own shared OpenCode server instead of a Bap-owned sandbox. A **Local Runtime** is single-tenant by assumption, uses one OpenCode session per Bap conversation, and is not a production execution environment.
_Avoid_: local sandbox, local Daytona, local run

**User**:
A person authenticated into Bap. A **User** owns the set of **Connected Accounts** available to their CLI and agent runs.
_Avoid_: account

**Internal User**:
A **User** who represents Bap staff and is allowed to inspect workspaces across the platform without being a **Workspace Member** of each workspace.
_Avoid_: admin user, workspace admin, super member

**Modulr Customer**:
A customer record in Modulr that belongs to one of Bap's customers and can be looked up to gather business context for an agent conversation.
_Avoid_: client, account, Bap customer

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

**Modulr Download Artifact**:
A short-lived Bap-owned file artifact created from a selected **Modulr Customer Document** so the **User** can retrieve it through Bap without the runtime sandbox needing direct object-storage access.
_Avoid_: sandbox S3 file, externally hosted download, direct bucket link

**Modulr Workspace Connection**:
A workspace-owned Modulr integration connection for one broker/company database. Bap derives short-lived Modulr bearer tokens from this connection when invoking Modulr MCP tools.
_Avoid_: Modulr user account, bearer credential

**Galien Target Environment**:
The Galien deployment, production or preproduction, selected by workspace access policy for a specific **User** in a specific workspace. A **Galien Target Environment** is not part of the user's Galien credentials.
_Avoid_: Galien account type, credential environment, user environment

**Galien Credential**:
The username and password a **User** stores for one **Galien Target Environment**. A **Galien Credential** validated against one Galien deployment is not assumed valid for another deployment.
_Avoid_: shared Galien login, global Galien credential

## Flagged Ambiguities

**account**:
Use **Connected Account** for an external provider identity. Use **User** for the authenticated Bap person; the database also has a Better Auth `account` table, so plain "account" is ambiguous.

**source**:
Use **Workspace MCP Server** for an MCP endpoint exposed to agent runtimes. Do not use "source" as a product term for integration runtime configuration.

**start**:
Use **Start Message** only for the user-provided context required before a **Coworker Run** starts. Use “trigger a coworker run” when referring to asking an existing **Coworker** to execute.

**client**:
Use **Client Observation** for browser-originated telemetry. Use **Modulr Customer** for a customer record from Modulr; Modulr's API may still expose that entity as `clients`.

## Example Dialogue

Developer: "Can one user connect two Gmail accounts?"

Domain expert: "Yes. The user has two Connected Identities, `personal` and `work`, each with a Gmail Connected Account. One conversation might read from the personal Gmail Connected Account before sending from the work Gmail Connected Account. Each Tool Invocation targets one Connected Account. When only one Connected Identity can provide Gmail, the selector can be omitted; when several can, the caller must choose one."

Developer: "What happens if the user reconnects work@gmail.com?"

Domain expert: "Because it is the same Provider Identity, Bap refreshes the work Gmail Connected Account instead of creating a duplicate."

Developer: "Where should this new sales coworker appear?"

Domain expert: "If the User creates it inside the Sales Coworker Folder, it appears there and inherits that folder's visibility. If it has no Coworker Folder, it appears at the top level of the coworkers page and uses its own visibility. A Coworker Folder can contain both Coworkers and child Coworker Folders."
