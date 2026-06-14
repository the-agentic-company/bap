# Bap MCP Coworker Update and Document Management

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

The **Bap MCP Server** can currently create, inspect, trigger, and observe **Coworkers**, and it can upload **Coworker Documents**. It cannot update an existing **Coworker** through MCP, and it cannot fully manage existing **Coworker Documents** after upload.

This leaves agents with an incomplete control surface. If an agent creates a **Coworker** with imperfect instructions, trigger settings, model configuration, or reference material, it must fall back to the web app, CLI/runtime edit path, or ad hoc workarounds. The gap is especially visible because `coworker.create` already accepts uploaded files, but MCP does not let the same caller update or delete those **Coworker Documents** later.

## Solution

Extend the **Bap MCP Server** with a normal **Coworker** update tool and explicit **Coworker Document** management tools.

Add `coworker.update` as a partial-patch operation for broad editor-style **Coworker** fields. It should accept the same `reference` convention as existing coworker MCP tools, where callers can pass either a coworker id or `@username`. It should update only fields that are present, reject empty updates, use last-write-wins semantics, and return the updated **Coworker** details.

Keep `coworker.uploadDocument` as the add/upload operation, and add `coworker.updateDocument` plus `coworker.deleteDocument` for existing **Coworker Documents**. Document operations should require both the **Coworker** `reference` and the document id so agents make the target **Coworker** explicit. `coworker.updateDocument` should support metadata-only updates and full file replacement while preserving the existing document id.

## User Stories

1. As an MCP client, I want to update an existing **Coworker**, so that I can refine a coworker without recreating it.
2. As an MCP client, I want `coworker.update` to accept a coworker id, so that I can update a precisely known **Coworker**.
3. As an MCP client, I want `coworker.update` to accept `@username`, so that I can use the same reference style as other coworker MCP tools.
4. As an MCP client, I want `coworker.update` to be a partial patch, so that omitted fields are not accidentally reset.
5. As an MCP client, I want `coworker.update` to reject an empty patch, so that accidental no-op writes are surfaced as mistakes.
6. As an MCP client, I want to update a **Coworker** name, so that the user-facing label stays accurate.
7. As an MCP client, I want to update a **Coworker** description, so that users can understand what it does.
8. As an MCP client, I want to clear a **Coworker** description, so that stale explanatory text can be removed.
9. As an MCP client, I want to update a **Coworker** username, so that later MCP calls can use a better `@username`.
10. As an MCP client, I want to update a **Coworker** status, so that I can turn it on or off through the platform control surface.
11. As an MCP client, I want to update a **Coworker** trigger, so that its execution contract can change without recreating it.
12. As an MCP client, I want to update a **Coworker** schedule, so that scheduled coworkers can be adjusted through MCP.
13. As an MCP client, I want to clear a **Coworker** schedule when appropriate, so that a scheduled **Coworker** can become non-scheduled through update semantics.
14. As an MCP client, I want to update a **Coworker** prompt, so that I can improve its instructions after observing behavior.
15. As an MCP client, I want to update additional "do" guidance, so that desired behavior can be sharpened separately from the main prompt.
16. As an MCP client, I want to update additional "don't" guidance, so that undesired behavior can be constrained separately from the main prompt.
17. As an MCP client, I want to update the model reference, so that a **Coworker** can move to the intended model without being rebuilt.
18. As an MCP client, I want to update the model auth source, so that the **Coworker** uses the intended credential source.
19. As an MCP client, I want to update auto-approval behavior, so that write behavior can be changed after creation.
20. As an MCP client, I want to update pinned state, so that organizational preference can be managed through MCP.
21. As an MCP client, I want to update the **Toolbox** access mode, so that a **Coworker** can move between broad and selected tool access.
22. As an MCP client, I want to update allowed **Integration Types**, so that the **Coworker** can use the intended managed integrations.
23. As an MCP client, I want to update allowed custom integrations, so that custom tool access can be controlled through MCP.
24. As an MCP client, I want to update allowed **Workspace MCP Server** ids, so that workspace-owned MCP access can be controlled through MCP.
25. As an MCP client, I want to update allowed skill slugs, so that a **Coworker** can use the intended skills.
26. As an MCP client, I want to update whether a **Coworker** requires a **Start Message**, so that user-input behavior can be configured after creation.
27. As an MCP client, I want to update the **User Input Prompt**, so that the **Pending Start** question can be corrected or improved.
28. As an MCP client, I want `coworker.update` to return the updated **Coworker** details, so that I do not need an immediate follow-up get call.
29. As an MCP client, I want **Coworker Document** operations to be separate from `coworker.update`, so that config changes and document changes do not create mixed partial-success behavior.
30. As an MCP client, I want to keep using `coworker.uploadDocument`, so that existing upload behavior and clients continue to work.
31. As an MCP client, I want to update a **Coworker Document** filename, so that the attached reference material has a useful label.
32. As an MCP client, I want to update a **Coworker Document** description, so that agents and users understand why the document is attached.
33. As an MCP client, I want to clear a **Coworker Document** description, so that stale document context can be removed.
34. As an MCP client, I want to replace a **Coworker Document** file while keeping the same document id, so that the document identity remains stable.
35. As an MCP client, I want file replacement to require filename, MIME type, and base64 content together, so that stored bytes and metadata stay consistent.
36. As an MCP client, I want MIME type to change only when file bytes are replaced, so that downloads and previews do not lie about stored content.
37. As an MCP client, I want `coworker.updateDocument` to reject empty updates, so that no-op document writes are surfaced as mistakes.
38. As an MCP client, I want document update and delete calls to require both coworker reference and document id, so that accidental cross-coworker mutations are rejected.
39. As an MCP client, I want to delete a **Coworker Document**, so that obsolete reference material can be removed.
40. As a **User**, I want MCP-created and MCP-updated **Coworkers** to remain ordinary **Coworkers**, so that the web app, CLI, runs, and history continue to work normally.
41. As a **User**, I want **Coworker Documents** changed through MCP to remain ordinary **Coworker Documents**, so that download and runtime behavior stay consistent.
42. As a developer, I want the Bap MCP tool wrappers to stay shallow, so that tool parsing and auth remain easy to reason about.
43. As a developer, I want coworker update behavior to live behind a tested handler boundary, so that MCP input mapping can be verified without duplicating backend validation.
44. As a developer, I want **Coworker Document** replacement behavior to live behind a focused service boundary, so that storage and database effects can be tested in isolation.
45. As a future maintainer, I want this API to avoid builder-specific terminology, so that `coworker.update` does not get confused with the existing guarded builder edit flow.

## Implementation Decisions

- Add `coworker.update` to the **Bap MCP Server**.
- `coworker.update` is a write tool and is not idempotent.
- `coworker.update` accepts `reference`, matching existing coworker MCP tools.
- `reference` resolves to either a coworker id or `@username`.
- `coworker.update` uses partial patch semantics. Only provided fields are changed.
- `coworker.update` rejects an input that contains no update fields.
- `coworker.update` uses last-write-wins semantics. Do not add `baseUpdatedAt` or optimistic concurrency.
- `coworker.update` returns updated **Coworker** details, equivalent to fetching the **Coworker** after the mutation.
- `coworker.update` exposes the broad editor-style **Coworker** surface, not the narrower builder-safe edit contract.
- `coworker.update` may update name, description, username, status, trigger, prompt, prompt guidance, model, model auth source, auto-approval, pinned state, tool access mode, allowed integrations, allowed custom integrations, allowed **Workspace MCP Server** ids, allowed skill slugs, schedule, required **Start Message** behavior, and **User Input Prompt**.
- The MCP field `trigger` maps to the backend trigger type.
- The MCP field `integrations` maps to allowed **Integration Types**.
- The MCP field `customIntegrations` maps to allowed custom integrations.
- The MCP field `workspaceMcpServerIds` maps to allowed **Workspace MCP Server** ids.
- The MCP field `skillSlugs` maps to allowed skill slugs.
- `coworker.update` does not support folder moves in this PRD.
- `coworker.update` never creates, updates, replaces, or deletes **Coworker Documents** inline.
- Keep `coworker.uploadDocument` as the existing add/upload tool.
- Add `coworker.updateDocument` to the **Bap MCP Server**.
- Add `coworker.deleteDocument` to the **Bap MCP Server**.
- Document tools are write tools and are not idempotent.
- Document update and delete inputs require both a **Coworker** `reference` and a document id.
- Document update and delete handlers must verify that the document belongs to the resolved **Coworker** before mutating it.
- `coworker.updateDocument` supports metadata-only updates for filename and description.
- `description: null` clears a **Coworker Document** description.
- Metadata-only updates must not allow MIME type changes.
- `coworker.updateDocument` supports file replacement.
- File replacement preserves the existing document id.
- File replacement requires filename, MIME type, and base64 content together.
- File replacement updates the document filename, MIME type, size, storage location, and updated timestamp.
- File replacement should not delete the old stored object until the new object and document record update have succeeded.
- If file replacement fails after uploading a new stored object but before committing the database update, the implementation should clean up the newly uploaded object when practical and leave the existing document intact.
- `coworker.updateDocument` rejects an input that contains no metadata change and no file replacement.
- `coworker.deleteDocument` removes the **Coworker Document** record and stored object using the existing authorization boundary.
- The shared Bap API client needs typed methods for coworker update, document update, and document delete so MCP handlers can call the product API through the same client abstraction as existing tools.
- The coworker runner abstraction should grow only where it makes MCP reference resolution and handler code simpler. Avoid a shallow wrapper if direct client calls through resolved ids are clearer.
- The useful deep module boundary for document replacement is the **Coworker Document** service: it should encapsulate validation, storage object replacement, database update, and cleanup behavior behind a small interface.
- The useful deep module boundary for MCP behavior remains the Bap MCP handler layer: tool wrappers authenticate and parse MCP input, while handlers map MCP-native fields to Bap client calls.
- No database schema change is required. The existing **Coworker Document** record already has document identity, metadata, storage key, and update timestamp.
- No ADR is needed. This is a straightforward extension of existing **Bap MCP Server**, **Coworker**, and **Coworker Document** concepts rather than a surprising hard-to-reverse architecture decision.
- The glossary now defines **Coworker Document** and describes the **Bap MCP Server** as managing **Coworker Documents**.

## Testing Decisions

- Tests should assert external behavior at API and handler boundaries, not internal implementation details.
- Add focused handler tests proving `coworker.update` resolves `@username` references before updating.
- Add focused handler tests proving `coworker.update` maps MCP field names to backend/client field names.
- Add focused handler tests proving `coworker.update` sends only provided fields and does not invent omitted fields.
- Add focused handler tests proving `coworker.update` rejects an empty patch.
- Add focused handler tests proving `coworker.update` returns updated **Coworker** details.
- Add focused handler tests proving document update/delete require the target document to belong to the resolved **Coworker**.
- Add focused handler tests proving metadata-only document updates allow filename and description changes.
- Add focused handler tests proving `description: null` clears a **Coworker Document** description.
- Add focused handler tests proving MIME type cannot be updated without file replacement.
- Add focused handler tests proving file replacement requires filename, MIME type, and content together.
- Add service-level tests for **Coworker Document** replacement that verify stable document id, updated metadata, new size, new storage key, and old-object cleanup sequencing.
- Add service-level tests for document replacement failure paths where storage upload or database update fails.
- Add service-level tests for document delete if existing coverage does not already assert ownership and storage deletion behavior.
- Add client type coverage where practical so new Bap API client methods remain aligned with server routes.
- Add tool wrapper tests only if prior art exists for Bap MCP wrapper behavior; otherwise handler tests are sufficient because wrappers should remain shallow.
- Use existing Bap MCP handler tests as prior art for `coworker.create`, `coworker.run`, and `coworker.uploadDocument`.
- Use existing web coworker router tests as prior art for update validation, ownership checks, scheduler sync, and document upload/delete behavior.
- Run the focused Bap MCP server tests after implementation.
- Run focused coworker router and **Coworker Document** service tests after implementation.
- Run package typechecks for changed packages when cheap enough for the development loop.
- Browser/UI tests are not required for this PRD because the feature changes MCP/API behavior, not frontend behavior.

## Out of Scope

- Renaming `coworker.uploadDocument`.
- Folding document uploads, updates, replacements, or deletes into `coworker.update`.
- Adding folder moves to `coworker.update`.
- Adding optimistic concurrency or `baseUpdatedAt` to coworker updates.
- Adding optimistic concurrency or `baseUpdatedAt` to **Coworker Document** updates.
- Exposing the conversational coworker builder through MCP.
- Renaming the existing builder-safe edit flow.
- Replacing `coworker.update` with `coworker.edit`.
- Adding inline document lists such as files to upload, documents to update, or documents to delete on `coworker.update`.
- Adding bulk document operations.
- Adding document download changes beyond the existing download-url behavior.
- Changing **Pending Start**, **Start Message**, **User Input Prompt**, or inbox behavior.
- Changing **Workspace MCP Server Allowlist** behavior.
- Changing database schema.
- Changing lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

The chosen name is `coworker.update` because it matches the broad editor-style update concept. The name `coworker.edit` is intentionally avoided for this MCP tool because the codebase already uses edit language for the guarded builder edit contract.

The previous Bap MCP coworker parity PRD intentionally excluded update/edit and document lifecycle expansion. This PRD is the follow-up slice that fills that gap without changing the create/run semantics from the earlier slice.
