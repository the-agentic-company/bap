# PRD: Canonical Workspace Coworkers

## Problem Statement

Workspace members can currently discover a teammate's shared **Coworker**, but using it requires an **Install** action that exports its **Coworker Definition** and creates a new Coworker owned by the installing **User**. Instructions, **Coworker Documents**, trigger configuration, and generated artifacts are copied. The copy immediately becomes independent from the original.

This behaves like installing a template rather than collaborating on a shared resource. A Workspace can accumulate several visually similar Coworkers whose instructions and documents have silently diverged. Improvements made by one member do not reach anyone else, members cannot tell which copy is authoritative, and the word "Install" suggests software distribution rather than ordinary Workspace access.

Users expect a Workspace-shared Coworker to behave more like a shared Notion page or Google Doc: one canonical Coworker that appears in the normal coworkers page, can be opened without installation, and reflects edits for every member. Collaboration must not blur execution identity, credential ownership, private manual-run content, or responsibility for unattended automation.

## Solution

Replace copy-based sharing inside a Workspace with one canonical **Workspace-shared Coworker**.

A Coworker has an explicit `private` or `workspace` visibility boundary. A top-level Coworker stores its own visibility. A Coworker inside a **Coworker Folder** inherits visibility from the top-level folder. Every Workspace member can discover, open, run, and edit a Workspace-shared Coworker directly from the normal coworkers page. There is no Workspace installation state and no **Install** action.

Shared configuration includes the Coworker's name, description, instructions, **Coworker Documents**, **Toolbox**, trigger configuration, schedule, model, enabled state, and other behavior-affecting settings. Accepted changes update the canonical Coworker and create an attributed revision. Revision History shows who changed what and allows a member to restore an earlier configuration by creating a new revision. Concurrent configuration edits use revision-aware, field-level conflict handling instead of silent last-write-wins behavior.

Collaboration and execution identity remain separate. Manual **Coworker Runs** execute as the member who starts them and use that member's authorizations. Automated runs execute as a named, consenting automation owner. Manual-run content is private to its initiating member, while automated-run content belongs to the shared automation and is visible to Workspace members. Run metadata is visible to the Workspace.

Each member receives a private **Builder Chat** for the canonical Coworker. Builder messages remain private, while accepted changes enter the shared Coworker and Revision History under the acting member's identity. Personal list preferences such as pinning and hiding are stored per member rather than on the shared Coworker.

Live collaboration stops at the Workspace boundary. Public or cross-Workspace reuse is an explicit **Make a copy** operation that produces an independent **Coworker Definition** import. Existing installed copies remain independent and are neither merged nor deleted.

## User Stories

1. As a Workspace member, I want a Workspace-shared Coworker to appear in my normal coworkers page, so that I can discover it without visiting a separate installation catalog.
2. As a Workspace member, I want to open a Workspace-shared Coworker directly, so that access feels like opening a shared document.
3. As a Workspace member, I do not want to install a Coworker that already belongs to my Workspace, so that duplicate Coworkers are not created.
4. As a Workspace member, I want one canonical set of Coworker instructions, so that everyone works from the same behavior.
5. As a Workspace member, I want one canonical set of Coworker Documents, so that persistent reference material does not diverge between members.
6. As a Workspace member, I want one canonical Toolbox configuration, so that the Coworker's intended capabilities are clear.
7. As a Workspace member, I want edits to a shared Coworker to update it for everyone, so that improvements do not need to be copied manually.
8. As a Workspace member, I want shared Coworkers to use the same cards and editor as private Coworkers, so that sharing does not create a second product surface.
9. As a Workspace member, I want a shared Coworker card to show its creator's name and avatar, so that I can understand its provenance at a glance.
10. As a Workspace member, I want a former member's creator attribution to remain visible, so that provenance survives membership changes.
11. As a Workspace member, I want to see who last edited a shared Coworker, so that recent changes have clear authorship.
12. As a Workspace member, I want a Workspace visibility indicator, so that I can distinguish shared Coworkers from my private Coworkers.
13. As a User, I want a top-level Coworker to be explicitly Private or Workspace-shared, so that visibility is intentional.
14. As a User, I want a new top-level Coworker to default to Private, so that sharing is deliberate.
15. As a User, I want a Coworker inside a Workspace Coworker Folder to be shared automatically, so that folder visibility remains a reliable boundary.
16. As a User, I want a Coworker inside a Private Coworker Folder to remain private, so that folder visibility remains a reliable boundary.
17. As a User, I want nested Coworker Folders and their Coworkers to inherit the top-level folder's visibility, so that nested content cannot contradict its container.
18. As a Workspace member, I want to move a shared Coworker between Workspace-visible locations, so that shared organization can evolve collaboratively.
19. As a Coworker creator, I want moving a Coworker from Workspace visibility to Private visibility to require confirmation, so that access is not revoked accidentally.
20. As a Workspace admin, I want to make a shared Coworker private when necessary, so that the Workspace can manage access after its creator leaves.
21. As an ordinary Workspace member, I do not want to make a shared Coworker private, so that I cannot revoke access for everyone.
22. As a Coworker creator, I want to delete a shared Coworker, so that I can retire work I introduced.
23. As a Workspace admin, I want to delete a shared Coworker, so that abandoned Workspace resources remain manageable.
24. As an ordinary Workspace member, I do not want to delete a shared Coworker, so that collaborative work cannot be destroyed casually.
25. As a Workspace member, I want to edit a shared Coworker's name, description, instructions, documents, tools, trigger, schedule, model, and enabled state, so that collaboration covers behavior rather than view-only access.
26. As a Workspace member, I want edits to save directly to the canonical Coworker, so that there is no separate publish step for ordinary collaboration.
27. As a Workspace member, I want every accepted edit to record its author and time, so that shared changes are accountable.
28. As a Workspace member, I want Revision History to describe which fields changed, so that I can understand an edit without comparing whole definitions manually.
29. As a Workspace member, I want document additions, removals, and writes to appear as attributed history events, so that changes to reference material are visible.
30. As a Workspace member, I want automation-owner changes to appear in Revision History, so that credential-bearing responsibility is traceable.
31. As a Workspace member, I want visibility and trigger-status changes to appear in Revision History, so that consequential configuration changes are traceable.
32. As a Workspace member, I want to inspect an earlier Coworker configuration, so that I can understand how its behavior changed.
33. As a Workspace member, I want to restore an earlier configuration, so that an unwanted edit can be reversed.
34. As a Workspace member, I want restoration to create a new revision, so that history is append-only and the restoration itself is attributable.
35. As a Workspace member, I want an edit based on an old revision to merge when it changes fields untouched by newer edits, so that unrelated work is not discarded.
36. As a Workspace member, I want a same-field concurrent edit to show a conflict, so that another member's work is not overwritten silently.
37. As a Workspace member, I want a conflict response to show the current value and author, so that I can decide whether to keep or replace it.
38. As a Workspace member, I do not need live cursors or character-by-character co-editing initially, so that safe shared editing can ship without a multiplayer text engine.
39. As a Workspace member, I want my Builder Chat for a shared Coworker to remain private, so that exploratory prompts and context are not exposed to the Workspace.
40. As a Workspace member, I want another member to have their own Builder Chat for the same Coworker, so that our editing conversations do not become entangled.
41. As a Workspace member, I want changes accepted through my Builder Chat to update the canonical Coworker, so that agent-assisted editing participates in normal collaboration.
42. As a Workspace member, I want Builder Chat changes attributed to me, so that Revision History identifies the acting person.
43. As a Workspace member, I want runtime-originated edits to identify both the acting member and their runtime origin, so that a human action and an agent action can be distinguished.
44. As a Workspace member, I want a manual Coworker Run to execute as me, so that it uses my Connected Accounts and authorizations.
45. As a Workspace member, I want a manual run to request my missing authorization rather than borrowing another member's credential, so that credential boundaries remain explicit.
46. As a Workspace member, I want my manual-run conversation and output to remain private to me, so that personal tool results are not exposed automatically.
47. As a Workspace member, I want to see that another member ran a shared Coworker, so that shared operational activity is understandable.
48. As a Workspace member, I want shared Run History metadata to include initiator, source, status, and timing, so that I can understand activity without seeing private content.
49. As a Workspace admin, I do not want private manual-run content exposed by default, so that administration does not silently bypass member privacy.
50. As a Workspace member, I want automated Coworker Runs to use a named automation owner, so that unattended credentials have a clear source.
51. As an automation owner, I want to consent before a shared Coworker can use my Connected Accounts unattended, so that another member cannot assign my identity unilaterally.
52. As a Coworker creator, I want to be the default proposed automation owner, so that a newly shared automation has a natural setup path.
53. As a Coworker creator, I want to assign myself as automation owner directly, so that self-consent does not require a redundant approval flow.
54. As a Workspace admin, I want to initiate an automation-owner change, so that automations can be maintained when responsibilities change.
55. As a proposed automation owner, I want to accept or reject the assignment, so that credential use remains consensual.
56. As a Workspace member, I want the Coworker UI to show who automated runs execute as, so that unattended behavior is visible.
57. As a Workspace member, I want automated-run output to be visible to the Workspace, so that shared automation produces shared results.
58. As a Workspace member, I want automated-run metadata and content to remain attached to the canonical Coworker, so that its operational history does not fragment by user.
59. As a Workspace admin, I want automated triggers paused when their automation owner leaves the Workspace, so that stale credentials are not used.
60. As a Workspace admin, I want to assign a new consenting automation owner after the previous owner leaves, so that the automation can resume safely.
61. As a Workspace member, I want manual runs and editing to continue when the creator or automation owner leaves, so that the shared Coworker remains useful.
62. As a Workspace member, I want the creator to be labeled as a former member after they leave, so that attribution remains accurate.
63. As a Workspace member, I want a shared Coworker to outlive its creator's Workspace Membership, so that Workspace work is not deleted with a person.
64. As a Workspace member, I want my pin state to apply only to me, so that organizing my list does not rearrange everyone else's list.
65. As a Workspace member, I want to hide a shared Coworker from my default view, so that I can reduce clutter without revoking access.
66. As a Workspace member, I want hidden shared Coworkers to remain discoverable, so that hiding is not confused with deletion or access removal.
67. As a Workspace member, I want list ordering and filters to remain personal, so that the canonical Coworker does not own presentation preferences.
68. As a Workspace member, I want the shared Coworker's enabled state to be global, so that trigger behavior is not contradictory between members.
69. As a Workspace member, I want the schedule and trigger configuration to be global, so that there is one understandable automation.
70. As a Workspace member, I want the old Install action removed for Coworkers in my Workspace, so that the UI communicates direct access.
71. As a Workspace member, I want a link to a Coworker in my Workspace to open the canonical Coworker, so that following a link cannot create a duplicate.
72. As a User, I want cross-Workspace reuse to say **Make a copy**, so that I understand the new Coworker will be independent.
73. As a User, I want a cross-Workspace copy to stop receiving source updates, so that Workspace boundaries remain explicit.
74. As a User, I want a public Coworker definition to grant no live access to its source Workspace, so that publication cannot bypass Workspace Membership.
75. As a User, I want a copied Coworker to use my destination Workspace and identity, so that it cannot retain the source member's credentials or authority.
76. As an existing User, I want previously installed Coworker copies preserved, so that personal edits are not lost.
77. As an existing User, I do not want an existing copy automatically merged with a newly canonical shared Coworker, so that divergent behavior is not reconciled incorrectly.
78. As an existing User, I do not want an existing copy deleted automatically, so that migration is non-destructive.
79. As an existing User, I do not need a one-time migration notice on an old copy, so that the new model does not add unnecessary interruption.
80. As a Workspace member, I want an existing shared original to become the canonical Workspace Coworker, so that the authoritative resource keeps its identity.
81. As a developer, I want one access-policy module for Coworker actions, so that authorization rules do not diverge across API, UI, runtime, and background jobs.
82. As a developer, I want one revision-aware Coworker change service, so that direct edits, Builder Chat edits, and runtime-originated edits share concurrency and history rules.
83. As a developer, I want one execution-identity resolver, so that manual and automated runs cannot select credentials through ad hoc ownership checks.
84. As a developer, I want one Run History visibility policy, so that metadata and content access are enforced consistently.
85. As a developer, I want per-member Builder Chat identity, so that a canonical Coworker is not coupled to one shared editing conversation.
86. As a developer, I want per-member Coworker preferences, so that presentation state is not stored on a Workspace resource.
87. As a developer, I want explicit visibility rather than inferring access only from a timestamp, so that private, Workspace, and public-copy concepts are not conflated.
88. As a developer, I want migration to preserve current identifiers where a shared original becomes canonical, so that links and historical runs continue to resolve.

## Implementation Decisions

- **Workspace-shared Coworker** is the collaboration model inside a Workspace. It is one canonical Coworker row and one canonical set of behavior-affecting state, not a source plus per-member installations.
- A Coworker has explicit `private` or `workspace` visibility. Workspace visibility grants access through **Workspace Membership**; it does not create per-member resource rows.
- A top-level Coworker stores its visibility directly. A folder-contained Coworker inherits the visibility of its top-level **Coworker Folder**. The folder boundary remains authoritative, and mixed visibility inside one folder tree is invalid.
- Top-level Coworker creation defaults to Private. Creation inside a Workspace Coworker Folder creates a Workspace-shared Coworker.
- Workspace visibility and public publication are separate concepts. Workspace visibility grants live collaboration to Workspace members. A public or cross-Workspace surface exposes only the existing portable-copy contract and never grants live access to the source.
- The legacy share timestamp must no longer be the sole authorization primitive. The migration may temporarily maintain it as a compatibility projection, but access policy reads from explicit visibility.
- The current owner concept is split into distinct domain facts:
  - `createdByUserId` is immutable provenance and is not an authorization role.
  - `automationOwnerUserId` is the consenting execution identity for unattended triggers and may change.
  - revision actor identity records who made each accepted change.
  - run initiator and run execution identity record who requested and who authorized each run.
- Creator attribution survives Workspace departure. Current display information is read from the User when available; durable attribution records retain a safe display-name and avatar snapshot for deleted or unavailable identities.
- A shared Coworker is not cascade-deleted when its creator leaves or deletes their User account. Creator references must permit preserved Workspace resources.
- Every active Workspace member may read, manually run, and edit a Workspace-shared Coworker.
- Editing includes behavior-affecting fields such as instructions, description, Toolbox, trigger, schedule, model, enabled state, and Coworker Documents.
- Creator or Workspace-admin authority is required to delete a shared Coworker, change it from Workspace to Private visibility, or initiate an automation-owner reassignment.
- A proposed automation owner must consent before the assignment becomes active, except when an authorized member assigns themselves.
- Ordinary members may restore a prior configuration because restore is represented as an attributed edit. Restore never deletes or rewrites older revisions.
- Members may reorganize shared Coworkers within Workspace-visible locations. Crossing from Workspace to Private visibility requires creator or Workspace-admin authority and explicit confirmation.
- A deep Coworker Access Policy module accepts actor, Workspace Membership role, Coworker visibility, creator, requested action, and relevant folder boundary, then returns an authorization decision. Routers, UI capability models, runtime management calls, and background work must use this policy rather than reproducing ownership predicates.
- The policy exposes stable actions such as read, edit, manually run, read shared run metadata, read run content, restore revision, organize within the current visibility boundary, change visibility, delete, initiate automation-owner change, and accept automation ownership.
- A canonical Coworker stores a monotonically increasing configuration revision.
- All configuration mutations go through a deep Coworker Change Service. The service accepts the actor, origin, expected base revision, and field-level patch; it returns the new canonical state and attributed revision or a structured conflict.
- Edit origins distinguish at least direct user edits, Builder Chat edits, runtime-originated edits, migration, and revision restoration.
- Each accepted mutation persists an immutable revision containing actor identity, origin, timestamp, base revision, resulting revision, changed field paths, before/after values suitable for display, and a complete restorable configuration snapshot.
- Secrets, credential material, private conversation content, and provider payloads are never stored in revision diffs or snapshots.
- Revision snapshots cover Coworker configuration, not runtime state. **Generations**, Pending Starts, active or historical Coworker Runs, private Builder Chats, per-member preferences, and credentials are excluded.
- Revision snapshots reference Coworker Document membership and display metadata but do not duplicate mutable Runtime Volume bytes.
- Coworker Document additions, removals, renames, and writes append attributed history events. These events identify the actor or originating Generation where available and the affected document, but do not promise byte-level diff or restoration.
- The Runtime Volume remains canonical for mutable Coworker Document bytes, consistent with the accepted Runtime Volume ADR. Concurrent document-byte writes retain the existing last-write-wins contract.
- Restoring a configuration snapshot creates a new revision based on the latest state. It does not rewind the revision counter or replace Revision History.
- Configuration autosave groups a bounded burst of contiguous changes from one actor into an understandable revision where practical. Consequential actions such as visibility, automation-owner, trigger, document-membership, and restoration changes always receive distinct history entries.
- A patch based on an older revision may merge automatically only when none of its changed field paths were modified after its base revision.
- A same-field conflict returns the latest revision, current value, conflicting field paths, and latest actor information. The client must ask the member to review and retry rather than silently overwriting.
- Array and structured fields use domain-aware field paths or whole-field conflict boundaries. The change service, not the client, owns merge semantics.
- Live presence, cursors, and character-by-character operational transforms are not required.
- Revision History is visible to all members who can read the shared Coworker.
- Each member has a distinct private **Builder Chat** relationship for a shared Coworker. The current one-conversation-per-Coworker field is replaced by a Coworker/member Builder Chat association with one active builder conversation per pair.
- Builder Chat authorization permits the member's private conversation to mutate the canonical Coworker only through the Coworker Change Service.
- Builder Chat messages are visible only under the normal conversation access rules for that member. Shared Revision History contains the accepted edit and attribution, not the private messages that produced it.
- Runtime-originated management changes record the acting User and runtime origin in the revision event, consistent with the **Bap MCP Server** acting-user model.
- Manual Coworker Runs resolve execution identity to the initiating member. Tool Invocations use that member's Workspace MCP Authorizations and Connected Accounts.
- A manual run never falls back to the creator's or automation owner's credentials. Missing authorization is handled for the initiating member.
- Automated schedule, email, and webhook triggers resolve execution identity to the active automation owner.
- An automation-owner assignment is valid only while the User has active Workspace Membership and has consented. Authorization for individual Integration Types is still resolved at execution time.
- When no valid automation owner exists, automated triggers pause with an explicit disabled reason. Manual runs remain available.
- Restoring an automation owner does not silently clear unrelated auto-disable or Coworker Run Backlog states.
- The existing distinction between user-intent and external-trigger starts remains. This PRD changes identity and visibility, not backlog-cap semantics.
- Coworker Runs persist distinct initiator, execution identity, and start classification facts. For a direct manual run, initiator and execution identity are the same member. For an external trigger, there may be no human initiator while execution identity is the automation owner.
- A deep Execution Identity Resolver determines the authorized execution User from Coworker, start classification, initiating User, automation-owner state, Workspace Membership, and consent.
- A deep Run History Visibility Policy determines access separately for run metadata and run content.
- Workspace members may see shared Run History metadata including initiator when present, trigger source, status, start time, finish time, and safe failure classification.
- Manual-run conversation messages, tool results, attachments, and generated output are visible only to the initiating member under normal conversation access. Workspace admins receive no implicit content bypass.
- Automated-run content is visible to Workspace members because it is output of the shared automation.
- Run metadata and error summaries must remain redacted and must not leak private manual content, provider payloads, credentials, or tool arguments.
- The creator's name and avatar appear on normal shared Coworker cards and detail surfaces using "Created by" language.
- Where a Coworker has automated triggers, relevant detail and settings surfaces show "Automations run as" with the automation owner's identity or a paused/missing-owner state.
- The old shared-coworker catalog is removed as a separate installation surface. Shared Coworkers are returned through the normal Workspace inventory and folder hierarchy.
- Workspace Coworker cards do not show **Install**. Opening the card navigates to the canonical Coworker.
- Cross-Workspace and public reuse uses **Make a copy**. It imports a portable Coworker Definition into the destination Workspace and produces an independent Private Coworker by default.
- A copied Coworker does not carry source credentials, authorizations, private Builder Chats, Run History, revision history, per-member preferences, or a live update relationship.
- Portable-copy behavior continues to validate destination models and Toolbox availability and to create destination-owned Coworker Documents according to existing definition-import rules.
- If a User follows a public or copied link to a Coworker already accessible in their active Workspace, Bap opens the canonical Coworker rather than offering an intra-Workspace copy as the primary action.
- Per-member presentation state moves behind a Coworker Member Preference module keyed by Coworker and User.
- Pin and hide are personal preferences. Hidden Coworkers remain accessible through search or an explicit hidden filter.
- Personal ordering and filtering remain member-specific. They may use existing client-local behavior where appropriate, but no personal preference is stored on the canonical Coworker.
- The existing Coworker-level pin state is migrated into the creator's member preference and removed from shared canonical state.
- Shared enabled state, trigger configuration, and schedule remain canonical Coworker state and therefore apply to everyone.
- Existing shared originals retain their Coworker identifiers and become canonical Workspace-shared Coworkers.
- Existing installed copies remain independent Coworkers. They are not merged, linked, deleted, or modified based on name or content similarity.
- Migration does not show a one-time notice on existing copies.
- The legacy intra-Workspace import-shared API and its UI mutation are removed after clients use direct canonical access.
- Existing portable export/import APIs remain for explicit **Make a copy** flows, with naming and authorization updated to distinguish copying from Workspace access.
- Existing Builder Chats for a shared original migrate to the creator's Coworker/member Builder Chat association. Copies retain their own existing builder context under their current owner.
- Existing shared Coworker Runs remain attached to the canonical identifier. Migration backfills initiator and execution identity from the best authoritative existing facts and preserves unknown values rather than inventing attribution.
- Existing creator/owner values backfill immutable creator attribution. Existing shared Coworkers propose their creator as automation owner, but unattended execution may resume only when consent and active Workspace Membership are valid.
- A deep migration module performs deterministic, idempotent backfills for visibility, creator attribution, automation-owner state, Builder Chat associations, personal pin preferences, and run identities.
- The normal Coworker inventory presenter combines accessible Coworkers, folder visibility, creator attribution, automation state, current-member preferences, and capability decisions into one stable client model.
- Reactive read models must expose canonical Workspace Coworkers to every active member while continuing to exclude other members' Private Coworkers and private Builder Chats.
- This feature warrants an ADR before implementation because it changes Coworker ownership semantics, authorization, revision persistence, Builder Chat cardinality, and execution identity. The ADR should reference and preserve the Runtime Volume and Coworker Run Backlog decisions.

## Testing Decisions

- Good tests assert observable domain behavior: which Coworker is visible, which action is allowed, which identity executes, which revision is created, how conflicts resolve, and which run content is returned. Tests should not couple to helper names, query shape, or internal diff implementation.
- Coworker Access Policy tests cover Private versus Workspace visibility; creator, ordinary member, Workspace admin, former member, and non-member actors; and every stable action exposed by the policy.
- Access tests verify that Workspace Membership grants direct read, edit, and manual-run access without creating a Coworker copy.
- Access tests verify that Private Coworkers remain accessible only to their creator and authorized private flows.
- Folder tests verify that top-level Coworker visibility is explicit and folder-contained Coworkers inherit the top-level folder boundary.
- Authorization tests verify that members can edit and restore, while only the creator or a Workspace admin can delete, move to Private visibility, or initiate automation-owner reassignment.
- Revision service tests cover initial revision creation, direct edits, Builder Chat edits, runtime-originated edits, restoration, actor attribution, origin attribution, and append-only history.
- Revision tests verify that sensitive credential, tool payload, and private conversation data never enter snapshots or diffs.
- Concurrency tests cover edits from the current revision, stale edits to untouched fields, stale same-field conflicts, structured-field conflict boundaries, and retry after conflict.
- Restoration tests verify that an old snapshot creates a new latest revision and does not alter prior history.
- Document history tests verify attributed add, remove, rename, and write events while keeping document bytes under Runtime Volume behavior.
- Runtime Volume tests verify that this feature does not introduce byte-level document restoration or change the established last-write-wins concurrent file behavior.
- Builder Chat tests verify one private conversation per Coworker/member pair, stable reuse for that member, different conversations for different members, and canonical edits through the shared change service.
- Builder Chat access tests verify that one member cannot read another member's builder messages or conversation.
- Execution Identity Resolver tests cover direct manual starts, runtime-originated user-intent starts, schedules, email triggers, webhooks, missing initiator, missing automation owner, departed automation owner, unconsented assignment, and revoked Connected Account authorization.
- Execution tests verify that a manual run never borrows creator or automation-owner credentials.
- Automation-owner tests cover self-assignment, proposed assignment, acceptance, rejection, admin initiation, creator departure, owner departure, pause behavior, and reassignment.
- Backlog regression tests verify that user-intent versus external-trigger classification and auto-disable behavior remain consistent with the accepted Coworker Run Backlog ADR.
- Run History Visibility Policy tests cover metadata access, private manual content, shared automated content, Workspace-admin behavior, non-member denial, safe errors, attachments, and generated outputs.
- Run metadata tests verify that displayed metadata cannot leak manual messages, tool arguments, provider payloads, or credentials.
- Per-member preference tests verify that one member's pin, hide, ordering, and filters do not affect another member.
- Inventory tests verify that shared Coworkers appear in the normal list and folder hierarchy, hidden Coworkers remain discoverable, and private Coworkers owned by teammates remain absent.
- Card and editor tests verify "Created by" attribution, former-member attribution, Workspace visibility, "Automations run as," paused automation-owner state, and the absence of **Install**.
- Revision History UI tests verify actor, timestamp, origin, changed-field summary, configuration inspection, restoration, and conflict presentation.
- Visibility UI tests verify explicit Private/Workspace selection for top-level Coworkers and confirmation when access is revoked.
- Router and service tests verify that all mutations pass actor identity and expected revision and that stale clients cannot silently overwrite canonical state.
- Public and cross-Workspace tests verify **Make a copy** language, destination scoping, independent identifiers, no live update relationship, and exclusion of credentials, Run History, revisions, Builder Chats, and preferences.
- Same-Workspace link tests verify that an accessible shared Coworker opens directly and does not invoke the copy flow.
- Migration tests verify that existing shared originals retain identifiers and become canonical Workspace Coworkers.
- Migration tests verify that existing installed copies remain byte-for-byte and configuration-equivalent independent Coworkers and receive no notice state.
- Migration tests verify creator attribution, proposed automation-owner state, creator pin preference, Builder Chat association, and conservative Run identity backfills.
- Migration tests are idempotent and verify that rerunning the migration creates no duplicate revisions, preferences, Builder Chat associations, or ownership requests.
- Schema tests verify that creator deletion does not cascade-delete a shared Coworker and that automation-owner departure produces a recoverable missing-owner state.
- Reactive-data tests verify Workspace members receive canonical shared Coworkers and personal preferences without receiving other members' Private Coworkers or Builder Chats.
- Multi-user integration tests use at least two ordinary members and one Workspace admin to verify shared editing, immediate read visibility, private Builder Chats, personal preferences, access control, and Run History privacy.
- End-to-end tests verify the primary journey: create a Workspace Coworker, see it as another member, edit it without installation, inspect attributed history, run it manually with personal identity, and observe only safe shared metadata from the other account.
- End-to-end automation tests verify consenting-owner assignment, an external trigger executing as that owner, shared automated output, departure pause, and admin-led reassignment.
- Prior art includes the existing Coworker builder-service tests, Coworker profile and definition router tests, Coworker folder-domain tests, Coworker Run and reset tests, initial inventory tests, reactive Coworker cache tests, and Coworker card/component tests.
- After implementation, run focused domain and service tests first, then relevant router, reactive-data, and component tests, followed by the repository check command and full test rail because authorization and schema behavior change broadly.
- Validate the completed Coworker flow through the repository's Coworker CLI where possible. Browser-level multi-user, history, and privacy behavior requires dedicated web integration or end-to-end validation in addition to CLI coverage.

## Out of Scope

- Google Docs-style live cursors, presence, character-by-character synchronization, operational transforms, or CRDT editing.
- Live shared Coworkers spanning more than one Workspace.
- Propagating future source changes into a cross-Workspace copy.
- Automatically linking, merging, reconciling, or deleting existing installed copies.
- Showing a one-time migration notice on existing copies.
- Inferring copy provenance from matching names, prompts, documents, or generated artifacts.
- Product-level byte history, byte diffs, or restoration for mutable Coworker Documents.
- Changing the Runtime Volume last-write-wins rule for concurrent Coworker Document writes.
- Sharing private Builder Chat messages with the Workspace.
- Exposing private manual-run content to other members or Workspace admins by default.
- Workspace-owned pooled credentials. Automated runs use a named consenting User in this design.
- Per-field custom editor roles or Coworker-specific access-control lists beyond Private/Workspace visibility and the creator/admin destructive-action boundary.
- Notifications, mentions, comments, suggestions, approval-before-publish, or review workflows for Coworker edits.
- Replacing **Audit Records** or building a platform-wide **Audit Trail**. Coworker Revision History is a product feature scoped to canonical Coworker changes.
- Reworking Coworker Run Backlog limits, Spawn Depth, trigger delivery, or cancellation semantics except where execution identity must be made explicit.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

- **Created by** is provenance, not ownership or continuing authority. Current authority comes from Workspace Membership, Workspace role, Coworker visibility, and the requested action.
- **Automation owner** is an execution identity, not the owner of the canonical Coworker.
- **Last edited by** is derived from Revision History and is distinct from both creator and automation owner.
- The current implementation frequently uses Coworker owner checks for reading, editing, Builder Chat access, document mutation, runtime lookup, Run History, and credentials. Implementation must replace these checks through the central policy and identity modules rather than broadening individual predicates opportunistically.
- The current implementation also overloads a sharing timestamp for Workspace access, public visibility, and shared catalog presentation. Explicit Workspace visibility and separate copy/publication semantics prevent those concepts from remaining coupled.
- The current shared import performs a full Coworker Definition export/import, including documents and artifacts. Removing that intra-Workspace path is the core behavioral change; portable definition import remains useful at a real Workspace boundary.
- The accepted Runtime Volume ADR remains authoritative for Coworker Document storage and concurrent file writes. The new ADR should state precisely how attributed document events are produced during post-Generation reconciliation without turning Postgres into a second mutable byte store.
- The accepted Workspace ADR remains authoritative: **Workspace** is the product term, Better Auth membership is the access primitive, and **Platform Admin** authority remains separate from Workspace roles.
- The accepted Coworker Run Backlog ADR remains authoritative for user-intent versus external-trigger starts and auto-disable behavior.
- Suggested Linear title: `Coworkers: replace Workspace installs with canonical collaboration`.
- Suggested Linear team: `cmdlaw`.
- Suggested triage status: ready for engineering review after the ownership/revision ADR is accepted.
