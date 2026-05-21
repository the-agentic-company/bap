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

**User**:
A person authenticated into CmdClaw. A **User** owns the set of **Connected Accounts** available to their CLI and agent runs.
_Avoid_: account

## Flagged Ambiguities

**account**:
Use **Connected Account** for an external provider identity. Use **User** for the authenticated CmdClaw person; the database also has a Better Auth `account` table, so plain "account" is ambiguous.

## Example Dialogue

Developer: "Can one user connect two Gmail accounts?"

Domain expert: "Yes. The user has two Connected Identities, `personal` and `work`, each with a Gmail Connected Account. One conversation might read from the personal Gmail Connected Account before sending from the work Gmail Connected Account. Each Tool Invocation targets one Connected Account. When only one Connected Identity can provide Gmail, the selector can be omitted; when several can, the caller must choose one."

Developer: "What happens if the user reconnects work@gmail.com?"

Domain expert: "Because it is the same Provider Identity, CmdClaw refreshes the work Gmail Connected Account instead of creating a duplicate."
