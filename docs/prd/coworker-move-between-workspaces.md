# PRD: Coworker Move Between Workspaces

## Problem Statement

Users sometimes create a **Coworker** in the wrong workspace, or later need to transfer it to another workspace they also use. Today there is no direct product action for this. The workaround is to recreate or export/import the **Coworker**, which is slow, error-prone, and can lose operational context such as trigger settings, documents, status, and run configuration.

An internal-only support page could solve this by rendering and moving coworkers across all workspaces, but that creates a broad administrative surface for a narrow user need. For the current use case, the user who owns the **Coworker** is also a member of both workspaces. Bap can support the common case as a normal owner action without introducing internal-only cross-customer movement or owner reassignment.

## Solution

Allow a **Coworker** owner to move their own **Coworker** from its current workspace to another workspace when the owner is a member of both workspaces.

The action appears in the normal **Coworker** editor. If the owner belongs to more than one workspace, they can choose a target workspace and confirm the move. The **Coworker** keeps its identity, owner, core profile, trigger configuration, **Coworker Documents**, and run history. Workspace-scoped placement and configuration are reset so the moved **Coworker** does not carry stale references from the source workspace.

On move, Bap sets the **Builder Chat** reference to `null`. This deliberately starts a fresh builder conversation in the target workspace the next time the owner opens the editor, avoiding accidental leakage of old workspace chat context into the new workspace.

## User Stories

1. As a **User**, I want to move a **Coworker** I own to another workspace, so that I can fix accidental placement without rebuilding it.
2. As a **User**, I want the move action to be available only for coworkers I own, so that I cannot move someone else's work unexpectedly.
3. As a **User**, I want to move a **Coworker** only into a workspace where I am already a member, so that movement stays within my own workspace access.
4. As a **User**, I want to see the current workspace and target workspace before confirming, so that I do not move the **Coworker** to the wrong place.
5. As a **User**, I want a clear confirmation before moving, so that I understand workspace-specific settings may be reset.
6. As a **User**, I want the moved **Coworker** to keep its name, description, username, prompt, model, status, trigger type, schedule, auto-approve setting, and user-input settings, so that the coworker remains recognizable.
7. As a **User**, I want the moved **Coworker** to keep its **Coworker Documents**, so that persistent reference material does not need to be uploaded again.
8. As a **User**, I want historical **Coworker Runs** to remain attached to the **Coworker**, so that I can still inspect what happened before the move.
9. As a **User**, I want the moved **Coworker** to appear in the target workspace's coworker list after the move, so that I can continue managing it there.
10. As a **User**, I want the moved **Coworker** to disappear from the source workspace's active coworker list, so that it has one clear workspace placement.
11. As a **User**, I want folder placement reset during the move, so that a source **Coworker Folder** is not referenced from another workspace.
12. As a **User**, I want workspace sharing reset during the move, so that the coworker is not automatically shared in the target workspace by accident.
13. As a **User**, I want selected workspace MCP servers cleared during the move, so that the moved **Coworker** does not reference **Workspace MCP Servers** from the source workspace.
14. As a **User**, I want the editor to show that the **Toolbox** may need review after the move, so that I can reselect target-workspace integrations when needed.
15. As a **User**, I want the **Builder Chat** to restart in the target workspace, so that future edits are based on target workspace context.
16. As a **User**, I want scheduled coworkers to keep their schedule after the move, so that time-based automation can continue after workspace-specific cleanup.
17. As a **User**, I want scheduled job registration to be refreshed after the move, so that automation runs against the new workspace placement.
18. As a **User**, I want invalid or unavailable target workspaces to be rejected, so that the **Coworker** cannot move into a workspace I cannot access.
19. As a **User**, I want moving to the current workspace to be treated as a no-op error, so that I do not think something changed when nothing changed.
20. As a **User**, I want a successful move to navigate me to the coworker editor in the target workspace, so that I can immediately verify and adjust settings.
21. As a **User**, I want failures to leave the **Coworker** unchanged, so that a partial move does not corrupt its placement.
22. As an **Internal User**, I want the same normal owner/member rule to cover this support need where possible, so that broad internal coworker movement is not required for the first version.
23. As a developer, I want the move behavior behind one small domain service, so that workspace cleanup rules are not duplicated across UI and routers.
24. As a developer, I want the move service to explicitly list which fields are preserved and reset, so that future changes do not accidentally leak workspace-scoped state.
25. As a developer, I want move authorization to be independent from current active-workspace selection where needed, so that the owner can move from the coworker's actual workspace to another membership workspace safely.
26. As a developer, I want the move to be transactional, so that the coworker is never visible in a half-moved state.
27. As a developer, I want Zero-backed coworker inventory to update from the database write, so that the source and target workspace views converge without a bespoke client cache path.

## Implementation Decisions

- Add a product action for moving a **Coworker** between workspaces.
- The first version is owner-only, not internal-admin-only.
- The acting **User** must be the **Coworker** owner.
- The acting **User** must be a member of the source workspace where the **Coworker** currently lives.
- The acting **User** must be a member of the target workspace.
- The target workspace must differ from the source workspace.
- The move does not change the **Coworker** owner.
- Owner reassignment is out of scope for the first version.
- The move keeps the **Coworker** id stable.
- The move keeps the **Coworker** profile fields that define the agent: name, description, username, prompt, model, auth source, status, trigger type, schedule, auto-approve, user-input configuration, allowed integrations, custom integration keys, and allowed skills.
- The move keeps **Coworker Documents** attached to the same **Coworker**.
- The move keeps **Coworker Runs** attached to the same **Coworker**.
- Historical **Coworker Run** workspace ids should remain historical source-workspace facts for existing run rows.
- The moved **Coworker** receives the target workspace id.
- The move resets folder placement by setting `folderId` to `null`.
- The move resets workspace sharing by setting `sharedAt` to `null`.
- The move clears selected **Workspace MCP Server** ids by setting the allowlist to an empty list.
- The move sets the **Builder Chat** reference to `null`.
- Existing builder conversation rows are not deleted by the move; they are simply detached from the moved **Coworker**.
- If the **Coworker** has a scheduled trigger, the scheduler registration is refreshed after the database transaction.
- If scheduler refresh fails after the database transaction, the API should return a clear failure state and log the operational error; implementation should prefer a path that can be retried safely.
- The move should be implemented as an imperative oRPC mutation, not a Zero mutator, because it has authorization checks and scheduler side effects.
- Zero remains the read data plane; coworker inventory updates should flow from the database write.
- The editor UI should show the move action only for a loaded **Coworker** owned by the current **User** when the user has at least one other workspace membership.
- The workspace picker should list only workspaces where the current **User** is a member.
- The confirmation copy should mention that folder placement, workspace sharing, selected workspace MCP servers, and builder chat context will be reset.
- After success, the client should invalidate coworker and workspace inventory caches as needed and switch to the target workspace before opening or refreshing the moved coworker.
- Deep module opportunity: extract a Coworker Workspace Move service that takes acting user id, coworker id, and target workspace id, then handles authorization, transactional updates, workspace-scoped cleanup, and scheduler reconciliation behind one interface.
- Deep module opportunity: extract a small presenter for move eligibility and confirmation copy, so the editor can stay thin and tests can cover user-visible behavior without duplicating service internals.
- No schema change is required for the first version.

## Testing Decisions

- Tests should assert external behavior: authorization outcomes, database-visible field changes, scheduler refresh behavior, and UI availability.
- Tests should not assert private helper names, local component state, or implementation-only branching.
- Service tests should verify an owner can move a **Coworker** when they are a member of both source and target workspaces.
- Service tests should verify a non-owner cannot move the **Coworker**.
- Service tests should verify a source non-member cannot move the **Coworker** even if they know its id.
- Service tests should verify a target non-member cannot move the **Coworker**.
- Service tests should verify moving to the same workspace is rejected.
- Service tests should verify a missing target workspace is rejected.
- Service tests should verify the move updates `workspaceId` and preserves `ownerId`.
- Service tests should verify `folderId`, `sharedAt`, selected **Workspace MCP Server** ids, and **Builder Chat** reference are reset.
- Service tests should verify **Coworker Documents** remain attached to the **Coworker**.
- Service tests should verify existing **Coworker Runs** remain attached to the **Coworker** and keep historical workspace ids.
- Service tests should verify scheduled coworkers trigger scheduler reconciliation after a successful move.
- Service tests should verify failures before the transactional update leave the **Coworker** unchanged.
- Router/API tests should verify the mutation uses authenticated user identity and returns clear forbidden, not-found, and bad-request errors.
- UI tests should verify the move control appears for owners with another workspace and is hidden or disabled otherwise.
- UI tests should verify the confirmation text names the reset workspace-scoped settings.
- UI tests should verify a successful move transitions the user to the target workspace's coworker editor or clearly prompts them to open the target workspace.
- Zero/read-model tests should verify the moved **Coworker** disappears from the source workspace inventory and appears in the target workspace inventory once the write is observed.
- Prior art exists in coworker router tests, coworker profile service tests, coworker folder tests, workspace membership/billing router tests, and Zero coworker inventory tests.
- After implementation, run targeted coworker move service tests, coworker router tests, Zero coworker mapping tests, and relevant editor UI tests.
- Run the repository check command after implementation.

## Out of Scope

- Internal users moving coworkers they do not own.
- Reassigning **Coworker** ownership during a move.
- Moving a **Coworker** into a workspace where the owner is not a member.
- Moving or merging source **Coworker Folders** into the target workspace.
- Preserving target folder placement during move.
- Preserving workspace sharing in the target workspace.
- Translating source **Workspace MCP Server** allowlists into target workspace server ids.
- Moving existing **Builder Chat** conversation history into the target workspace.
- Deleting detached builder conversations.
- Rewriting historical **Coworker Run** workspace ids.
- Adding a broad internal page that renders all coworkers across all workspaces.
- Adding an audit trail beyond existing product state and operational logs.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly from the agent.

## Further Notes

- This PRD deliberately chooses the simpler owner/member product behavior over an internal support-only workflow.
- The **Builder Chat** reference should be set to `null` during move.
- The implementation should keep the cleanup list explicit because most risk comes from silently carrying workspace-scoped state into the target workspace.
- Suggested Linear title: `Coworkers: move owned coworker between workspaces`.
- Suggested Linear team: `cmdlaw`.
- Suggested triage status: ready for implementation.
