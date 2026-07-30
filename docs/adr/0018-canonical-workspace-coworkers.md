---
status: accepted
---

# Workspace-shared Coworkers are canonical collaborative resources

A **Workspace-shared Coworker** is one canonical **Coworker** that every active
Workspace member can discover, open, edit, and manually run. Workspace sharing
does not export and import a **Coworker Definition**, and it does not create a
per-member installation. The existing intra-Workspace **Install** action is
removed.

This decision separates facts that the current `ownerId` and `sharedAt` fields
conflate:

- **Coworker Creator** is immutable provenance. It is displayed with the
  creator's name and avatar, but it is not the general access or execution
  authority for a Workspace-shared Coworker.
- **Coworker Automation Owner** is the active, consenting Workspace member whose
  authorizations automated schedule, email, and webhook runs use.
- **Coworker Revision Actor** is the User whose direct, Builder Chat, or
  runtime-originated action changed canonical Coworker configuration.
- A **Coworker Run Initiator** is the User who requested a user-intent run.
- A **Coworker Run Execution User** is the User whose authorizations a run uses.
  Manual runs use their initiator; automated external-trigger runs use the
  Coworker Automation Owner.
- **Coworker Visibility** is explicitly `private` or `workspace`. Public
  publication and cross-Workspace copying are separate from Workspace
  visibility.

## Access and lifecycle

Every active Workspace member can read, edit, restore revisions of, organize
within Workspace-visible locations, and manually run a Workspace-shared
Coworker. Only the Coworker Creator or a Workspace admin can delete it, move it
to Private visibility, or initiate an Automation Owner reassignment. A proposed
Automation Owner must consent unless they assign themselves.

A Workspace-shared Coworker outlives its creator's Workspace Membership and User
account. Creator and Automation Owner foreign keys therefore cannot cascade
delete the Coworker. Creator attribution retains a safe display snapshot when
the live User is unavailable. If the Automation Owner is no longer an active
consenting member, external triggers pause while manual runs and editing remain
available.

Top-level Coworkers store explicit visibility and default to Private. A
folder-contained Coworker inherits the visibility of its top-level **Coworker
Folder**. Workspace Membership grants live access only inside that Workspace.
Public and cross-Workspace reuse remains an explicit **Make a copy** operation
that produces an independent Coworker without credentials, revisions, Run
History, Builder Chats, preferences, or a live update relationship.

## Editing and history

Every accepted canonical configuration mutation records an immutable
**Coworker Revision** with actor, origin, timestamp, changed field paths, safe
before/after values, and a restorable configuration snapshot. Restoration
appends a new revision rather than rewriting history.

Configuration edits use a monotonically increasing revision and field-aware
optimistic concurrency. A stale edit may merge when no field it changes was
modified since its base revision. A same-field stale edit returns a conflict and
does not overwrite the newer value. Live cursors, character-level operational
transforms, and CRDT collaboration are not required.

Each member has a private **Builder Chat** association for the same canonical
Coworker. Builder messages remain subject to that member's conversation access.
Accepted Builder Chat edits enter canonical configuration and Revision History
under the acting member's identity.

**Coworker Documents** remain mutable Runtime Volume files under ADR-0017.
Document additions, removals, renames, and writes create attributed Coworker
history events, but Postgres does not store a second mutable copy of their bytes
and this decision does not add byte-level diff or restore. Concurrent document
bytes retain last-write-wins behavior.

## Run identity and visibility

Manual Coworker Runs execute as their initiating member and never borrow creator
or Automation Owner credentials. External-trigger runs execute as the active
consenting Automation Owner. Start classification remains `user_intent` or
`external_trigger` as established by ADR-0015.

Workspace members can see safe Run metadata for a Workspace-shared Coworker,
including initiator when present, source, status, and timing. Manual-run
conversation content and output are private to the initiator. Automated-run
content is visible to Workspace members because it is output of the shared
automation. Workspace admin status does not implicitly grant access to private
manual-run content.

This execution-identity rule supersedes ADR-0013's narrower statement that a
Coworker Run always acts as the Coworker's owner. ADR-0013's acting-user,
runtime-origin, managed-token, and Spawn Depth decisions otherwise remain in
force.

## Personal state

Pin, hide, list ordering, filtering, private Builder Chats, and private
manual-run content are per-member state. Name, instructions, documents,
Toolbox, trigger, schedule, model, enabled state, visibility, Automation Owner,
and Revision History are canonical Coworker state.

## Migration

Existing shared originals retain their Coworker identifiers and become canonical
Workspace-shared Coworkers. Existing installed copies remain independent and
unchanged. Bap does not infer copy provenance, merge or delete copies, or show a
one-time migration notice.

Migration is additive first. New explicit fields and policy modules are
introduced while legacy `ownerId`, `sharedAt`, `builderConversationId`, and
`isPinned` callers move to the new model. Compatibility fields may remain only
with a documented narrow purpose after the cutover.

