## Problem Statement

Bap currently copies skills and **Coworker Documents** into each sandbox before a **Generation** starts. That creates the wrong mental model for agents and users: edits made in one sandbox do not naturally become the durable source for future sandboxes, creating and deleting skills through the filesystem is awkward, and Bap has to keep upload/object-storage paths separate from the runtime files agents actually edit.

The user wants skills and **Coworker Documents** to behave like durable mounted files. A chat or builder should be able to edit skills in the same place OpenCode loads them from, and a **Coworker Run** should see and mutate only the skills and documents it is allowed to use. The old copy/upload model should be replaced rather than preserved as a fallback for these mutable reference-material surfaces.

## Solution

Introduce **Runtime Volumes** for user/workspace skills, shared skill copies, **Skill Documents**, and **Coworker Documents**. The Runtime Volume is an S3-backed filesystem mounted into Daytona sandboxes with `s3fs` and exposed through stable agent-facing paths. For these surfaces, S3 filesystem state is canonical for contents and existence; Postgres is a projection/index for ownership, visibility, enablement, relationships, cached metadata, manifest checkpoints, and UI/API queries.

Agents use `/app/.opencode/skills` as the canonical skill path. Bap exposes owned and shared skills there through a merged filesystem view: owned skills are writable, shared skills are read-only, owned skills shadow shared skills with the same slug, and newly created top-level skill directories land in the owned Runtime Volume branch. Agents use `/home/user/coworker-documents` as the canonical **Coworker Document** path for the exact **Coworker** being run or built.

Daytona is the first supported runtime provider. Any **Generation** that requires Runtime Volume support and selects another provider fails during setup before any model prompt starts. Bap does not copy skills or **Coworker Documents** into unsupported providers as a fallback.

## User Stories

1. As a **User**, I want skills to live in a mounted filesystem, so that edits made by an agent persist for future **Generations**.
2. As a **User**, I want agents to create a skill by creating a folder under `/app/.opencode/skills`, so that skill authoring matches the runtime mental model.
3. As a **User**, I want deleting a skill folder to delete the skill from Bap's product index, so that filesystem state is the source of truth.
4. As a **User**, I want renaming a skill folder to behave as delete old plus create new, so that path identity stays simple.
5. As a **User**, I want the folder slug to define the skill identity, so that `SKILL.md` frontmatter cannot rename a skill behind my back.
6. As a **User**, I want normal chat to see my owned skills as writable, so that chats can create and improve skills directly.
7. As a **User**, I want normal chat to see workspace shared skills as read-only, so that public/shared skill copies cannot be accidentally mutated.
8. As a **User**, I want an owned skill to shadow a shared skill with the same slug, so that my local editable skill wins in OpenCode's one skills directory.
9. As a **User**, I want attempts to write shared-only skills to fail in v1, so that Bap does not hide product creation behind copy-on-write behavior.
10. As a **User**, I want shared skills to be independent copies, so that edits to my owned skill do not silently change the shared copy.
11. As a **User**, I want copying a shared skill into my owned skills to preserve the slug when available, so that familiar skill names remain stable.
12. As a **User**, I want copying a shared skill to allocate a suffix on slug conflict, so that the copy operation remains predictable.
13. As a **User**, I want **Coworker Documents** to appear at `/home/user/coworker-documents`, so that agents do not need to know Coworker ids or storage prefixes.
14. As a **User**, I want a **Coworker** runner to see only that **Coworker**'s documents, so that one **Coworker** cannot inspect another **Coworker**'s reference material.
15. As a **User**, I want creating a file in `/home/user/coworker-documents` to create a **Coworker Document**, so that persistent reference material can be authored in the sandbox.
16. As a **User**, I want deleting a file in `/home/user/coworker-documents` to delete the **Coworker Document** index row, so that Bap does not retain phantom document records.
17. As a **User**, I want **Coworker Documents** to stay flat in v1, so that the document model remains easy to understand.
18. As a **User**, I want unsupported nested **Coworker Document** folders to produce a visible warning instead of silently becoming product state, so that mistakes are fixable.
19. As a **Coworker** owner, I want a **Coworker Run** to mount only the skills granted by the **Coworker** configuration, so that execution stays scoped.
20. As a **Coworker** owner, I want a **Coworker Run** to edit selected owned skills when needed, so that a configured **Coworker** can improve its own allowed reference material.
21. As a **Coworker** owner, I want selected shared skills in a **Coworker Run** to remain read-only, so that shared skill copies are protected.
22. As a **Coworker** owner, I want a **Coworker Run** to be unable to create new top-level skill folders, so that execution cannot expand its own skill surface.
23. As a **Coworker** builder user, I want the builder to mount owned skill authoring scope and shared skills, so that building a **Coworker** can include creating or editing skills.
24. As a **User**, I want official bundled skills to remain platform-managed runtime assets, so that agents cannot mutate built-in skill code.
25. As a **User**, I want mount failures to fail fast before the model prompt, so that a broken runtime filesystem does not produce silent incorrect work.
26. As a **User**, I want post-run reconciliation failures not to change an otherwise completed answer into a failed **Generation**, so that sync issues are visible but do not rewrite the model outcome.
27. As an agent, I want `/app/.opencode/skills` to be the only skill path I need to understand, so that owned/shared storage internals stay transparent.
28. As an agent, I want write failures on shared skills to be normal filesystem permission failures, so that I can recover by creating an owned skill when appropriate.
29. As an engineer, I want Runtime Volume credentials scoped per **Generation**, so that a sandbox can access only the S3 prefixes it is allowed to mount.
30. As an engineer, I want separate mounts for owned skills, shared skills, and **Coworker Documents**, so that read/write permissions are simple and auditable.
31. As an engineer, I want Bap to reconcile by listing S3 directly, so that projection correctness does not depend on sandbox-local mount cache behavior.
32. As an engineer, I want Bap to flush sandbox writes before S3 reconciliation, so that recent `s3fs` edits are visible to the projection loop.
33. As an engineer, I want metadata manifest hashes per projection root, so that unchanged roots skip expensive indexing work.
34. As an engineer, I want reconciliation to run best-effort after completed, failed, or cancelled mounted **Generations**, so that failed runs do not leave the projection stale.
35. As an engineer, I want a bounded background reconciler, so that sync failures can be retried without scanning the whole bucket.
36. As an engineer, I want existing skills and **Coworker Documents** migrated before cutover, so that the new required mount model does not rely on lazy runtime migration.
37. As an engineer, I want legacy byte/storage columns to remain temporarily for rollback but stop receiving new writes, so that Bap avoids two mutable sources of truth.
38. As an engineer, I want UI/API list views to read from Postgres projections, so that product screens stay fast and authorization remains queryable.
39. As an engineer, I want UI file reads and writes to use Runtime Volume storage APIs, so that the database does not become another copy of mutable file contents.
40. As an operator, I want non-Daytona provider selection to fail with `runtime_volume_provider_unsupported`, so that unsupported providers do not run partially wired **Generations**.
41. As an operator, I want mount setup logs to include provider, required mounts, workspace, conversation, and **Generation** identifiers, so that setup failures are diagnosable.
42. As an operator, I want invalid filesystem state to surface as runtime warnings or sync errors, so that support can explain why a skill/document did not appear.

## Implementation Decisions

- Follow ADR-0017, **Runtime Volumes for Skills and Coworker Documents**.
- Keep ADR-0016 for immutable **File Assets** used by **Message Attachments** and **Sandbox Files**.
- Move Runtime Volume-backed mutable reference material out of the active **File Asset** storage model.
- Use one private S3 bucket with scoped prefixes for Runtime Volume state.
- Use prefixes shaped around workspace, user, shared skills, Coworkers, and product slugs/filenames.
- Mount Runtime Volume prefixes into Daytona sandboxes with `s3fs`.
- Use short-lived per-Generation S3 credentials scoped to only the prefixes required for that run.
- Use separate logical mounts for owned skills, shared skills, and exact **Coworker Document** scope.
- Implement `/app/.opencode/skills` as a merged filesystem view, not a static symlink tree.
- Validate a union/merge filesystem layer in the Daytona image. The layer must make the owned branch writable, the shared branch read-only, owned entries shadow shared entries, and new top-level skill directories land in the owned branch.
- Expose `/home/user/coworker-documents` as the agent-facing path for the exact **Coworker** being run or built.
- Treat underlying `/runtime/skills`, `/runtime/shared-skills`, and `/runtime/coworker-documents` paths as implementation details.
- Normal chat mounts owned skill authoring scope and all workspace shared skills.
- **Coworker** builder mounts owned skill authoring scope, all workspace shared skills, and the exact **Coworker Document** scope for the **Coworker** being built.
- **Coworker** runner mounts only configured owned/shared skills and the exact **Coworker Document** scope for the **Coworker** being run.
- **Coworker** runner cannot create new top-level skill folders.
- **Coworker** runner may edit selected owned skills.
- Selected shared skills are always read-only.
- Official bundled skills remain image/repo-provided platform assets and are not moved into Runtime Volumes.
- Skill folder names are skill identity.
- Coworker Document direct-child filenames are document identity.
- Rename is delete old plus create new.
- Deletion hard-deletes the product index row. No product tombstone is retained by default.
- `SKILL.md` frontmatter can provide display metadata but cannot override folder identity.
- Invalid skill folders, invalid `SKILL.md`, unsupported nested **Coworker Document** paths, and conflicts do not fail a completed **Generation**.
- Invalid filesystem state remains on disk and is surfaced through visible warnings or sync errors.
- Runtime Volume mount failure is terminal setup error before prompting.
- A non-Daytona provider selected for a Runtime Volume-required **Generation** fails setup with `runtime_volume_provider_unsupported`.
- Mounting can run in parallel with unrelated runtime prep, but prompt construction must wait for all required mounts and verification.
- Existing copy paths for skills and **Coworker Documents** are replaced for the Runtime Volume target model. There is no copy fallback after cutover.
- Reconciliation flushes sandbox writes before listing S3 directly.
- Reconciliation reads S3 prefixes directly rather than reading through mounted sandbox paths.
- Reconciliation uses metadata manifest hashes per root as projection checkpoints.
- Metadata manifest hashes should include relative path, entry type, size, and mtime metadata. Full content hashing is not required in v1.
- If a root manifest hash is unchanged, reconciliation skips product indexing work for that root.
- Chat and builder reconcile the owned skill authoring branch and any mounted exact **Coworker Document** root.
- Runner reconciles selected owned skill roots and the exact **Coworker Document** root.
- Read-only shared skill roots are not reconciled after ordinary runs unless an explicit share/copy operation changed them.
- Reconciliation runs best-effort after completed, failed, or cancelled **Generations** when Runtime Volume mounting succeeded.
- Post-run reconciliation failure does not change the **Generation** terminal status.
- Store sync state, manifest checkpoints, and last errors in a projection/checkpoint model separate from product content bytes.
- Add a bounded background reconciler to retry roots with `last_error` and optionally compare manifests for known active roots.
- Do not scan the whole Runtime Volume bucket constantly.
- Add an explicit migration that copies existing `skill_file`, `skill_document`, and `coworker_document` bytes into Runtime Volume prefixes before cutover.
- Migration computes initial manifest hashes and creates projection rows.
- Runtime lazy migration is not part of the target model.
- Keep legacy byte/storage columns temporarily for rollback and legacy inspection, but stop writing them after cutover.
- Later cleanup can remove ignored legacy storage fields after production has run safely on Runtime Volumes.
- Web UI and API list views use Postgres projection rows.
- Web UI and API file reads/writes use Runtime Volume storage APIs.
- UI saves write to Runtime Volume storage and refresh projection/manifest state.
- Keep the existing public MCP/API shapes out of scope; storage internals can change behind those contracts.
- Runtime prompts mention `/app/.opencode/skills`, editable owned skills, read-only shared skills, and runner limitations without exposing Runtime Volume internals.
- Runtime Volume v1 does not include a product-level quota.
- Runtime Volume v1 does not include product-level version history, restore, backup UX, locking, or merge conflict handling.
- Concurrent writers are allowed. If two **Generations** write the same file, last write wins.

Useful deep modules:

- Runtime Volume storage service: owns S3 prefix construction, scoped credential generation, S3 listing, file read/write/delete, and manifest calculation.
- Runtime Volume mount coordinator: owns Daytona `s3fs` mount setup, verification, flush, and terminal setup error mapping.
- Merged skill view module: owns the union/merge view behavior for `/app/.opencode/skills`.
- Runtime Volume reconciler: owns S3 manifest comparison, skill/document projection updates, invalid-state warnings, hard-delete indexing, and background retry.
- Runtime Volume migration service: owns pre-cutover materialization of existing skill and **Coworker Document** bytes into S3 prefixes.
- Runtime Volume UI/API adapter: owns reading/writing Runtime Volume files from web/server routes while preserving projection-based listing.

## Testing Decisions

- Good tests should assert observable product behavior and storage/projection boundaries, not internal helper call ordering.
- Test Runtime Volume storage service with mocked S3/listing dependencies for prefix scoping, manifest hashing, file read/write/delete, and path validation.
- Test scoped credential generation to ensure a **Generation** receives only the owned skills, shared skills, and **Coworker Document** prefixes it is allowed to access.
- Test Daytona mount coordinator with provider adapters mocked for successful mount, read/write verification, flush behavior, unsupported provider setup error, and mount failure terminal setup error.
- Test merged skill view behavior in the Daytona image or a close integration harness: owned branch writable, shared branch read-only, owned shadows shared, and new skill folders land in owned storage.
- Test normal chat mount planning: owned authoring branch plus all workspace shared skills.
- Test **Coworker** builder mount planning: owned authoring branch, all workspace shared skills, and exact **Coworker Document** scope.
- Test **Coworker** runner mount planning: only configured owned/shared skills and exact **Coworker Document** scope.
- Test runner restrictions: new top-level skill creation fails, selected owned skill write succeeds, selected shared skill write fails.
- Test skill reconciliation from S3: valid new folder creates a skill projection, deleted folder deletes the skill projection, renamed folder becomes delete/create, invalid `SKILL.md` warns without failing.
- Test skill slug conflict behavior: owned skill shadows shared skill in the merged view.
- Test **Coworker Document** reconciliation: flat file creates a document projection, deleted file removes it, rename becomes delete/create, nested folder is warned/ignored.
- Test unchanged manifest behavior: reconciliation skips projection work when the metadata manifest hash is unchanged.
- Test changed manifest behavior: only dirty roots are reconciled.
- Test reconciliation after failed/cancelled **Generations** when mounts succeeded.
- Test post-run reconciliation failure does not change the **Generation** terminal status and records sync state for retry.
- Test background reconciler retries only known roots with errors and does not scan the whole bucket.
- Test pre-cutover migration with representative skill files, Skill Documents, and **Coworker Documents**.
- Test migration verification counts, initial manifest hashes, and rollback-safe legacy column retention.
- Test UI/API list views read projection state while file reads/writes go through Runtime Volume storage.
- Test UI save updates Runtime Volume storage and refreshes projection without writing legacy byte columns.
- Test prompt generation includes `/app/.opencode/skills`, read-only shared skill guidance, and runner no-new-skill guidance.
- Existing prior art includes sandbox prep tests, OpenCode session tests, sandbox file collection tests, file asset service tests, skill router tests, Coworker Document service tests, and generation finalizer/recovery tests.

## Out of Scope

- Runtime Volume support for E2B or Docker.
- Copy-based fallback for skills or **Coworker Documents** after Runtime Volume cutover.
- Moving **Message Attachments** or **Sandbox Files** out of **File Assets**.
- Moving official bundled/platform skills into Runtime Volumes.
- Changing public MCP/API shapes for skill tools.
- Product-level Runtime Volume quota.
- Product-level version history, restore, or backup UX.
- File-level locking, merge conflict handling, or automatic conflict resolution.
- Automatic copy-on-write from shared skills into owned skills.
- Nested **Coworker Document** folders.
- Broad workspace file library behavior.
- Runtime lazy migration.
- Content hashing all large files after every **Generation**.
- Retaining product tombstones for deleted Runtime Volume-backed skills or **Coworker Documents**.

## Further Notes

This PRD intentionally changes the storage authority for skills and **Coworker Documents**. The Runtime Volume is not a cache of DB bytes; it is the editable filesystem source for mutable reference material. Postgres remains essential, but as the product index and projection layer rather than a second copy of mutable contents.

The implementation should keep the agent mental model simple: skills are in `/app/.opencode/skills`, Coworker Documents are in `/home/user/coworker-documents`, shared skill writes may fail because they are read-only, and unsupported runtime providers fail early rather than silently degrading.
