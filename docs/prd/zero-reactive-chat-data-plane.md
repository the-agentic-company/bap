# Zero Reactive Chat Data Plane

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

CmdClaw's web chat and coworker surfaces feel slower than they should because core lists still depend on request/response reads and React Query invalidation for data that users expect to appear instantly. The recent chat list, conversation existence checks, persisted conversation messages, coworker list, **Coworker** run list, coworker folders, and coworker tags are central to the app's perceived speed: if those surfaces wait on network round trips or manual refetch timing, the app does not feel like a local-first agent workspace.

The user wants CmdClaw to adopt Rocicorp Zero so the web app has a faster, Linear-style local reactive feel. The desired direction is already captured in ADR-0012: Zero becomes the web reactive **data plane** for an explicitly scoped table slice, while oRPC remains the **control plane** for imperative, secret-bearing, and long-running actions.

The immediate implementation should be a real vertical slice, not only Docker wiring. The first slice should make the chat and coworker inventory experience measurably more local and reactive while preserving the existing **Generation** stream model, Better Auth session model, oRPC writes, and security boundaries around sensitive runtime state.

## Solution

Add Zero to the local development stack and migrate the first chat and coworker inventory read paths to Zero-backed local reactive reads. The vertical slice should cover recent chat conversations, persisted conversation messages, the coworker list, **Coworker** run list, coworker folders, coworker tags, and coworker tag assignments for authenticated Users in the active workspace. The browser should keep a synced local replica in IndexedDB so recent conversations, coworkers, runs, folders, and tags render quickly and update reactively as Postgres changes.

The implementation should add `zero-cache` to the local Docker Compose stack, enable logical replication in local Postgres, define a narrow audited Zero schema for the initial synced slice, expose a Zero query endpoint from the web app, wrap authenticated app routes in a Zero client provider, and switch the chat and coworker inventory read hooks to use Zero for the recent chat list, individual conversation reads, coworker list reads, run list reads, folder reads, and tag reads.

Zero must not replace oRPC as the command path. Starting **Generations**, generation queueing, approval/auth actions, integrations, OAuth, provider credentials, sandbox control, billing, and file downloads remain on oRPC or existing HTTP endpoints. Live **Generation** detail remains on the existing SSE + Redis stream. The `generation` table is not synced.

Long term, production auth should follow ADR-0012: a short-lived Better Auth-backed JWT carrying user identity only, with workspace authorization resolved live from the replicated `workspaceMember` table. If the first local slice uses existing same-site session cookies to validate the Zero query endpoint, that is only a development bridge and must not become an undocumented production auth design.

## User Stories

1. As a CmdClaw User, I want the recent chat list to appear immediately after opening the app, so that CmdClaw feels fast.
2. As a CmdClaw User, I want recent chat rows to update reactively when titles, pinned state, status, or message counts change, so that the sidebar does not feel stale.
3. As a CmdClaw User, I want opening a recent conversation to render persisted messages from local synced state, so that returning to a conversation feels instant.
4. As a CmdClaw User, I want new persisted messages to appear without manually refreshing, so that finished **Generations** show up naturally.
5. As a CmdClaw User, I want the chat list to keep working after a brief network interruption, so that local state still makes the app usable.
6. As a CmdClaw User, I want synced chat data to be stored locally in my browser, so that the app can feel local-first for recent work.
7. As a CmdClaw User, I want local synced data to be scoped to my authenticated identity, so that another User on the same browser does not see my replica.
8. As a CmdClaw User, I want logging out or switching users to clear or isolate the local chat replica, so that data does not cross account boundaries.
9. As a CmdClaw User, I want the active chat route to continue showing "Conversation not found" only when I genuinely cannot access that conversation, so that access errors remain clear.
10. As a CmdClaw User, I want conversation rename and pin actions to continue working, so that adopting Zero does not remove existing chat controls.
11. As a CmdClaw User, I want delete/archive actions to continue working, so that the recent chat list stays manageable.
12. As a CmdClaw User, I want read/unread state to continue working, so that I can identify conversations with unseen results.
13. As a CmdClaw User, I want chat copy/share controls to keep working, so that existing collaboration flows are preserved.
14. As a CmdClaw User, I want active **Generation** streaming to remain token-granular, so that in-progress model output does not regress.
15. As a CmdClaw User, I want approvals and authentication waits to keep using the existing live runtime flow, so that interactive **Generations** still work.
16. As a CmdClaw User, I want queued messages to continue using the existing queue behavior, so that sending follow-up instructions during a run remains reliable.
17. As a CmdClaw User, I want the coworker list to appear immediately after opening the coworker area, so that managing coworkers feels fast.
18. As a CmdClaw User, I want coworker names, descriptions, status, pinned state, and basic trigger metadata to update reactively, so that the coworker list reflects current workspace state.
19. As a CmdClaw User, I want coworker list reads to use the same local synced feel as recent chats, so that the main app surfaces are consistent.
20. As a CmdClaw User, I want coworker folders to update reactively, so that organizing coworkers feels instant.
21. As a CmdClaw User, I want coworker tags and tag assignments to update reactively, so that filtering and scanning coworkers stays current.
22. As a CmdClaw User, I want the **Coworker** run list to update reactively, so that I can see recent run status changes without manual refresh.
23. As a CmdClaw User, I want run list rows to show safe summary fields such as status, timestamps, coworker identity, and conversation links, so that I can navigate runs without exposing sensitive runtime details.
24. As a CmdClaw User, I want coworker creation, editing, triggering, folder/tag mutations, and run detail actions to keep using existing reliable flows, so that Zero adoption does not change command semantics.
25. As a workspace member, I want losing workspace membership to remove my access quickly, so that workspace data is not exposed through stale local auth.
26. As a workspace admin, I want workspace membership changes to govern Zero reads, so that Zero follows the same workspace access model as oRPC.
27. As a developer, I want a real Zero vertical slice in chat, coworker list, run list, folder, and tag reads, so that the implementation validates the product path rather than only infrastructure.
28. As a developer, I want `zero-cache` in local Docker Compose, so that local development exercises the same sync engine shape as production.
29. As a developer, I want local Postgres to run with logical replication enabled, so that Zero CDC works in the default local stack.
30. As a developer, I want the Zero schema to be an explicit allowlist, so that sensitive columns and tables are not accidentally exposed.
31. As a developer, I want the Zero schema to align with the existing Drizzle schema, so that table and column drift is caught early.
32. As a developer, I want the synced table set to start small, so that the first slice is reviewable and safe.
33. As a developer, I want the chat and coworker inventory read hooks to have small stable interfaces, so that components do not depend on Zero internals.
34. As a developer, I want deep modules that map Zero rows into existing chat, coworker list, run list, folder, and tag view models, so that UI components can remain mostly unchanged.
35. As a developer, I want oRPC mutations to stay in place for the first slice, so that read migration does not become a write semantics rewrite.
36. As a developer, I want Zero custom mutators deferred until the read path is validated, so that optimistic write behavior is introduced deliberately.
37. As a developer, I want no `generation` sync, so that `pendingAuth`, debug data, sandbox ids, and other sensitive runtime state cannot leak.
38. As a developer, I want live **Generation** details to stay on SSE + Redis, so that high-frequency streaming is not pushed through logical replication.
39. As a developer, I want sensitive file storage keys to stay out of Zero, so that local replicas contain only approved product data.
40. As a developer, I want attachment and sandbox file display to use an audited metadata-only shape or remain on existing APIs, so that file rendering does not force sensitive table sync.
41. As a developer, I want the first slice to preserve current route URLs, so that Zero adoption is invisible to routing.
42. As a developer, I want Zero setup documented in local Docker docs, so that other agents can run the stack.
43. As a developer, I want the local stack restart command to be verified after Compose changes, so that `zero-cache` actually starts.
44. As an operator, I want production plans to keep Postgres on Render if logical replication is available, so that Zero does not require a database migration.
45. As an operator, I want `zero-cache` treated as a stateful service with persistent storage, so that the sync engine is operated deliberately.
46. As an operator, I want Zero health and logs visible in the local stack, so that sync failures can be diagnosed.
47. As a reviewer, I want tests around authorization and data shape, so that synced rows cannot accidentally expose sensitive fields.
48. As a reviewer, I want tests around chat and coworker inventory read behavior, so that the user-facing vertical slice is proven rather than only typechecked.

## Implementation Decisions

- Follow ADR-0012, **Adopt Rocicorp Zero as the reactive data plane for web**.
- Scope this PRD to the web application and the local Docker Compose development stack.
- Implement a real first vertical slice for chat and coworker inventory reads: recent chat list, individual conversation persisted message reads, coworker list, **Coworker** run list, coworker folders, coworker tags, and tag assignments.
- Keep native Apple clients on oRPC; Zero is web-only.
- Keep oRPC as the **control plane** for imperative operations.
- Keep Zero as the **data plane** for selected reactive reads.
- Do not route live **Generation** token streaming through Zero.
- Do not sync the `generation` table.
- Do not sync secrets, provider tokens, OAuth state, sandbox control state, debug payloads, or raw diagnostic data.
- Add `zero-cache` to the local Compose stack.
- Enable logical replication for the local Postgres container by configuring `wal_level=logical`.
- Add a persistent local volume for `zero-cache` state.
- Expose a local Zero cache URL for browser development.
- Add local environment variables only where required for Zero cache URL and server query endpoint configuration.
- Keep environment additions minimal and document them; do not add feature flags unless needed.
- Add a narrow Zero schema for the first synced slice.
- The initial synced chat slice includes conversation rows needed for the recent chat list and conversation shell.
- The initial synced message slice includes persisted user and assistant messages needed to render the chat transcript.
- The initial synced coworker slice includes coworker rows needed for the workspace coworker list.
- The initial synced **Coworker** run slice includes run rows needed for run lists and recent run summaries.
- The initial synced folder slice includes coworker folder rows needed for coworker organization views.
- The initial synced tag slice includes coworker tag rows and tag assignment rows needed for coworker filtering, labels, and list decoration.
- Coworker list reads are limited to coworkers visible to the authenticated User in the active workspace.
- **Coworker** run reads are limited to runs visible to the authenticated User in the active workspace.
- Folder, tag, and tag assignment reads are limited to the authenticated User's active workspace.
- Coworker list rows should expose only list-safe fields such as identity, name, description, status, trigger type, model, pinned state, basic timestamps, and non-secret display metadata.
- Coworker list rows must not expose run debug data, document storage keys, provider credentials, or secret-bearing integration configuration.
- **Coworker** run rows should expose only list-safe fields such as identity, coworker id, status, conversation id, generation id as an opaque navigation key, started timestamp, finished timestamp, and bounded display metadata.
- **Coworker** run rows must not expose trigger payloads, debug info, raw errors, document contents, storage keys, provider credentials, or other secret-bearing runtime details.
- Folder rows should expose only identity, workspace id, parent id, name, position, and timestamps.
- Tag rows should expose only identity, workspace id, name, color, and timestamps.
- Tag assignment rows should expose only coworker id, tag id, and creation timestamp.
- `workspaceMember` is included for permission checks, not as a user-visible table.
- Conversation reads are limited to the authenticated User's active workspace, chat conversations, non-archived conversations, and non-synthetic conversations.
- Message reads are limited through accessible conversations.
- Recent chat and **Coworker** run sync should use bounded working sets rather than unbounded history.
- The working set should favor recent conversations and recent runs, and cap row volume.
- Older chat history pagination is allowed to remain on the existing path until a follow-up Zero query is designed.
- Older **Coworker** run history pagination is allowed to remain on the existing path until a follow-up Zero query is designed.
- Attachment and sandbox file metadata must not sync by including existing sensitive file tables wholesale.
- If attachment or sandbox file rendering is included in the first slice, expose only a metadata-only audited shape that excludes storage keys and other sensitive fields.
- Otherwise, preserve existing attachment and sandbox file behavior through current API paths while the Zero message slice handles text and structured content.
- Add a Zero query endpoint in the web app.
- The query endpoint must authenticate the request through server-validated Better Auth context.
- The query endpoint must derive User identity from server auth, not from client-supplied IDs.
- Production auth target is short-lived Better Auth-backed JWT as described in ADR-0012.
- Same-site cookie validation is acceptable only as a local vertical-slice bridge if it is simpler and explicitly documented.
- Workspace authorization must be resolved live from workspace membership, so removing a workspace member invalidates access without waiting for a long token TTL.
- Add a Zero client provider around authenticated product routes.
- The provider must use a per-User storage identity so local IndexedDB state is isolated by User.
- The provider must clear or recreate Zero state when the authenticated principal changes.
- Create a deep chat data adapter module that maps Zero rows into the existing conversation list and conversation detail view models.
- Create a deep coworker inventory data adapter module that maps Zero coworker, run, folder, tag, and tag-assignment rows into the existing coworker list, run list, folder, and tag view models.
- Keep UI components insulated from raw Zero query shapes where practical.
- Replace the recent chat list read hook with a Zero-backed hook for the first working set.
- Replace the individual conversation read hook with a Zero-backed hook for fields and messages covered by the first slice.
- Replace the coworker list read hook with a Zero-backed hook for fields covered by the first slice.
- Replace **Coworker** run list hooks with Zero-backed hooks for list-safe fields covered by the first slice.
- Replace coworker folder and tag list hooks with Zero-backed hooks for fields covered by the first slice.
- Preserve existing oRPC mutation hooks for rename, pin, mark seen, mark all seen, delete/archive, share/unshare, auto-approve, and usage in this first slice.
- Preserve existing oRPC mutation hooks for coworker create, edit, delete, trigger, folder/tag management, document handling, and run operations in this first slice.
- Invalidate or let Zero replication update read surfaces after oRPC writes; do not maintain a long-lived dual read path.
- Keep **Generation** start, enqueue, approval, auth result, cancel, active-generation reads, queued-message reads, coworker run detail reads, coworker run execution, and coworker trigger execution on the existing oRPC/SSE/Redis paths.
- Preserve existing chat route behavior and OAuth completion handling.
- Preserve existing mobile recent drawer behavior while switching its chat list data source.
- Document Zero local stack startup and restart commands in Docker docs.
- Restart the local Compose stack after Docker changes and verify Postgres, Redis, and `zero-cache` are healthy.
- Run database schema push only if schema changes are made.

## Testing Decisions

- Tests should assert user-visible behavior and authorization boundaries, not Zero implementation details.
- A good test for this PRD proves that authenticated Users see the right recent conversations, messages, coworkers, runs, folders, and tags, and unauthorized Users do not.
- A good test does not reimplement the Zero query filters in the assertion logic.
- Add tests for the chat data adapter module, using representative Zero row shapes and asserting existing view model output.
- Add tests for the coworker inventory data adapter module, using representative Zero row shapes and asserting existing view model output for coworker lists, run lists, folders, tags, and tag assignments.
- Add tests for conversation filtering: active workspace only, current User only, chat type only, non-archived only, and non-synthetic only.
- Add tests for message filtering: user and assistant messages are included, system/tool-only records are excluded where the existing chat UI excludes them.
- Add tests for ordering: pinned conversations before unpinned conversations, then updated time descending, then id tie-breaker where applicable.
- Add tests for message ordering by creation time.
- Add tests proving sensitive columns are absent from the Zero-facing shape.
- Add tests proving `generation` data is not exposed through the Zero schema or query layer.
- Add tests proving `workspaceMember` is used for access but is not rendered as product data.
- Add tests for coworker list filtering: active workspace only, visible coworker rows only, and list-safe field shape only.
- Add tests for **Coworker** run list filtering: active workspace only, visible run rows only, bounded working set only, and list-safe field shape only.
- Add tests for folder, tag, and tag assignment filtering: active workspace only and safe field shape only.
- Add tests for principal changes causing local read state isolation or reset.
- Add component-level tests for recent chat sidebar behavior using the new hook interface.
- Add component-level tests for mobile recent drawer chat behavior using the new hook interface.
- Add component-level tests for coworker list behavior using the new hook interface.
- Add component-level tests for **Coworker** run list behavior using the new hook interface.
- Add component-level tests for folder and tag rendering/filtering behavior using the new hook interface.
- Add route or handler tests for the Zero query endpoint authentication behavior.
- Add a local integration smoke check for `zero-cache` startup after Docker Compose changes.
- Add a manual verification path that starts the local stack, starts web dev, logs in, opens recent chats, starts a chat, opens the coworker list, opens run/folder/tag views, and observes the conversation list, message transcript, coworker list, run list, folders, and tags updating.
- Existing chat-area tests are prior art for chat transcript behavior.
- Existing conversation router tests are prior art for authorization and conversation filtering.
- Existing coworker router and coworker page tests are prior art for coworker authorization and list behavior.
- Existing route/API handler tests are prior art for standard `Request -> Response` endpoint behavior.
- Existing Docker/worktree tests are prior art for local stack configuration where applicable.
- Required verification should include `bun run --cwd apps/web check`.
- If Docker Compose is changed, required verification should include `docker compose --env-file .env -f docker/compose/dev.yml up -d --remove-orphans` or the equivalent worktree command, followed by service health checks.
- If the chat or coworker inventory UI is changed materially, browser verification should open the authenticated chat route and coworker routes, then inspect the recent chat list, message transcript, coworker list, run list, folders, and tags.

## Out of Scope

- Replacing oRPC as CmdClaw's control plane.
- Moving **Generation** streaming from SSE + Redis to Zero.
- Syncing the `generation` table.
- Syncing provider tokens, OAuth credentials, sandbox ids, pending auth/debug data, raw diagnostic data, file storage keys, or other sensitive runtime state.
- Implementing every ADR-0012 synced surface in one PR beyond chat reads, coworker list reads, **Coworker** run list reads, folder reads, and tag reads.
- Migrating coworker editor detail reads, full **Coworker** run history, or **Coworker** run detail reads in the first slice.
- Implementing Zero custom mutators for optimistic writes in the first read slice.
- Reworking chat generation start, queue, approval, auth, cancel, or active generation behavior.
- Replacing file download endpoints.
- Adding production Render service definitions unless explicitly included in a later deployment PR.
- Migrating Postgres away from Render.
- Solving Render logical replication production verification beyond documenting the required spike.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly.
- Broad frontend redesign.
- Broad route or TanStack Start migration work unrelated to Zero.

## Further Notes

- The user explicitly chose a real vertical slice, accepted IndexedDB local persistence as the goal, and approved Docker Compose restart/configuration changes for Zero and logical Postgres WAL.
- The user was unsure about auth best practice. The PRD follows ADR-0012 for long-term auth: short-lived Better Auth-backed JWT carrying User identity only, with workspace access resolved live through `workspaceMember`.
- A cookie-authenticated local bridge can be acceptable for the first development slice if it avoids premature Better Auth plugin/schema work, but it should be documented and not treated as the final production auth design.
- Zero's lack of column-level permissions makes the schema audit critical. Do not sync a table just because the UI needs one non-sensitive column from it.
- If existing tables contain sensitive columns needed only for server-side operations, create or use an audited metadata-only shape before syncing that data to clients.
- `zero-cache` is stateful infrastructure. Even for local development, it should be treated as part of the app's runtime topology rather than a transient helper script.
- This PRD intentionally starts with chat plus coworker inventory because recent conversations, persisted messages, coworkers, runs, folders, and tags are the highest-signal paths for perceived app speed.
