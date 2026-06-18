# PRD: Coworker Folders Replace Tags

## Problem Statement

Users organize **Coworkers** from the coworkers page, but the current organization model still behaves like tag filtering. Tags let one **Coworker** appear in many groupings, while the desired model is closer to a folder browser: a **Coworker** is either inside one **Coworker Folder** or appears at the top level of the page.

The current tag and saved-view concepts make the page harder to reason about. They blur the difference between filtering and placement, and they do not support the intended visibility boundary where top-level folders can be private or workspace-visible. Users need a clear spatial model where folders and coworkers sit together, folder navigation is linkable, and workspace sharing is visible without requiring tags or saved filter views.

## Solution

Replace the coworkers page tag model with **Coworker Folders** as the primary organization model.

The coworkers page becomes a folder browser. At each level, users see immediate child **Coworker Folders** and immediate child **Coworkers** as siblings. The root `/agents` page represents top-level content. Opening a folder uses a stable folder ID route, such as `/agents/folders/$folderId`, with breadcrumbs rendered from folder names.

Tags and saved views are removed from the coworkers page and from the Coworker organization model. Existing tag data is deleted rather than migrated into folders, because many-to-many tags do not map safely to exclusive folder placement.

Top-level **Coworker Folders** define a visibility boundary. A top-level folder is private by default or can be workspace-visible. Nested folders inherit that top-level folder boundary silently. **Coworkers** inside a folder inherit the folder boundary; top-level **Coworkers** keep their own private/workspace sharing state. Moving a coworker or changing a top-level folder's visibility physically updates contained coworker sharing fields so existing access checks and workspace shared-coworker surfaces remain consistent.

## User Stories

1. As a User, I want the coworkers page to show folders and coworkers together, so that organization feels like a file browser rather than a filter bar.
2. As a User, I want a **Coworker** to be in exactly one **Coworker Folder** or at top level, so that I know where it lives.
3. As a User, I want top-level coworkers to remain visible on `/agents`, so that uncategorized coworkers are still easy to find.
4. As a User, I want top-level folders to appear alongside top-level coworker cards, so that folders are first-class page items.
5. As a User, I want nested folders, so that I can organize coworkers by team, workflow, customer, or project.
6. As a User, I want opening a folder to show only its immediate child folders and coworkers, so that navigation is predictable.
7. As a User, I want folder browsing to use URLs, so that refresh, back, forward, and copied links keep the same folder context.
8. As a User, I want folder URLs to use stable folder IDs, so that renaming or moving folders does not break links.
9. As a User, I want breadcrumbs to show folder names, so that ID-based URLs still feel readable.
10. As a User, I want to return from a folder to its parent, so that navigation stays simple.
11. As a User, I want global search across folders and coworkers, so that I can find something even when I do not remember where it lives.
12. As a User, I want folder search results to open that folder, so that I can jump directly to an organization area.
13. As a User, I want coworker search results to show path context, so that I understand where the coworker lives.
14. As a User, I want an empty search to return to the current folder's immediate children, so that search does not replace browsing.
15. As a User, I want trigger and shared filters to remain transient controls if useful, so that filtering does not become another saved organization model.
16. As a User, I do not want saved views on the coworkers page, so that the page has one organization model.
17. As a User, I do not want tags on coworker cards, so that old labels do not compete with folders.
18. As a User, I want existing tags to be removed rather than converted, so that ambiguous multi-tag coworkers are not placed into surprising folders.
19. As a User, I want creating a coworker inside a folder to place it in that folder by default, so that I do not need to move it afterward.
20. As a User, I want creating a coworker at top level to create a top-level coworker, so that the root page behaves naturally.
21. As a User, I want a folder card action to create a child folder, so that I can build nested organization.
22. As a User, I want top-level folder creation to default to private, so that sharing is deliberate.
23. As a User, I want top-level folder creation to allow workspace visibility, so that I can intentionally organize coworkers for the workspace.
24. As a User, I want nested folders to inherit visibility silently, so that I am not forced to reason about visibility at every level.
25. As a User, I want a private top-level folder to make all contained coworkers private, so that the folder boundary is meaningful.
26. As a User, I want a workspace top-level folder to make all contained coworkers workspace-visible, so that shared organization is clear.
27. As a User, I want moving a private coworker into a workspace folder to require confirmation, so that I do not accidentally share it.
28. As a User, I want moving a workspace-shared coworker into a private folder to require confirmation, so that I understand it will become private.
29. As a User, I want changing a top-level folder from private to workspace to require confirmation, so that I understand all contained coworkers become visible to the workspace.
30. As a User, I want changing a top-level folder from workspace to private to require confirmation, so that I understand contained coworkers will no longer be workspace-visible.
31. As a User, I want no mixed visibility inside one folder boundary, so that a folder marked private cannot contain workspace-visible exceptions.
32. As a User, I want top-level coworkers to keep a private/workspace sharing toggle, so that coworkers outside folders still have visibility control.
33. As a User, I do not want per-coworker share actions inside folders, so that the visibility boundary stays at the folder.
34. As a User, I want coworker cards inside folders to show inherited visibility status, so that I can understand why a coworker is private or workspace-visible.
35. As a User, I want top-level coworker cards to show their own visibility status, so that private and workspace-shared coworkers are distinguishable.
36. As a workspace member, I want workspace-visible folders to appear on my coworkers page, so that shared organization is available to the team.
37. As a workspace member, I want workspace-shared coworkers owned by teammates to appear in their workspace-visible folders, so that I can discover shared coworkers in context.
38. As a workspace member, I want actions on teammates' shared coworkers to be constrained, so that I cannot edit, move, delete, or unshare originals I do not own.
39. As a workspace member, I want private folders owned by other users to stay hidden, so that private organization remains private.
40. As a workspace member, I want folders with no visible descendant content to stay hidden unless I can manage them, so that the page does not show empty private gaps.
41. As a User, I want a "Move to folder" action for coworkers, so that I can reorganize without drag and drop.
42. As a User, I want a "Move to folder" action for folders, so that I can reorganize nested folder structure.
43. As a User, I want the move picker to include top level, so that I can remove a coworker or folder from a folder.
44. As a User, I want the move picker to show folders in a tree, so that nested destinations are understandable.
45. As a User, I want the current folder disabled as a move target, so that I cannot perform a no-op move.
46. As a User, I want descendant folders disabled when moving a folder, so that I cannot create a cycle.
47. As a User, I want deleting a folder not to delete coworkers, so that organization changes do not destroy work.
48. As a User, I want deleting a folder to move child coworkers and child folders up to the deleted folder's parent, so that contents remain reachable.
49. As a User, I want deleting a top-level folder to move its contents to top level, so that deletion is safe.
50. As a User, I want folder names to be unique where siblings would conflict, so that navigation and move destinations are clear.
51. As a User, I want my private top-level folder names not to collide with another user's private folders, so that each user can have their own organization.
52. As a workspace member, I want workspace top-level folder names to be unique within the workspace, so that shared organization is not ambiguous.
53. As a developer, I want folder visibility to have an explicit field, so that visibility is not inferred from a timestamp.
54. As a developer, I want private top-level folders to have an owner, so that access checks and uniqueness are precise.
55. As a developer, I want nested folder visibility to resolve from the top-level ancestor, so that visibility rules are consistent.
56. As a developer, I want contained coworkers' sharing fields updated when folder visibility changes, so that existing access checks stay correct.
57. As a developer, I want tag routers, tag components, tag read models, and tag assignments removed from the coworker organization path, so that stale abstractions do not linger.
58. As a developer, I want saved-view routers and UI removed from the coworkers page, so that there is no second grouping model.
59. As a developer, I want a focused folder domain module, so that ancestry, visibility, move, delete, and cycle rules are tested in one place.
60. As a developer, I want global folder search behind a stable interface, so that UI can evolve without rewriting search logic.

## Implementation Decisions

- **Coworker Folder** is the canonical organization concept for the coworkers page.
- A **Coworker** has exclusive placement: exactly one folder or top level.
- Top level is represented by the absence of a folder.
- **Coworker Folders** can contain child **Coworker Folders** and **Coworkers**.
- The folder browser shows immediate children only, not recursive descendants.
- `/agents` represents the top-level folder browser.
- Folder detail routes use stable folder IDs.
- Breadcrumbs are rendered from folder ancestry and names.
- Folder names are presentation, not route identity.
- Global search searches both folders and coworkers across the visible workspace inventory.
- Search results for folders navigate to the folder route.
- Search results for coworkers navigate to the coworker or reveal its containing folder, with path context in the result.
- Tags are removed from the coworkers page and from coworker organization.
- Existing tags and tag assignments are deleted rather than migrated into folders.
- Saved views are removed from the coworkers page.
- Saved view data is removed with the tag-era organization model.
- Transient search, trigger filtering, and shared filtering can remain, but they are not persisted as saved views.
- Create-coworker actions inside a folder default the new coworker to that folder.
- Create-coworker actions at top level create a top-level coworker.
- Moving coworkers and folders starts with an explicit "Move to folder" action and picker.
- Drag and drop is not part of the first implementation pass.
- The move picker includes top level and all visible valid folder destinations.
- Moving a folder into itself or any descendant is invalid.
- Deleting a folder does not delete contained coworkers.
- Deleting a folder moves direct child coworkers and child folders to the deleted folder's parent.
- Deleting a top-level folder moves its direct children to top level.
- Top-level folders choose a visibility boundary: `private` or `workspace`.
- Top-level folder creation defaults to `private`.
- Nested folders inherit visibility from their top-level ancestor.
- Nested folder create/edit flows do not need to surface visibility inheritance.
- A coworker inside a folder inherits the top-level folder visibility boundary.
- A top-level coworker keeps coworker-level visibility through its own private/workspace sharing state.
- No mixed visibility is allowed inside a folder boundary.
- Per-coworker share/unshare actions are hidden or disabled for coworkers inside folders.
- Top-level coworkers keep share/unshare actions.
- Moving a coworker across a visibility boundary updates its sharing state to match the destination.
- Moving a private coworker into a workspace folder requires confirmation.
- Moving a workspace-shared coworker into a private folder requires confirmation.
- Changing a top-level folder's visibility updates all contained coworkers' sharing fields to match.
- Changing a top-level folder's visibility requires confirmation because it can affect all descendants.
- Folder visibility should be explicit, using a durable field such as `private` or `workspace`.
- Private top-level folders have an owner.
- Workspace top-level folders are workspace-scoped and visible to workspace members.
- Private top-level folder uniqueness is scoped by workspace, owner, visibility, no parent, and name.
- Workspace top-level folder uniqueness is scoped by workspace, visibility, no parent, and name.
- Nested folder names are unique among siblings under the same parent.
- Workspace-visible folders and workspace-shared coworkers appear to workspace members.
- Teammate-owned shared coworker actions are constrained by existing ownership/share rules.
- Users cannot edit, move, delete, or unshare originals they do not own unless a future admin model explicitly allows it.
- Folder read APIs should return only folders the current user can see.
- A folder with no visible descendant content should be hidden from ordinary users unless they can manage folder structure.
- Deep module opportunity: extract a Coworker Folder domain module that resolves ancestry, root visibility boundary, allowed destinations, uniqueness, delete reparenting, and visibility propagation behind a stable interface.
- Deep module opportunity: extract a Coworker Folder access module that determines visible folders and contained coworker visibility for a user/workspace pair.
- Deep module opportunity: extract a Coworker Folder search module that produces global folder and coworker results with path context.
- Deep module opportunity: extract a Coworker Inventory presenter that takes folders, coworkers, current folder, search query, and current user authority, then returns the page's card model.
- Existing coworker sharing behavior remains available for top-level coworkers, but folder-contained coworkers are governed by their folder boundary.
- No ADR is required yet. The main product decision is recorded in the glossary, and the route-ID choice is conventional and reversible.
- If implementation uncovers hard-to-reverse permission or ownership trade-offs beyond this PRD, create an ADR then.

## Testing Decisions

- Tests should assert external behavior: visible folders and coworkers, route-safe folder lookups, move outcomes, sharing state changes, delete reparenting, search results, and UI actions.
- Tests should not assert private helper structure, internal tree maps, or implementation-only traversal details.
- Coworker Folder domain tests should cover root folder creation, nested folder creation, name normalization, sibling uniqueness, private/workspace uniqueness scopes, ancestry resolution, invalid parent IDs, and cycle prevention.
- Coworker Folder visibility tests should cover private top-level folders, workspace top-level folders, nested inheritance, moving coworkers into workspace folders, moving coworkers into private folders, and changing top-level folder visibility.
- Coworker Folder delete tests should cover deleting a nested folder, deleting a top-level folder, preserving coworkers, moving children to the parent, and preserving visibility consistency after reparenting.
- Coworker Folder move tests should cover moving a folder to top level, moving a folder under another folder, rejecting self moves, rejecting descendant moves, moving coworkers to folders, and moving coworkers to top level.
- Coworker sharing tests should verify top-level coworkers can still be shared and unshared.
- Coworker sharing tests should verify folder-contained coworkers do not expose independent share/unshare actions.
- Coworker sharing tests should verify moving across folder boundaries physically updates the coworker's sharing field.
- Coworker inventory read tests should verify `/agents` shows top-level folders and top-level coworkers.
- Coworker inventory read tests should verify folder routes show only immediate child folders and coworkers.
- Coworker inventory read tests should verify workspace members see workspace-visible folders and shared coworkers but not private folders owned by others.
- Coworker inventory read tests should verify teammate-owned shared coworkers have constrained actions.
- Search tests should verify global matching for folder names, coworker names, and coworker descriptions.
- Search tests should verify result path context for nested folders and coworkers.
- Search tests should verify empty search returns to the current folder browser.
- Router/API tests should verify authorization, workspace scoping, invalid folder IDs, not-found folder routes, and move/delete error states.
- UI tests should verify folder cards and coworker cards appear together at the same level.
- UI tests should verify breadcrumbs, opening folders, parent navigation, create-folder, create-coworker-in-folder, move dialog, delete confirmation, and visibility confirmations.
- UI tests should verify tags, tag chips, tag badges, tag picker, and saved-view tabs are absent from the coworkers page.
- Migration/schema tests should verify tag and saved-view tables or relations are removed consistently where applicable.
- Zero/read-model tests should verify folders and coworker folder placement map correctly into the client inventory model.
- Prior art exists in coworker router tests, coworker catalog tests, Zero coworker data tests, coworker card/component tests, and folder router code.
- After implementation, run targeted coworker folder/domain tests, Zero mapping tests, coworker router/API tests, and coworker page UI tests.
- Because this includes schema changes, run the database push workflow expected by the repo before validating the app locally.
- Run the repository check command after implementation, and broaden to the full test rail if shared access or schema behavior changes significantly.

## Out of Scope

- Drag and drop folder/coworker movement.
- Pretty folder path URLs.
- Migrating existing tags into folders.
- Keeping saved views as a smart views feature.
- Per-nested-folder visibility overrides.
- Mixed private and workspace-visible coworkers inside one folder boundary.
- Independent share/unshare actions for folder-contained coworkers.
- Recursive folder views that show all descendants at once.
- Folder-level role management beyond private versus workspace visibility.
- Workspace admin overrides for editing, moving, or deleting coworker originals owned by teammates.
- Audit trail work beyond existing persisted state changes.
- Reworking **Coworker Run**, **Run History**, **Builder Chat**, **Toolbox**, or **Coworker Document** behavior.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly from the agent.

## Further Notes

- The glossary now defines **Coworker Folder**, **Private Coworker Folder**, and **Workspace Coworker Folder**.
- Current implementation already has folder storage and coworker `folderId`, but lacks the full folder-first page behavior and private/workspace folder visibility boundary.
- Current implementation still exposes tags and saved views through router, read-model, and UI surfaces; those are intentionally removed by this PRD.
- Current implementation uses coworker-level `sharedAt` for workspace sharing. The first implementation pass should preserve this for top-level coworkers and denormalize inherited folder visibility into coworker sharing fields for contained coworkers.
- Suggested Linear title: `Coworkers: replace tags with folders`.
- Suggested Linear team: `cmdlaw`.
- Suggested triage status: ready for implementation.
