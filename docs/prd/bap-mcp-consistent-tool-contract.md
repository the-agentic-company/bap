# PRD: Consistent Bap MCP Tool Contract

## Problem Statement

The Bap MCP Server has grown from a focused Platform MCP Server into a broader management surface without one consistent contract. Existing tools mirror historical API endpoints, use overlapping names, split create and update inconsistently, expose some resource operations through flat action parameters, and sometimes rely on an Active Workspace that does not exist reliably for hosted MCP requests.

This makes the server difficult for agents and MCP hosts to use safely. Agents must guess whether an operation is called `create`, `update`, `setStatus`, `move`, or an action inside a generic management tool. Flat action schemas advertise irrelevant optional arguments and defer invalid combinations until runtime. Similar operations return different shapes. Workspace ownership can be implicit. User-facing concepts such as attachments are exposed under internal storage terminology such as File Assets. As more tools are added, these inconsistencies increase schema tokens, tool-selection mistakes, authorization risk, and maintenance cost.

The expanded surface also increases the authority of the Bap MCP Server. It is a Platform MCP Server injected into every Generation, while several proposed operations administer Workspace Memberships, Connected Accounts, Workspace MCP Authorizations, and credentials. Tool discovery alone is not an authorization boundary, so managed runtime credentials must not be able to replay their token against administrative APIs outside their intended capability profile.

## Solution

Replace the endpoint-shaped MCP surface with a stable, resource-oriented contract of 30 registered tools. Use `<singularResource>.<verb>` consistently. Combine only create and update as `save`, and combine only closely related read-only operations as `read`. Keep deletion, cancellation, OAuth initiation, credential mutation, cross-Workspace moves, and other high-impact transitions as explicit tools.

Make the server stateless with respect to Workspace selection. Every Workspace-bound tool requires an explicit nonblank `workspaceId`; `workspace.list`, Workspace creation through `workspace.save`, and the Generation-bound internal runner operation are the only exceptions. The selected Workspace must be authorized independently and propagated through every downstream request.

Expose task-specific uploaded inputs as attachments in the public MCP contract while retaining File Asset and Upload Session as internal domain concepts. Keep Coworker Documents separate because they are mutable persistent reference material backed by Runtime Volumes, and keep Sandbox Files as generated output surfaced through Coworker Run reads.

Register 27 ordinary hosted/model-facing tools, two client-assisted attachment upload tools, and one internal runner tool. MCP hosts may hide the attachment tools when they cannot perform the direct byte upload. Managed Generation runtimes receive a narrower server-enforced capability profile that excludes Workspace Membership, credential, OAuth, and other administrative operations not required by the runtime.

## User Stories

1. As an MCP user, I want to list every Workspace I can access, so that I can select the correct Workspace explicitly.
2. As an MCP user, I want to create a Workspace without first selecting an Active Workspace, so that Workspace creation works from a stateless client.
3. As an MCP user, I want to update a Workspace by its explicit identity, so that I cannot accidentally mutate a browser-selected Workspace.
4. As an MCP user, I want every Workspace-bound tool to require a Workspace ID, so that calls are deterministic across multiple Workspaces.
5. As an MCP user, I want cross-Workspace Coworker moves to name both source and destination Workspaces, so that both authorization boundaries are visible and validated.
6. As an MCP user, I want no MCP Workspace-switching command, so that one request cannot silently change the scope of later requests.
7. As a Workspace administrator, I want to list Workspace Memberships, so that I can inspect who has access.
8. As a Workspace administrator, I want one save operation for desired member access and role, so that invitations and existing membership role changes follow one predictable workflow.
9. As a Workspace administrator, I want the member-access result to distinguish a Workspace Invitation from a Workspace Membership, so that pending access is not presented as granted access.
10. As a Workspace administrator, I want member removal to remain explicit, so that a destructive access change is not hidden inside an ordinary save.
11. As a user, I want to list or inspect Connected Accounts through one read-only tool, so that the model receives a smaller safe read surface.
12. As a user, I want Connected Account connection and disconnection to remain explicit, so that authorization side effects are clear.
13. As a Workspace administrator, I want to list Workspace MCP Servers in a Workspace, so that I can inspect the available integration runtime boundary.
14. As a Workspace administrator, I want one Workspace MCP Server save operation for creation, configuration updates, and enabled status, so that ordinary configuration changes follow one shape.
15. As a Workspace administrator, I want disabling a Workspace MCP Server to preserve its Workspace MCP Authorization, so that temporary disablement is reversible.
16. As a Workspace administrator, I want Workspace MCP Server deletion to remain explicit, so that configuration removal is not confused with disabling.
17. As a Workspace administrator, I want setting a manual credential to remain explicit, so that secret-bearing operations can receive stronger authorization and redaction.
18. As a Workspace administrator, I want one OAuth reauthorization operation, so that I do not need separate connect and credential-revocation tools.
19. As a Workspace administrator, I want an existing OAuth credential retained while reauthorization is pending, so that an abandoned OAuth flow does not break a working server.
20. As a Workspace administrator, I want a successful OAuth callback to atomically replace and erase the previous credential, so that only the newest authorization remains usable.
21. As an MCP user, I want to list or inspect skills through one read-only tool, so that discovery does not share a schema with mutation.
22. As an MCP user, I want one skill save operation for creation and metadata or content updates, so that skill authoring follows the same save convention as other resources.
23. As an MCP user, I want nested skill files to survive skill creation and update, so that complete skills can be authored through the MCP.
24. As an MCP user, I want skill deletion to remain explicit, so that removing Runtime Volume-backed content is not hidden in save.
25. As a Bap engineer, I want skill folder identity protected from metadata-only renames, so that Runtime Volume identity remains correct.
26. As an MCP user, I want to run a chat with an explicit Workspace, so that the conversation and every attachment are authorized in the same Workspace.
27. As an MCP user, I want to continue an existing conversation only in its owning Workspace, so that a conversation ID cannot bypass Workspace isolation.
28. As an MCP user, I want one Coworker read tool for list, get, and export, so that related read-only workflows share pagination and detail controls.
29. As an MCP user, I want one Coworker save tool for creation and updates, so that I do not need to choose between create and update tools.
30. As an MCP user, I want Coworker status, favorite state, and Coworker Folder placement handled by Coworker save, so that ordinary Coworker state does not create one-off tools.
31. As an MCP user, I want omitted Coworker save fields to remain unchanged, so that partial updates are safe.
32. As an MCP user, I want a null Coworker Folder ID to move a Coworker to the top level, so that clearing placement is distinct from leaving it unchanged.
33. As an MCP user, I want Coworker deletion to remain explicit, so that destructive behavior is easy to identify and confirm.
34. As an MCP user, I want Coworker movement between Workspaces to remain explicit, so that it cannot be confused with changing Coworker Folder placement.
35. As an MCP user, I do not want a Coworker clone tool, so that the contract does not carry a redundant creation path with unclear document-copy semantics.
36. As an MCP user, I want one Coworker Document save tool for creating and updating persistent reference material, so that document authoring follows the save convention.
37. As an MCP user, I want Coworker Document replacement to require complete replacement bytes and MIME information, so that partial file replacement cannot create invalid state.
38. As an MCP user, I want Coworker Document deletion to remain explicit, so that mutable persistent reference material is not removed accidentally.
39. As a Coworker owner, I want to start a Coworker Run with optional input, payload, and attachments, so that one call can fully describe a manual run.
40. As a Coworker owner, I want to provide requested input to an existing Coworker Run through the same start workflow with an explicit mode, so that continuation is not inferred from blank fields.
41. As a Coworker owner, I want Coworker Run resume and cancel to remain explicit, so that lifecycle transitions have precise risk and annotation metadata.
42. As an MCP user, I want one Coworker Run read tool for lists, logs, and file downloads, so that run inspection stays read-only and uses one bounded result contract.
43. As an MCP user, I want file download to require both Coworker Run ID and file ID, so that file ownership is explicit.
44. As an MCP user, I want to upload task-specific input without encoding large files into tool JSON, so that file bytes do not consume model context or MCP proxy memory.
45. As an MCP user, I want attachment preparation to return a signed upload destination, so that my host can upload bytes directly to private storage.
46. As an MCP user, I want attachment completion to produce a ready attachment identity, so that chat and Coworker Run tools can reference the uploaded input.
47. As an MCP user, I want attachment terminology in the public contract, so that MCP vocabulary matches the Bap UI.
48. As a Bap engineer, I want File Asset and Upload Session to remain internal domain terms, so that the storage model stays precise without leaking into the user-facing contract.
49. As a Bap engineer, I want Coworker Documents kept separate from attachments, so that immutable task input is not confused with mutable Runtime Volume reference material.
50. As an MCP host developer, I want attachment tools to be separately identifiable as client-assisted tools, so that I can hide them when the host cannot upload bytes.
51. As a hosted MCP user, I want administrative tools authorized according to my Workspace role, so that authentication alone does not grant Workspace administration.
52. As a Coworker Run owner, I want the managed runtime MCP token limited to a runtime capability profile, so that prompt injection cannot administer memberships or credentials.
53. As a security engineer, I want capability enforcement applied at the downstream API boundary, so that hiding a tool from discovery cannot be bypassed by replaying a token.
54. As a security engineer, I want secret values excluded from ordinary results, errors, and logs, so that credentials are not exposed to models or telemetry.
55. As an MCP client developer, I want every successful tool call to use a common result envelope, so that response parsing is predictable.
56. As an MCP client developer, I want machine-readable error codes and retryability, so that clients can distinguish correction, authorization, conflict, and transient failures.
57. As an MCP client developer, I want list and read operations paginated and summary-first, so that responses remain bounded.
58. As a model using the MCP, I want tool schemas to reject irrelevant argument combinations before execution, so that errors are immediate and actionable.
59. As a Bap engineer, I want each tool to declare accurate read-only, destructive, and idempotency annotations, so that MCP hosts can apply appropriate policy.
60. As a Bap engineer, I want a regression inventory of exactly 30 registered tools, so that accidental tool proliferation or removal is detected.
61. As a Bap engineer, I want the local bap-dev MCP exercised across multiple Workspaces, so that the public contract is verified beyond unit tests.
62. As a Bap engineer, I want existing chat, Coworker, Coworker Run, skill, and attachment behavior reused behind the new contract, so that this redesign does not create parallel business logic.

## Implementation Decisions

- The Bap MCP Server will expose 30 registered tools organized as follows: two Workspace tools, three Workspace Membership tools, three Connected Account tools, five Workspace MCP Server tools, three skill tools, one chat tool, four Coworker tools, two Coworker Document tools, four Coworker Run tools, two attachment tools, and one internal runner tool.
- The canonical naming convention is `<singularResource>.<verb>` using product glossary terms. Public tool namespaces are `workspace`, `workspaceMember`, `connectedAccount`, `workspaceMcpServer`, `skill`, `chat`, `coworker`, `coworkerDocument`, `coworkerRun`, `attachment`, and `runner`.
- The complete tool inventory is `workspace.list`, `workspace.save`, `workspaceMember.list`, `workspaceMember.save`, `workspaceMember.remove`, `connectedAccount.read`, `connectedAccount.connect`, `connectedAccount.disconnect`, `workspaceMcpServer.list`, `workspaceMcpServer.save`, `workspaceMcpServer.delete`, `workspaceMcpServer.setCredential`, `workspaceMcpServer.startOAuth`, `skill.read`, `skill.save`, `skill.delete`, `chat.run`, `coworker.read`, `coworker.save`, `coworker.delete`, `coworker.moveWorkspace`, `coworkerDocument.save`, `coworkerDocument.delete`, `coworkerRun.start`, `coworkerRun.resume`, `coworkerRun.cancel`, `coworkerRun.read`, `attachment.prepareUpload`, `attachment.completeUpload`, and `runner.markFailed`.
- `save` means create when no resource ID is supplied and partial update when a resource ID is supplied. An omitted update field means unchanged; nullable fields use null only when clearing is supported. Save handlers must share validation and persistence logic with the existing product APIs rather than implement MCP-only behavior.
- `read` may multiplex only closely related read-only operations through a schema-level discriminated query. `connectedAccount.read` supports list and get; `skill.read` supports list and get; `coworker.read` supports list, get, and export; `coworkerRun.read` supports list, logs, and download file.
- Read tools default to summary results and accept bounded pagination where applicable. Full detail is opt-in. Ordinary list results contain stable identity, display name, status, and the next useful navigation or action data rather than full nested records.
- Destructive, credential-sensitive, OAuth, cross-Workspace, and lifecycle-transition operations remain separate tools. A read tool never includes writes or deletes, and a save tool never includes deletion, credential revocation, OAuth initiation, Coworker Run cancellation, or cross-Workspace movement.
- `workspace.list` is global. `workspace.save` creates globally when no Workspace identity is supplied and updates an explicitly identified Workspace otherwise. There is no `workspace.switch`, Active Workspace mutation, or default Workspace in the MCP contract.
- Every other user-facing tool requires a trimmed, nonblank `workspaceId`. Workspace scope is attached to the downstream client once and therefore persists across handlers that make multiple API calls. The server independently verifies token scope, Workspace Membership, role, and resource ownership.
- `coworker.moveWorkspace` requires source `workspaceId`, Coworker reference, and `targetWorkspaceId`. The caller must be authorized in both Workspaces, and the Coworker must belong to the source Workspace.
- `workspaceMember.save` accepts an email and desired role. When the email resolves to an existing Workspace Membership, it updates that membership; otherwise it creates or refreshes a Workspace Invitation. The response must preserve the distinction between a Workspace Membership and Workspace Invitation.
- Connected Account tools use Connected Account and Integration Type terminology. Connection accepts the Integration Type, redirect URL, optional connection mode, Account Label, and existing Connected Account identity when reauthorizing. Disconnection requires a Connected Account identity and remains explicit.
- `workspaceMcpServer.save` owns configuration and enabled state. It combines create and partial update and accepts display name, namespace, endpoint, transport/spec configuration, non-secret headers and query configuration, authorization type metadata, and enabled state.
- Disabling a Workspace MCP Server does not remove its Workspace MCP Authorization. Deleting the server removes the server configuration according to existing product lifecycle rules.
- `workspaceMcpServer.setCredential` is the explicit manual secret mutation path. Secrets are write-only and are never returned from read or save operations.
- `workspaceMcpServer.startOAuth` replaces both generic connect and credential revocation. Starting OAuth creates a pending authorization flow without removing the current credential. A successful callback atomically stores the new authorization and erases or revokes the previous credential. Failed, expired, or abandoned OAuth preserves the previous credential. There is no standalone credential-revocation tool.
- `skill.save` combines skill creation and update, including nested files and mutable metadata. Skill folder or slug identity follows Runtime Volume rules: metadata cannot rename it in place; a rename is a deliberate delete-and-create/move workflow if introduced later.
- `chat.run` requires Workspace scope, accepts a message or at least one ready attachment, optionally continues a conversation, and may accept model, authentication source, sandbox, and approval settings. Continuing a conversation validates that it belongs to the supplied Workspace.
- `coworker.read` provides list, get, and export. `coworker.save` absorbs the previous create, update, within-Workspace Coworker Folder move, status, and favorite operations. It accepts ordinary Coworker definition, trigger, model, Toolbox, schedule, Start Message requirement, status, favorite state, and Coworker Folder placement fields.
- Coworker Folder placement uses three-state patch semantics: a concrete folder identity moves the Coworker into that folder, null moves it to the top level, and omission leaves placement unchanged.
- `coworker.clone`, the generic within-Workspace `coworker.move`, `coworker.setStatus`, and `coworker.setFavorite` are not part of the final surface. `coworker.moveWorkspace` remains because it crosses an authorization boundary.
- `coworkerDocument.save` combines creation and update through a discriminated operation. Creation accepts one or more documents. Update names a Coworker Document and accepts metadata changes or a complete replacement. `coworkerDocument.delete` remains explicit.
- Coworker Document operations use Runtime Volume storage as the canonical mutable source and refresh the product projection. They do not write new mutable bytes through legacy File Asset columns.
- `coworkerRun.start` uses an explicit mode. New mode requires a Coworker reference and accepts optional Start Message input, trigger payload, and attachments. Provide-input mode requires an existing Coworker Run and input, and may accept attachments if the existing Generation flow supports them. The server never infers mode from blank input or the presence of unrelated fields.
- `coworkerRun.resume` and `coworkerRun.cancel` are explicit lifecycle operations. Cancellation rejects terminal Coworker Runs and follows existing Generation settlement behavior.
- `coworkerRun.read` provides list, logs, and Sandbox File download. File download requires both Coworker Run and file identity so ownership is explicit.
- Public MCP terminology uses attachment and `attachmentId`. Internally, attachment upload delegates to Upload Session and File Asset services and maps the public attachment identity to the Ready File Asset identity. Database and core domain names remain File Asset, Ready File Asset, Upload Session, Message Attachment, and Sandbox File.
- `attachment.prepareUpload` accepts Workspace identity, filename, MIME type, and positive byte size. It returns an attachment identity, signed upload destination, and expiration. The host uploads raw bytes directly to private storage.
- `attachment.completeUpload` accepts Workspace and attachment identity, verifies the upload, completes the Upload Session, and returns ready attachment metadata. Only ready attachments can be passed to chat or Coworker Run tools, and each attachment must belong to the supplied Workspace and acting User as required by product authorization.
- The two attachment tools are client-assisted protocol primitives. They are registered in the server contract but may be hidden from model selection when the MCP host cannot read local bytes or perform the signed upload.
- `runner.markFailed` remains internal and Generation-bound. It does not accept Workspace identity because its managed token already fixes the Generation, Coworker Run, acting User, and Workspace.
- Successful tool results use one common envelope containing completion status, optional Workspace identity, action, data, and optional next cursor. Tool-specific data remains typed and summary-first.
- Errors use machine-readable categories for invalid input, not found, forbidden, conflict, required user action, and upstream failure. Errors include a safe human message, retryability, and optional redacted details.
- Tool annotations accurately describe read-only, idempotent, destructive, and open-world behavior. Tools that contain multiple read query variants retain one risk level. Secret mutation, deletion, and cancellation are never annotated as read-only or idempotent unless their actual semantics guarantee it.
- The implementation should introduce a deep MCP contract layer that owns shared Workspace scope validation, common query/save combinators, response envelopes, error mapping, tool annotations, capability metadata, and the 30-tool inventory. Individual tool modules should remain thin adapters to domain handlers.
- Domain handler modules should be organized by Workspace access, Connected Accounts, Workspace MCP Servers, skills, chat, Coworkers and Coworker Documents, Coworker Runs, and attachments. They should reuse existing Bap client and server services rather than grow one large remote-management dispatcher.
- The client package remains the typed boundary for operations required by the MCP. Missing client methods will be added by domain, with credentials and OAuth represented by explicit methods rather than generic action dispatch.
- The web/API layer remains authoritative for Workspace authorization, product invariants, OAuth callback handling, File Asset verification, Runtime Volume writes, Coworker Run transitions, and role checks. MCP schemas are an early validation layer, not the security boundary.
- The Bap MCP Server will support explicit capability profiles. Hosted interactive authorization may expose the ordinary management surface permitted by OAuth scope and Workspace role. Managed Generation tokens receive a narrower runtime profile.
- Capability profiles are enforced at both tool registration/discovery and downstream API authorization. Managed tokens must be rejected from non-allowlisted API procedures even if copied from the sandbox and replayed manually. The token remains Workspace-pinned, Generation-bound, short-lived, and invalid after its Generation becomes terminal.
- Managed runtime profiles exclude Workspace Membership mutation, Connected Account connect/disconnect, Workspace MCP Server credential/OAuth administration, and other administrative operations not explicitly required for runtime orchestration. The exact allowlist is centralized and tested rather than duplicated across tools and routes.
- Credential material, signed upload destinations, authorization codes, request authorization headers, and provider payloads are redacted from logs and ordinary errors. Security-sensitive operations emit appropriate runtime-originated attribution and security/audit evidence according to existing observability boundaries.

## Testing Decisions

A good test validates an observable contract: accepted and rejected schemas, Workspace authorization, resource ownership, returned result shape, externally visible lifecycle state, persisted product state, and safe failure behavior. Tests should not assert private helper call order or duplicate implementation details. Each regression should be colocated with the contract, handler, client method, or API behavior it protects using the repository's `*.test.ts` and `*.e2e.test.ts` conventions.

- Add an inventory test asserting the exact 30 registered tool names and the absence of removed names, including `workspace.switch`, `coworker.clone`, `coworker.move`, `coworker.setStatus`, `coworker.setFavorite`, File Asset public names, and `workspaceMcpServer.revokeCredential`.
- Add schema tests for every Workspace-bound tool requiring a trimmed nonblank `workspaceId`, with explicit exceptions for global Workspace creation/listing and the internal runner tool.
- Add schema tests for every discriminated read or save variant, proving required fields are enforced, irrelevant fields are rejected, and action behavior is never inferred from blank values.
- Add annotation tests proving read tools are read-only, mutation tools are not, destructive operations are marked appropriately, and mixed-risk behavior has not leaked into read or save tools.
- Add common result and error contract tests covering summary data, next cursor, invalid input, not found, forbidden, conflict, user action required, retryable upstream failure, and redaction.
- Preserve and extend the existing MCP client tests proving Workspace identity is forwarded on every downstream request and cannot fall back to Active Workspace state.
- Add cross-Workspace integration tests covering two authorized Workspaces in one MCP session, resource creation and reads in each, resource isolation, wrong-Workspace rejection, and Coworker movement with source and destination authorization.
- Add Workspace Membership tests covering list pagination, role update for an existing Workspace Membership, creation/refresh of a Workspace Invitation for an unknown email, result-type distinction, insufficient-role rejection, and removal.
- Add Connected Account tests covering list/get reads, connection modes, reauthorization selection, disconnection, wrong-Workspace access, and safe error redaction.
- Add Workspace MCP Server tests covering create, partial update, enabled/disabled state, delete, manual credential replacement, OAuth start, callback success, callback failure, callback expiry, and concurrent reauthorization attempts.
- Treat OAuth replacement as a critical regression: a pending, failed, expired, or abandoned flow preserves the old credential; only a successful callback atomically replaces and erases it.
- Add tests proving there is no standalone credential-revocation MCP operation and that disabling a Workspace MCP Server does not erase authorization.
- Add skill tests based on the existing successful local `skill.add` behavior. Cover new skill creation with `SKILL.md` and nested files, metadata update, content update, list/get read, delete, Workspace isolation, invalid skill structure, and attempted metadata-only identity rename.
- Add chat tests covering new conversation, continuation, message-only, attachment-only, message plus attachments, attachment readiness, attachment ownership, conversation Workspace mismatch, and upstream Generation failure.
- Add Coworker read tests covering bounded list, summary/full detail, get by ID or supported reference, and export.
- Add Coworker save tests covering create, partial update, status, favorite state, Coworker Folder placement, top-level clearing, omitted placement, Toolbox selection, schedule clearing, Start Message settings, and invalid create/update field combinations.
- Add Coworker deletion and move-Workspace tests covering ownership, both Workspace authorizations, destination conflicts, resource projection updates, and rollback or clear failure behavior when movement cannot complete.
- Add Coworker Document tests aligned with Runtime Volume behavior: multi-document create, metadata update, complete replacement, delete, filename identity rules, projection refresh, mount/storage failure, invalid nested paths, and wrong-Coworker or wrong-Workspace access.
- Add Coworker Run start tests for new mode with no input, input, payload, attachment-only input, and combined input. Add provide-input tests proving run ID and nonblank input are required and new-run-only fields are rejected.
- Add Coworker Run resume and cancel tests covering every nonterminal and terminal status, repeated calls, Generation settlement, Spawn Depth propagation, and wrong-Workspace access.
- Add Coworker Run read tests covering pagination and status filters, logs, Sandbox File download with run ownership, missing files, and expired download access.
- Add attachment protocol tests covering prepare, signed byte upload, completion, ready metadata, incorrect size or MIME metadata, expired Upload Session, duplicate completion, missing bytes, wrong Workspace, unauthorized User, and cleanup eligibility for Unattached File Assets.
- Add public/internal terminology tests at the contract boundary: MCP schemas and responses use attachment identity while core and persistence continue to use File Asset and Upload Session identities.
- Add capability-profile tests proving hosted and managed surfaces discover only their allowed tools. Managed runtime tests must demonstrate that hidden administrative API procedures reject a replayed managed token, not merely that their MCP tools are absent.
- Add token lifecycle tests proving a managed token is Workspace-pinned, Generation-bound, rejected after terminal Generation state, and unable to change its effective Workspace through request input.
- Add redaction tests for manual credentials, OAuth codes/tokens, signed upload destinations, authorization headers, and upstream provider errors.
- Extend the local bap-dev smoke test to discover exactly 30 registered tools, verify the hosted visible profile, create/read resources across two Workspaces without switching, create a skill with nested files, start a Coworker Run with input, and complete an attachment upload when the host can perform the signed PUT.
- Run focused MCP, client, web/API, core service, and database integration tests during development. Run the repository trusted test rail before completion, then the full green rail when the environment supports its live subset.

## Out of Scope

- Adding an MCP Active Workspace, default Workspace, or Workspace-switching tool.
- Adding Workspace deletion.
- Adding a standalone Workspace MCP Authorization revocation tool. Users can disable the Workspace MCP Server, replace its manual credential, reauthorize through OAuth, or delete the server configuration.
- Removing a working OAuth credential at OAuth initiation time. Replacement occurs only after successful callback completion.
- Exposing File Asset as public MCP terminology or renaming internal File Asset, Upload Session, Message Attachment, Ready File Asset, or Sandbox File domain concepts.
- Passing large attachment bytes as base64 through MCP tool arguments.
- Treating task-specific attachments as Coworker Documents or automatically promoting an attachment into persistent Coworker reference material.
- Replacing Runtime Volumes for Coworker Documents or skills with immutable File Asset storage.
- Reintroducing Coworker clone, within-Workspace Coworker move, Coworker set-status, or Coworker set-favorite tools.
- Combining destructive, credential-sensitive, OAuth, or lifecycle-transition operations into generic save or read tools.
- Providing File Asset version history, Coworker Document version history, merge conflict handling, or restore UX.
- Changing the public UI terminology beyond keeping MCP attachment language coherent with the existing UI.
- Certifying every third-party MCP host's ability to perform client-assisted signed uploads.
- Creating or updating Linear issues as part of this PRD.

## Further Notes

The target surface is intentionally not minimized to an arbitrary tool count. Consolidation follows workflow and risk boundaries: safe reads can share a bounded read tool, create and partial update can share save, while destructive or authorization-changing actions remain explicit. The expected result is 30 registered tools with smaller schemas and responses than an endpoint-per-operation design.

The ordinary hosted/model-facing count is 27 after excluding the two client-assisted attachment tools and the internal runner tool. This is not the managed Coworker runtime count: the runtime profile must be smaller and is determined by an explicit server-enforced allowlist.

This PRD builds on the existing explicit Workspace-scoping implementation and existing chat, Coworker, Coworker Run, skill, File Asset, and client abstractions. It is a contract consolidation and capability-hardening effort, not a parallel management backend.

The public attachment naming is deliberately an adapter boundary. Internally, attachment preparation and completion still create an Upload Session and Ready File Asset; chat and Coworker Run persistence still create Message Attachments referencing that File Asset. Coworker Documents and skill contents continue to follow Runtime Volume decisions.

The capability-profile work resolves the known security follow-up in the Bap MCP Server platform-capability architecture before the server exposes broader membership and credential administration. Shipping the expanded tool discovery without downstream managed-token enforcement is not considered complete.
