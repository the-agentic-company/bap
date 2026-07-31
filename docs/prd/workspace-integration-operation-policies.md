# Workspace Integration Operation Policies

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

Bap currently gives Users a coarse auto-approval choice for a chat or
**Coworker**, while integration operations are broadly inferred as reads or
writes. A **Workspace** cannot define a durable policy for an entire
**Integration Type** such as Gmail, Salesforce, or Slack, and it cannot restrict
one specific operation while leaving the rest of the integration available.

This makes it difficult for Workspace owners and admins to express the authority
they intend to grant. A Workspace may want Gmail search to run automatically,
Gmail send to require approval, and one destructive operation to be denied
entirely. The same capability may also be reachable through an integration CLI
command or an MCP tool, creating a risk that surface-specific rules drift or can
be bypassed.

Custom **Workspace MCP Servers** have the same problem. Their tools can change as
servers evolve, but the Workspace lacks a single place to inspect those tools,
set defaults, and restrict individual operations. A denied operation must also
remain understandable to both the model and the User; silently hiding it makes
the underlying Workspace restriction difficult to diagnose.

## Solution

Add a Workspace-owned integration operation policy covering managed
**Integration Types** and custom **Workspace MCP Servers**. Workspace owners and
admins configure each integration or server using one of four modes:

- `Auto-approved`: every operation runs automatically.
- `Requires approval`: operations use the current approval flow unless the
  **Generation** carries the existing `autoApprove` consent.
- `Denied`: every operation is blocked, and nothing beneath the denied parent
  can override it.
- `Personalized`: operations are auto-approved by default, while selected
  operations may be restricted to `Requires approval` or `Denied`.

Existing and newly introduced integrations and operations default to
`Auto-approved`. A chat or Coworker with auto-approval enabled may bypass
`Requires approval`, because that setting represents the User's blanket consent
for the Generation. It can never bypass `Denied`. Conversely, a policy operation
marked `Auto-approved` runs automatically even when chat or Coworker
auto-approval is disabled.

One canonical operation identity governs equivalent integration CLI and MCP
entry points. Policy evaluation occurs at trusted Bap-owned enforcement
boundaries before provider side effects. Denied operations remain visible to the
model, but execution returns a structured Workspace-policy denial that the model,
web UI, and CLI can explain to the User.

The policy applies across every **Connected Account** of an Integration Type in
the Workspace. Custom Workspace MCP Servers are included. **Platform MCP
Servers**, including the **Bap MCP Server**, are excluded completely.

## User Stories

1. As a Workspace owner, I want one policy for every integration in my Workspace, so that tool authority is managed centrally.
2. As a Workspace admin, I want to view all managed Integration Types, so that I can understand the Workspace's available capabilities.
3. As a Workspace admin, I want to view every custom Workspace MCP Server, so that custom tools follow the same governance model as managed integrations.
4. As a Workspace member, I want to view the effective policy, so that I understand which operations will run, ask, or be blocked.
5. As a Workspace member, I want policy settings to be read-only for me, so that I cannot change Workspace authority accidentally.
6. As a Workspace owner, I want policy editing limited to owners and admins, so that ordinary members cannot broaden tool authority.
7. As a Workspace admin, I want to set an Integration Type to Auto-approved, so that all of its operations can run without interruption.
8. As a Workspace admin, I want to set an Integration Type to Requires approval, so that its operations ask for consent by default.
9. As a Workspace admin, I want to set an Integration Type to Denied, so that none of its operations can execute.
10. As a Workspace admin, I want to set an Integration Type to Personalized, so that I can restrict selected operations without configuring every operation.
11. As a Workspace admin, I want Personalized mode to start from full auto-approved access, so that I only need to record exceptions.
12. As a Workspace admin, I want a personalized operation to require approval, so that sensitive actions remain possible with User consent.
13. As a Workspace admin, I want a personalized operation to be denied, so that prohibited actions cannot execute.
14. As a Workspace admin, I want operation-level settings to restrict only, so that a child cannot become more permissive than its parent mode.
15. As a Workspace admin, I want parent denial to be terminal, so that no child setting can reopen a denied integration.
16. As a Workspace admin, I want a clear indication that child controls are unavailable under Denied mode, so that the hierarchy is understandable.
17. As a Workspace admin, I want bulk modes for an integration, so that I do not need to edit many operations individually.
18. As a Workspace admin, I want the current policy default shown explicitly, so that implicit Auto-approved behavior is not mistaken for missing configuration.
19. As a Workspace owner, I want existing operations to default to Auto-approved, so that rollout preserves the chosen permissive Workspace baseline.
20. As a Workspace owner, I want newly introduced operations to default to Auto-approved, so that new capabilities follow the same baseline without manual setup.
21. As a Workspace admin, I want newly discovered operations to appear in the policy editor, so that I can restrict them after discovery.
22. As a Workspace admin, I want unavailable custom MCP tools to remain identifiable, so that temporary server failures do not erase my policy intent.
23. As a Workspace admin, I want renamed or removed operations presented safely, so that stale restrictions are not silently applied to the wrong capability.
24. As a Workspace admin, I want a custom MCP server reconnect to preserve its operation restrictions, so that transient connectivity does not reset policy.
25. As a Workspace admin, I want tool-list reordering to preserve restrictions, so that display order never becomes policy identity.
26. As a User, I want one Integration Type policy to cover all of my matching Connected Accounts in the Workspace, so that account selection does not change authority.
27. As a Workspace admin, I want policy independent of Connected Account labels, so that account renames do not affect permissions.
28. As a User, I want the same Gmail send rule applied through CLI and MCP, so that execution surface does not change the result.
29. As a Workspace admin, I want equivalent CLI and MCP capabilities to share one operation identity, so that a denied path cannot be bypassed through another surface.
30. As a developer, I want one canonical catalog of integration operations, so that parsers, policy, UI, and runtime do not maintain divergent operation lists.
31. As a developer, I want canonical operations to have stable display metadata, so that UI labels can evolve without changing policy identity.
32. As a developer, I want unknown operation behavior defined centrally, so that every execution path resolves it consistently.
33. As a developer, I want managed Integration Types keyed independently from custom Workspace MCP Servers, so that their different lifecycle needs remain explicit.
34. As a developer, I want Platform MCP Servers excluded structurally, so that the Bap MCP Server cannot accidentally enter this policy.
35. As a User, I want an Auto-approved operation to run automatically even when chat auto-approval is off, so that Workspace-specific consent is honored.
36. As a User, I want chat auto-approval to bypass Requires approval, so that my blanket consent avoids repeated prompts.
37. As a Coworker user, I want Coworker auto-approval to behave exactly like chat auto-approval, so that the same consent model applies across Generations.
38. As a Workspace admin, I want Denied to override chat auto-approval, so that Workspace prohibitions remain absolute.
39. As a Workspace admin, I want Denied to override Coworker auto-approval, so that automated work cannot bypass Workspace prohibitions.
40. As a User, I want Requires approval to use the existing approval experience, so that this feature does not introduce a second consent workflow.
41. As a User, I want a pending approval to re-check current Workspace policy before execution, so that an admin's later denial takes effect.
42. As a User, I want policy auto-approval to avoid creating a pending approval, so that automatic operations do not pollute my inbox or Coworker backlog.
43. As a User, I want policy denial to avoid creating a pending approval, so that impossible actions are not presented as approvable.
44. As a Coworker user, I want approval-required automated runs to use the existing Coworker Run backlog, so that I can resume them through familiar controls.
45. As a Coworker user, I want policy-denied automated runs distinguished from runs waiting for approval, so that I know an admin change is required.
46. As a User, I want denied operations to remain visible to the model, so that the model knows the requested capability exists.
47. As a User, I want the model to receive a clear Workspace-policy denial, so that it can explain why the operation did not run.
48. As a User, I want the model to suggest contacting a Workspace admin after a policy denial, so that I know how the restriction can be changed.
49. As a User, I want policy denial distinguished from my own denial, so that I understand who made the decision.
50. As a User, I want policy denial distinguished from missing authentication, so that I do not reconnect an account unnecessarily.
51. As a User, I want policy denial distinguished from an unavailable MCP server, so that I can identify the underlying problem.
52. As a CLI user, I want a stable machine-readable denial marker, so that automation can distinguish policy denial from provider failure.
53. As a web user, I want the conversation to show a durable denial result, so that refresh and replay preserve what happened.
54. As a support engineer, I want policy outcomes correlated with the Generation and Tool Invocation, so that I can diagnose unexpected behavior.
55. As a support engineer, I want to know whether execution was auto-approved by policy or Generation consent, so that approval behavior is explainable.
56. As a security reviewer, I want policy enforced before provider side effects, so that sandbox or prompt behavior cannot bypass it.
57. As a security reviewer, I want integration CLI enforcement to be authoritative outside the model prompt, so that command wording cannot grant authority.
58. As a security reviewer, I want Workspace MCP Tool Invocations to pass through a Bap-owned enforcement boundary, so that direct upstream calls cannot bypass policy.
59. As a security reviewer, I want stale and reused runtime sessions to use current Workspace policy, so that cached state cannot retain obsolete access.
60. As a security reviewer, I want alternate Connected Account selection to preserve the same result, so that account switching cannot bypass policy.
61. As a developer, I want policy resolution to be a pure, deeply tested module, so that the precedence rules remain easy to verify.
62. As a developer, I want CLI and MCP adapters to consume the same resolver output, so that their behavior cannot drift.
63. As a developer, I want policy persistence separate from operation discovery, so that temporary catalog failures do not erase Workspace intent.
64. As a developer, I want implicit defaults represented efficiently, so that every Workspace does not require rows for every auto-approved operation.
65. As a developer, I want personalized updates to be atomic, so that concurrent admin edits cannot produce partial policy.
66. As a developer, I want server-side role checks on every policy mutation, so that a forged client request cannot change policy.
67. As a developer, I want policy changes observable without raw tool inputs, so that operations can be debugged without leaking sensitive data.
68. As a product operator, I want metrics for policy denials and approval sources, so that rollout regressions are visible.
69. As a product operator, I want unknown-operation metrics, so that catalog drift is detected quickly.
70. As a product operator, I want a deployment order that preserves explicit denial during rollback, so that rollback cannot broaden authority.
71. As a developer, I want a migration that preserves the current autoApprove API, so that existing chat, CLI, MCP, and Coworker callers remain compatible.
72. As a developer, I want current read/write annotations retained as descriptive metadata where useful, so that this rollout need not remove valuable tool information.
73. As a developer, I want cross-surface tests for every policy mode, so that the feature is proven rather than inferred.
74. As a Workspace admin, I want the policy editor to work at desktop and narrow widths, so that settings remain usable across supported devices.
75. As a keyboard or assistive-technology user, I want the policy controls to be accessible, so that I can understand and change modes without relying on icons alone.
76. As a future developer, I want parameter-sensitive restrictions excluded from this version, so that the first policy model remains understandable and enforceable.

## Implementation Decisions

- Introduce **Workspace Integration Operation Policy** as the provisional domain
  name for this feature. Add it to the domain glossary when implementation
  begins so product, runtime, and UI code use one term.
- The policy covers managed Integration Types and custom Workspace MCP Servers.
- Platform MCP Servers are excluded by construction rather than filtered only
  in the UI.
- A managed policy subject is an Integration Type. Its policy applies to every
  matching Connected Account in the Workspace.
- A custom policy subject is a stable Workspace MCP Server identity. It does not
  depend on a Connected Account or transient runtime connection.
- Build a deep **Integration Operation Catalog** module. It owns stable operation
  identity, display metadata, CLI aliases, MCP tool mappings, availability
  state, and lifecycle metadata behind one query interface.
- Managed canonical operation identity is the pair of Integration Type and
  stable operation key.
- Custom canonical operation identity is the pair of Workspace MCP Server
  identity and stable MCP tool name.
- When a managed capability is reachable through CLI and MCP, both forms map to
  the same canonical operation.
- Display names, descriptions, read/write hints, and icons are metadata and do
  not participate in identity.
- Unknown, renamed, removed, and rediscovered operations are handled by the
  catalog rather than independently by UI and enforcement adapters.
- Custom MCP tool discovery records a last-known catalog. A transient discovery
  or connection failure does not erase operations or their policy.
- A newly discovered managed or custom operation is implicitly Auto-approved.
- Removed or unavailable custom tools remain visible as unavailable in the
  policy editor while policy references exist. Cleanup or long-term retention
  can be refined after operational evidence exists.
- Build a deep, pure **Workspace Policy Resolver** module. Its input is the
  policy subject, canonical operation, Generation auto-approval state, and
  current Workspace policy snapshot. Its output is `auto_approved`,
  `requires_approval`, or `denied`, plus a safe decision source.
- The resolver is the only authority for precedence semantics. CLI, MCP, web,
  and Coworker code do not reimplement its truth table.
- Integration-level modes are `auto_approved`, `requires_approval`, `denied`,
  and `personalized`.
- Auto-approved and Requires approval modes apply uniformly to every operation
  and do not accept child exceptions.
- Denied is terminal and applies uniformly to every operation.
- Personalized mode has an implicit Auto-approved baseline and stores only
  operation restrictions to Requires approval or Denied.
- Operation-level policy can only restrict. There is no operation-level state
  that is more permissive than the parent.
- Missing parent policy, missing operation policy, and newly introduced
  operations resolve to Auto-approved.
- Effective resolution first applies terminal parent or operation denial.
- If not denied, Generation `autoApprove` resolves an approval-required
  operation to auto-approved.
- If not denied, an explicit or implicit policy Auto-approved result runs
  automatically even when Generation `autoApprove` is false.
- Otherwise, the result is Requires approval.
- Chat and Coworker Generations use the same resolver and precedence.
- Persist parent policy separately from personalized operation restrictions.
  The default Auto-approved state should not require materializing a row for
  every Workspace, integration, server, or operation.
- Persist custom MCP tool catalog state separately from policy state so
  connectivity and discovery cannot delete authority decisions.
- Policy writes are atomic, validated against the catalog, and reject child
  states that are invalid for the selected parent mode.
- Workspace owners and admins can mutate policy. All active Workspace members
  can read it.
- Authorization is enforced in the server API, not inferred from disabled
  client controls.
- Expose a member-readable policy query returning policy subjects, operations,
  explicit settings, effective settings, catalog availability, and edit
  capability.
- Expose an owner/admin mutation that updates one subject mode and its complete
  personalized restriction set atomically.
- The settings experience follows the supplied permissions UI as an interaction
  reference while using Bap's existing visual language.
- The UI groups operations under their Integration Type or custom Workspace MCP
  Server and offers the four parent modes.
- Personalized mode enables operation controls for inherited Auto-approved,
  Requires approval, and Denied states. Other parent modes present their uniform
  effective state without editable child exceptions.
- The UI explains that chat or Coworker auto-approval can bypass Requires
  approval but cannot bypass Denied.
- Members see the same effective policy in a read-only state.
- Unavailable, removed, and newly discovered tools remain identifiable in the
  policy editor with clear lifecycle labels.
- Build thin enforcement adapters for integration CLI and Workspace MCP. They
  resolve canonical identity, call the shared resolver, and translate its result
  into the execution surface's control flow.
- Integration CLI policy is evaluated at a trusted Bap-owned boundary before
  provider side effects. Sandbox plugin checks remain defense in depth rather
  than the source of truth.
- Workspace MCP Tool Invocations pass through a Bap-owned policy enforcement
  boundary before the upstream tool executes. OpenCode does not receive a
  credentialed path that can bypass this boundary.
- Denied MCP tools remain in the model-visible tool catalog. Bap rejects the
  attempted invocation rather than removing the tool definition.
- A Requires approval result enters the existing durable approval lifecycle.
- An Auto-approved result executes without creating an approval interrupt.
- A Denied result does not create an approval interrupt and cannot be resumed as
  though a User could approve it.
- Approval resumption re-evaluates current policy immediately before execution.
  A new denial invalidates the previously pending approval.
- Define one structured Workspace-policy denial contract shared by CLI and MCP.
  It includes safe Workspace, policy subject, canonical operation, and decision
  metadata but excludes credentials and raw tool input.
- The model receives the structured denial as a tool result and can explain that
  a Workspace owner or admin must change the policy.
- Web conversation replay, CLI output, Coworker Run state, and support
  diagnostics distinguish policy denial, User denial, missing authorization,
  approval wait, and unavailable MCP server.
- Preserve the existing `autoApprove` Generation input and chat/Coworker
  configuration during migration.
- Existing read/write classification and MCP read-only annotations may remain as
  descriptive catalog metadata, but they no longer determine the effective
  Workspace policy.
- Deploy in a deny-safe order: schema and resolver reads, policy APIs and UI,
  enforcement adapters, then removal of obsolete inference. Rollback must keep
  explicit Denied rules authoritative.
- Emit safe decision telemetry identifying the effective result and source,
  Integration Type or Workspace MCP Server, canonical operation, and Generation
  correlation.
- Record policy mutations with actor, Workspace, subject, previous mode, new
  mode, and timestamps. A general-purpose product Audit Trail is not required by
  this PRD.
- The main deep modules are the Integration Operation Catalog, Workspace Policy
  Resolver, custom MCP catalog lifecycle, and policy repository. UI and runtime
  integrations remain comparatively thin consumers.

## Testing Decisions

- Tests assert externally observable decisions, persistence contracts, emitted
  outcomes, and provider-side-effect boundaries rather than private helper
  structure.
- Every behavior-bearing module in this PRD receives tests. Shallow wrappers
  need separate tests only when they translate or authorize behavior.
- Table-driven resolver tests cover every combination of parent mode,
  personalized operation state, Generation `autoApprove`, missing policy,
  unknown operation, and terminal denial.
- Resolver tests verify both effective outcome and safe decision source.
- Catalog tests verify stable managed identity, CLI aliases, MCP mappings,
  custom server identity, collisions, renames, removals, rediscovery, and
  Platform MCP exclusion.
- Contract tests verify an equivalent managed CLI command and MCP tool resolve
  to the same canonical operation.
- Custom MCP catalog tests verify transient discovery failure does not erase
  last-known tools or policy.
- Persistence tests verify implicit Auto-approved defaults do not require
  materialized operation rows.
- Persistence tests verify personalized restrictions are atomic and invalid
  child states are rejected.
- Authorization tests verify Workspace owners and admins can write while members
  can only read.
- Authorization tests verify membership and Active Workspace boundaries cannot
  be forged through request input.
- API tests verify policy subjects, catalog operations, explicit settings,
  effective settings, lifecycle states, and edit capability.
- UI component tests verify all four parent modes, Personalized restrictions,
  terminal denial, default copy, unavailable tools, and member read-only state.
- Accessibility tests verify the controls have meaningful names, states,
  keyboard behavior, and non-icon explanations.
- Browser tests verify the accepted policy editor workflow at desktop and narrow
  widths.
- CLI enforcement tests verify Auto-approved execution, approval-required
  suspension, Generation auto-approval bypass, terminal denial, unknown
  operations, aliases, and structured denial output.
- MCP enforcement tests verify the same matrix for managed and custom Workspace
  MCP Servers.
- Security tests verify direct MCP invocation cannot bypass the Bap-owned policy
  boundary.
- Cross-surface tests verify alternate Connected Account selection cannot change
  the effective policy.
- Runtime reuse tests verify a cached or reused session observes current policy.
- Approval lifecycle tests verify pending approvals re-evaluate policy and
  cannot execute after a new denial.
- Approval lifecycle tests verify Auto-approved and Denied outcomes create no
  pending approval.
- Coworker tests verify chat and Coworker `autoApprove` have identical
  precedence and that approval-required automated runs use the existing backlog.
- Stream and replay tests verify policy denial remains distinguishable after
  reconnect and refresh.
- Observability tests verify safe dimensions and confirm credentials, provider
  payloads, and raw tool inputs are absent.
- Migration tests verify existing chats, Coworkers, CLI callers, and Bap MCP
  callers retain their current `autoApprove` contract.
- Rollback tests or deployment validation verify explicit Denied state is never
  interpreted as Auto-approved by an older or partially deployed consumer.
- End-to-end coverage uses representative read and write operations from at
  least Gmail and one other managed Integration Type, plus one custom Workspace
  MCP Server.
- Live CLI validation uses the existing `bap chat` and `bap coworker` workflows
  where connected credentials permit.
- Prior art includes the existing runtime approval truth-table tests, Generation
  interruption and replay tests, integration CLI live tests, MCP server tool
  tests, Workspace role authorization tests, settings UI tests, and custom
  integration permission tests.
- After each implementation slice, run its focused colocated tests.
- Run `bun run check` for typechecking and linting.
- Run the full test suite after the cross-cutting enforcement and migration work.
- No lint rule or lint configuration change is part of this PRD.

## Out of Scope

- Governing Platform MCP Servers or any Bap MCP Server tool.
- Changing ADR-0013's decision that the Bap MCP Server is a hard-wired platform
  capability.
- Arbitrary shell command permissions.
- Filesystem, browser, external-directory, or general OpenCode runtime
  permissions.
- Per-Connected-Account policy.
- Per-User or per-Workspace-Member policy variants.
- Per-chat or per-Coworker operation overrides beyond the existing
  `autoApprove` consent.
- Allowing an operation to become more permissive than its parent mode.
- Parameter-sensitive policy based on recipient, record, field, path, payload,
  or other tool input.
- Hiding denied operations from the model.
- Replacing the existing durable approval lifecycle.
- Replacing Workspace MCP Server selection in the Toolbox.
- Changing Workspace MCP Authorization ownership or Connected Account
  resolution.
- Building a general-purpose Audit Trail product.
- Changing lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

- This PRD follows ADR-0009: Bap owns Workspace MCP authorization and access
  control while OpenCode owns runtime MCP connectivity.
- This PRD does not contradict ADR-0013 because Platform MCP Servers are
  excluded structurally.
- The current codebase duplicates integration operation knowledge across CLI
  parsing, runtime permission checks, UI labels, skills, and MCP definitions.
  Consolidating identity into the Integration Operation Catalog is a prerequisite
  for reliable enforcement.
- The permissive default is intentional and was explicitly chosen: both current
  and newly introduced operations default to Auto-approved.
- `Requires approval` is deliberately softer than `Denied`. Generation
  `autoApprove` is treated as the User's blanket consent and bypasses only the
  former.
- The highest implementation risk is the native MCP path. Preserving tool
  visibility while enforcing policy requires every credentialed Workspace MCP
  invocation to cross a Bap-owned boundary before provider side effects.
- The Wayfinder map and dependency frontier for this effort are staged in
  `docs/wayfinder/workspace-integration-operation-policy.md`.
