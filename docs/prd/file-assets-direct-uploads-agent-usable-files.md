## Problem Statement

Users need to attach larger files to chats, **Coworkers**, skills, and generated outputs without Bap silently dropping files, pushing bytes through base64 payloads, or duplicating storage behavior across product areas. The current file paths are fragmented across **Message Attachments**, **Coworker Documents**, skill documents, and **Sandbox Files**, each carrying storage metadata directly and relying on small in-process upload flows that do not scale to large files.

As Bap moves toward larger files and future mounted runtime filesystems, the product needs one durable model for agent-usable files. Users should experience simple file handling: choose a file, wait until it is ready, then use it. Engineers should have one storage identity, one quota model, one cleanup model, and one runtime staging contract.

## Solution

Introduce **File Assets** as the shared storage identity for durable agent-usable files across Bap. **Message Attachments**, **Coworker Documents**, **Skill Documents**, and **Sandbox Files** reference **File Assets** instead of carrying private storage keys or bytes directly.

Browser uploads use short-lived **Upload Sessions** that authorize direct-to-object-storage transfer. A completed **Upload Session** creates a **Ready File Asset**. Drafts can attach only **Ready File Assets**, and send actions remain disabled while attached files are uploading or failed. When a **Generation** starts, Bap makes every required **File Asset** available at stable Bap-owned runtime filesystem paths before prompting the agent.

The first version supports 1 GB **File Assets**, 10 files per message, 2 GB total attached bytes per message, 20 active **Upload Sessions** per **User**, and a 100 GB workspace **File Asset** quota. The quota includes **Ready File Assets** and active **Upload Session** reservations.

## User Stories

1. As a **User**, I want to attach files larger than 10 MB to a message, so that I can give an agent realistic business documents, exports, archives, and logs.
2. As a **User**, I want Bap to show upload progress before I send, so that I know whether my file is ready.
3. As a **User**, I want the send button to be disabled while attached files are still uploading, so that I do not start a **Generation** with missing files.
4. As a **User**, I want failed uploads to be visible in the draft, so that I can remove or retry them before sending.
5. As a **User**, I want a completed upload to automatically attach to my current draft, so that drag-and-drop feels like one action.
6. As a **User**, I want Bap to accept files with the same filename multiple times, so that replacing or re-uploading common filenames does not fail.
7. As a **User**, I want filenames with spaces and non-ASCII characters to display as I provided them, so that uploaded files remain recognizable.
8. As a **User**, I want Bap to avoid silently ignoring oversized files, so that upload problems are clear.
9. As a **User**, I want a message with multiple files to preserve each file independently, so that historical conversation context stays accurate.
10. As a **User**, I want messages to keep showing the files originally attached to them, so that later replacements elsewhere do not rewrite history.
11. As a **User**, I want to upload up to 10 files in one message, so that multi-document tasks do not require many separate turns.
12. As a **User**, I want Bap to reject too many or too-large files before I send, so that failures happen early and clearly.
13. As a **User**, I want Bap to support up to 1 GB per **File Asset**, so that large real-world documents and archives can be used.
14. As a **User**, I want Bap to enforce a total attached byte limit per message, so that a single **Generation** does not become unusably slow to start.
15. As a **User**, I want uploaded-but-unused files to disappear automatically after a grace period, so that abandoned drafts do not consume storage forever.
16. As a **User**, I want normal file downloads to start from Bap and then download efficiently, so that large files do not make the app slow.
17. As a **User**, I want download links to expire quickly, so that copied private links do not remain valid indefinitely.
18. As a **User**, I want a **Coworker Document** to be replaceable with a new file that has the same filename, so that maintaining reference material is straightforward.
19. As a **User**, I want replacing a **Coworker Document** to keep the same document slot in the UI, so that I do not lose context or ordering.
20. As a **User**, I want deleting a **Coworker Document** not to break an older message that used the same underlying file, so that reuse is safe.
21. As a **User**, I want **Coworker Documents** to be available to future **Coworker** **Generations**, so that persistent reference material still works.
22. As a **User**, I want **Skill Documents** to use the same file behavior as other agent-usable files, so that skill reference material is handled consistently.
23. As a **User**, I want generated **Sandbox Files** to keep appearing in conversations, so that agent outputs remain downloadable and visible.
24. As a **User**, I want **Sandbox Files** to use the same quota and cleanup model as other agent-usable files, so that workspace storage is predictable.
25. As a **User**, I do not want a global Files library as part of this redesign, so that file handling stays attached to messages, **Coworkers**, skills, and generated outputs.
26. As a workspace member, I want private conversation files to stay private to the product relationship that grants access, so that workspace ownership does not imply a flat workspace file library.
27. As a workspace admin, I want workspace-level storage quota enforcement, so that large files cannot grow storage without bound.
28. As a workspace admin, I want active uploads to reserve quota while they are in progress, so that incomplete uploads cannot bypass quota.
29. As an operator, I want incomplete **Upload Sessions** to expire, so that abandoned uploads are cleaned up.
30. As an operator, I want partial object-storage uploads to be aborted or deleted after expiry, so that storage cost does not drift.
31. As an operator, I want hard deletion of file bytes to happen asynchronously, so that user actions do not block on object storage.
32. As an operator, I want file cleanup to avoid deleting bytes used by an active **Generation**, so that running agents do not lose files mid-run.
33. As an operator, I want storage keys to be opaque and filename-independent, so that storage paths do not leak sensitive filenames or collide.
34. As an operator, I want storage keys to live only on **File Assets**, so that storage infrastructure is centralized.
35. As an operator, I want signed upload URLs to be short-lived and session-scoped, so that leaked upload URLs have limited use.
36. As an operator, I want signed download URLs to be generated only on demand, so that stale links are not stored.
37. As an operator, I want object storage to serve large downloads directly after Bap authorization, so that app servers do not stream 1 GB files.
38. As an operator, I want special inline rendering cases to remain app-controlled when needed, so that sensitive rendered outputs keep their existing safety boundary.
39. As an engineer, I want one **File Asset** service, so that quota, storage keys, readiness, cleanup, and download authorization are implemented once.
40. As an engineer, I want product tables to reference **File Assets** by id, so that product concepts do not duplicate storage metadata.
41. As an engineer, I want **File Assets** to be immutable after upload, so that historical references and replacements are easy to reason about.
42. As an engineer, I want product relationships to be mutable where appropriate, so that replacing a **Coworker Document** or **Skill Document** points to a new **File Asset** without mutating old bytes.
43. As an engineer, I want **Message Attachments** to be historical, so that sent messages are not rewritten by later file replacement.
44. As an engineer, I want old file-bearing rows to be backfilled to **File Assets**, so that existing conversations, **Coworkers**, skills, and generated outputs survive migration.
45. As an engineer, I want legacy storage fields removed after cutover, so that the codebase does not keep two long-term storage models.
46. As an engineer, I want product mutation APIs to accept **Ready File Asset** ids instead of bytes, so that queues and RPC payloads stay small.
47. As an engineer, I want queued messages to store file ids rather than `dataUrl` payloads, so that queue rows do not carry large bytes.
48. As an engineer, I want browser uploads to avoid base64, so that large files do not multiply memory and request size.
49. As an engineer, I want server-created files to still create **File Assets** internally, so that generated files use the same storage identity.
50. As an engineer, I want MCP base64 transport to remain unchanged for this project, so that external tool compatibility is not accidentally broken.
51. As an engineer, I want MCP-created durable files to align with **File Assets** internally when touched by this work, so that the storage model stays unified.
52. As an engineer, I want runtime-visible paths to be Bap-owned logical paths, so that copy-based staging today and mounted storage later share the same agent contract.
53. As an engineer, I want all required **File Assets** available before the **Generation** prompt starts, so that the agent never sees a half-ready file.
54. As an engineer, I want the runtime staging contract to avoid raw object-storage paths, so that agents do not depend on infrastructure details.
55. As an engineer, I want the File Asset model to support future mounted skill directories, so that current upload work does not block that runtime direction.
56. As an engineer, I want **File Asset** metadata excluded from broad local sync by default, so that storage keys and sensitive file state do not leak.
57. As an engineer, I want any future synced file metadata to use an audited safe shape, so that reactive reads do not expose private storage details.
58. As an engineer, I want checksums or storage integrity signals recorded when practical, so that future integrity checks and deduplication remain possible.
59. As an engineer, I do not want automatic deduplication in v1, so that permissions, deletion, and audit behavior stay simple.
60. As an engineer, I want no **File Asset** rename in v1, so that filename semantics remain upload-time metadata.

## Implementation Decisions

- Follow ADR-0016, **File Assets for Agent-Usable Files**.
- Use **File Assets** as the shared storage identity for durable agent-usable files.
- Scope durable agent-usable files to **Message Attachments**, **Coworker Documents**, **Skill Documents**, and **Sandbox Files**.
- Keep profile images, workspace images, and bug report attachments outside the **File Asset** model for this project.
- Introduce an **Upload Session** model for browser-created **File Assets**.
- A completed **Upload Session** creates a **Ready File Asset** before it is attached to a product concept.
- Abandoned **Upload Sessions** expire and do not become product-visible files.
- Browser uploads transfer bytes directly to object storage through Bap-authorized, short-lived upload instructions.
- The Bap app remains the authorization authority for upload creation and completion.
- Upload URL details are implementation details behind the **Upload Session** contract.
- Product mutation APIs reference **Ready File Assets** by id and do not accept browser-provided bytes or `dataUrl` payloads.
- The user-facing draft model automatically attaches the resulting **Ready File Asset** when a browser upload completes.
- A draft with attached uploading or failed files cannot be sent until those files are ready, retried successfully, or removed.
- **File Assets** are workspace-scoped and record their creating **User**.
- **File Asset** access is derived through the product concept that references the **File Asset**, not from a global workspace file library.
- Do not introduce a user-facing global Files library in this redesign.
- **File Assets** are immutable after upload.
- Filenames are display metadata, not identity.
- Multiple **File Assets** can share the same filename.
- Preserve original display filenames where possible, including spaces and non-ASCII characters.
- Sanitize and deduplicate only storage/runtime paths.
- Storage keys are opaque and based on Bap identity, not user filenames.
- Storage keys live only on **File Assets** after migration.
- Product relationship tables store `file_asset_id` rather than storage keys.
- **Message Attachments** point to **File Assets** and are historical.
- **Coworker Documents** point to **File Assets** and may keep their product identity while replacement changes the referenced **File Asset**.
- **Skill Documents** use the same relationship pattern as **Coworker Documents** where replacement is supported.
- **Sandbox Files** point to **File Assets** while preserving existing generated-output behavior.
- Existing generated **Sandbox File** behavior, including special **Agentic-App** handling, remains unchanged except for storage identity.
- Runtime-generated **Sandbox Files** do not use browser **Upload Sessions** in this project; server/runtime collection creates **File Assets** internally.
- Keep the current MCP base64 upload transport out of scope.
- If an unchanged MCP path creates or updates durable agent-usable files touched by this project, it should create **File Assets** internally without changing the external MCP contract.
- Backfill existing file-bearing product rows into **File Assets**.
- Run the legacy data move with `bun run --cwd apps/web file-assets:backfill --dry-run` first, then `bun run --cwd apps/web file-assets:backfill` to create missing **File Assets**, set product `file_asset_id` values, and add **File Asset References**.
- Keep existing product row identities stable during migration.
- New writes go through **File Assets**.
- Reads should cut over to **File Assets**.
- Legacy per-table storage fields should be removed as part of the same overall migration once backfill and read cutover are complete.
- V1 maximum **File Asset** size is 1 GB.
- V1 maximum **Message Attachments** per message is 10.
- V1 maximum total attached bytes per message is 2 GB.
- V1 maximum active **Upload Sessions** per **User** is 20.
- V1 workspace **File Asset** quota is 100 GB.
- Workspace quota includes **Ready File Assets** by actual size and active **Upload Sessions** by declared-size reservation.
- **Sandbox Files** count against the same workspace **File Asset** quota.
- **Unattached File Assets** are allowed temporarily and are eligible for cleanup after a 24-hour grace period.
- Deleting a product relationship makes the referenced **File Asset** cleanup-eligible only when no remaining product concept or active **Generation** references it.
- **File Asset** byte deletion is asynchronous.
- Active **Generations** protect referenced **File Assets** from hard deletion until terminal.
- Signed download URLs are generated on demand and not stored.
- Normal user-facing downloads start with Bap authorization and then use short-lived signed object-storage URLs for direct browser download.
- Special inline rendering cases can continue using app-controlled serving where the app needs to inspect, transform, or sandbox bytes.
- Signed upload URLs are session-scoped, short-lived, and refreshable or restartable.
- Bap validates declared file size before upload starts.
- Bap verifies actual stored size at completion before marking a **File Asset** ready.
- **File Assets** should support checksum or storage-integrity metadata.
- Do not implement automatic byte deduplication in v1.
- Do not implement user-facing **File Asset** rename in v1.
- Completed uploads survive page refresh as **Ready File Assets**; incomplete upload progress does not need a guaranteed browser-restart resume UX in v1.
- The runtime contract is that all required **File Assets** are available before the **Generation** prompt starts.
- Bap exposes **Staged File Assets** through stable Bap-owned filesystem paths, not raw object-storage paths.
- The implementation may copy/download files today and later project mounted object storage into the same logical runtime paths.
- Introduce a deep **File Asset** service module that owns upload sessions, completion verification, quota accounting, storage-key generation, server-side **File Asset** creation, signed download URL authorization, cleanup eligibility, and deletion orchestration.
- Introduce a focused upload client module for browser upload UX that hides upload-session and object-storage details behind a small interface.
- Update chat/generation command modules to pass **File Asset** ids through starts and queues.
- Update **Coworker Document** modules to create, replace, delete, and download through **File Assets**.
- Update skill document modules to create, replace, delete, and download through **File Assets**.
- Update sandbox file collection modules to create **File Assets** for generated outputs.
- Keep observability safe: record counts, byte sizes, statuses, and safe identifiers, but never file contents, private storage keys in broad telemetry, request bodies, or signed URLs.
- Do not sync the **File Asset** table wholesale through Zero.
- If file metadata is included in a reactive read path later, expose only audited metadata such as id, filename, MIME type, size, creation time, and readiness status.

## Testing Decisions

- Good tests should assert product behavior and security boundaries, not internal helper call sequences.
- Test the **File Asset** service as a deep module with storage and database dependencies mocked at the boundary.
- Test **Upload Session** creation for authentication, workspace access, declared-size validation, quota reservation, active-session limit, generated storage identity, and expiry.
- Test **Upload Session** completion for actual-size verification, quota finalization, **Ready File Asset** creation, failed completion, and cleanup eligibility.
- Test direct upload URL behavior through the Bap contract, not provider-specific URL internals beyond expiration and session scoping.
- Test **Message Attachment** creation from **Ready File Asset** ids, including count limits, total-byte limits, wrong-workspace rejection, not-ready rejection, and queue persistence without bytes.
- Test draft/composer behavior around uploading, ready, failed, retry, remove, and send-enabled states.
- Test **Coworker Document** creation, replacement, deletion, and same-filename replacement while preserving product relationship identity.
- Test **Skill Document** creation, replacement, deletion, and path behavior through **File Assets**.
- Test **Sandbox File** creation from generated runtime output while preserving existing download and **Agentic-App** behavior.
- Test backfill migration behavior with representative existing rows for **Message Attachments**, **Coworker Documents**, **Skill Documents**, and **Sandbox Files**.
- Test that relationship deletion does not delete bytes still referenced by another relationship.
- Test that unreferenced **File Assets** become cleanup-eligible after the grace period.
- Test that active **Generations** block hard deletion of referenced **File Assets**.
- Test signed download authorization for allowed and forbidden users, wrong workspace, deleted relationships, expired links, and normal large-file redirect behavior.
- Test filename preservation separately from runtime/storage path sanitization.
- Test duplicate filenames in one draft, one conversation, one **Coworker**, and one skill where applicable.
- Test quota enforcement for **Ready File Assets**, active **Upload Session** reservations, **Sandbox Files**, and cleanup release.
- Test observability/redaction boundaries so file contents, private storage keys, request bodies, and signed URLs are not emitted in broad telemetry.
- Use existing storage validation tests as prior art for size/type validation behavior.
- Use existing **Coworker Document** service tests as prior art for relationship create/update/delete behavior.
- Use existing generation router and queue tests as prior art for start/queue payload behavior.
- Use existing sandbox file service tests as prior art for generated-output persistence behavior.
- Use existing Zero schema tests as prior art for excluding sensitive storage fields from synced metadata.
- Run focused tests for every changed module and the app-wide check after implementation.

## Out of Scope

- Building a user-facing global Files library.
- Changing MCP external upload transport; MCP base64 behavior remains as it is today.
- Supporting 1 GB base64 MCP uploads.
- Adding OCR, embeddings, indexing, thumbnails, or semantic file processing.
- Implementing automatic byte deduplication.
- Implementing user-facing **File Asset** rename.
- Providing a guaranteed upload resume UX across browser refresh or restart in v1.
- Changing profile image or workspace image flows.
- Changing bug report attachment flow.
- Changing **Agentic-App** behavior beyond storage identity for its backing **Sandbox File**.
- Building multi-file **Agentic-App** bundles.
- Exposing raw object-storage paths to agents or users.
- Syncing the **File Asset** table wholesale through Zero.
- Changing broader workspace permission semantics outside file access through product relationships.

## Further Notes

The agreed direction is to centralize storage identity without centralizing product meaning. **File Assets** own storage metadata and lifecycle. **Message Attachments**, **Coworker Documents**, **Skill Documents**, and **Sandbox Files** own the user-facing meaning and access path.

This PRD assumes object storage remains private infrastructure. Browser uploads and downloads can use signed object-storage URLs only after Bap authorization, and those URLs are short-lived operational artifacts rather than persisted product state.

The runtime staging wording is intentionally storage-mechanism-neutral. Today Bap may copy files into the sandbox. Later Bap can mount object storage or skill directories directly, as long as **Staged File Assets** are available at stable Bap-owned filesystem paths before a **Generation** prompt starts.
