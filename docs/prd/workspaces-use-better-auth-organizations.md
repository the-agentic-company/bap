# PRD: Workspaces Use Better Auth Organizations

## Problem Statement

Bap has a custom **Workspace** and **Workspace Membership** model that duplicates capabilities already provided by Better Auth's organization plugin. This makes workspace creation, active workspace selection, role checks, member management, and invitations harder to maintain than necessary, and it creates a separate model from the authentication system Bap already uses for users, sessions, and global administration.

The current custom model also limits normal invitation behavior. Workspace "invites" only add existing users and ignore emails without user records, so the product does not have a first-class **Workspace Invitation** lifecycle.

## Solution

Use Better Auth organizations as the physical primitive for Bap **Workspaces**, while keeping **Workspace** as the product and domain term. Better Auth owns Workspace identity, membership, roles, invitations, and active Workspace state. Bap continues to own Workspace-scoped product resources such as conversations, **Coworkers**, **File Assets**, billing semantics, **Workspace MCP Servers**, provider access rows, and hosted MCP OAuth grants.

The migration is a hard runtime cutover. Bap code moves to Better Auth organization/member primitives rather than maintaining long-lived dual read paths. Existing product tables keep `workspace_id` column names, but those foreign keys point to Better Auth organization rows. Existing custom `workspace` and `workspace_member` tables are retained only as renamed legacy backup tables for one deploy/audit window.

## User Stories

1. As a **User**, I want Bap to continue calling my shared boundary a **Workspace**, so that product language stays familiar.
2. As a **User**, I want my existing Workspaces to keep their identity after the migration, so that conversations, coworkers, files, billing, and integrations remain attached to the right place.
3. As a **User**, I want my active Workspace to remain the default for new scoped actions, so that the migration does not change everyday workflow.
4. As a **User**, I want to switch Workspaces as I do today, so that navigation and context selection remain predictable.
5. As a **User**, I want Workspace membership to preserve my current access, so that I can still access the Workspaces I belonged to before the migration.
6. As a **User**, I want Workspace roles to preserve current behavior, so that owners, admins, and members keep the same practical capabilities.
7. As a **Workspace Admin**, I want to invite people by email, so that people can join even if they do not already have Bap user records.
8. As a **Workspace Admin**, I want pending Workspace Invitations to be visible, so that I can understand who has been invited but has not joined.
9. As a **Workspace Admin**, I want to cancel pending Workspace Invitations, so that incorrect or stale invitations can be revoked.
10. As an invited recipient, I want to accept a Workspace Invitation, so that I become a Workspace member only after I choose to join.
11. As an invited recipient, I want to reject or ignore a Workspace Invitation, so that invitation does not grant access by itself.
12. As a **Workspace Admin**, I want membership management to continue using owner/admin checks, so that members cannot manage access unless allowed.
13. As a **Workspace Admin**, I want Workspace rename behavior to stay aligned with current behavior, so that existing settings workflows keep working.
14. As a **Workspace Admin**, I want Workspace picture upload and removal to keep current storage behavior, so that private storage keys and MIME metadata remain controlled by Bap.
15. As a **User**, I want Workspace billing to stay Workspace-scoped, so that plans, credits, usage, and billing portal access do not move to personal billing.
16. As a **User**, I want my existing Workspace billing plan and Autumn customer linkage to survive the migration, so that billing continuity is preserved.
17. As a **Platform Admin**, I want internal workspace join/add/remove behavior to remain available, so that support and debugging workflows continue to work.
18. As a **Platform Admin**, I want global administration to stay separate from Workspace roles, so that platform authority and Workspace access are not confused.
19. As a self-hosted Bap user, I want the existing single shared Workspace behavior to continue, so that self-hosted installs remain simple.
20. As a self-hosted Bap user, I want Bap to use the same underlying Workspace model as cloud, so that self-hosted behavior does not drift into a special auth path.
21. As a **User**, I want Workspace deletion to remain unavailable, so that product data is not removed by a generic organization deletion flow.
22. As a **User**, I want existing conversations to remain associated with their Workspaces, so that chat history remains scoped correctly.
23. As a **User**, I want existing **Coworkers** and **Coworker Runs** to remain associated with their Workspaces, so that automation history and management remain correct.
24. As a **User**, I want existing **File Assets** and upload sessions to remain associated with their Workspaces, so that agent-usable files continue to resolve.
25. As a **User**, I want existing **Workspace MCP Servers** to remain associated with their Workspaces, so that tool availability does not change unexpectedly.
26. As a **User**, I want existing **Workspace MCP Authorizations** to remain separate from membership, so that joining a Workspace does not automatically replace tool-specific authorization.
27. As a **User**, I want hosted MCP OAuth grants to remain bound to the Workspace where they were granted, so that switching Active Workspace does not silently move durable grants.
28. As a developer, I want Bap product code to use Workspace terminology, so that code follows the domain glossary.
29. As a developer, I want Better Auth integration code to use Better Auth organization terminology where appropriate, so that auth-specific code is clear.
30. As a developer, I want a schema alias for Workspace over the Better Auth organization table, so that product code can import `workspace` while the physical table remains Better Auth-native.
31. As a developer, I want resource table columns to remain named `workspace_id`, so that Bap domain code does not leak organization terminology.
32. As a developer, I want Better Auth `member` to replace custom Workspace membership storage, so that there is one role/membership system.
33. As a developer, I want Better Auth organization invitations to replace Bap's previous invite implementation, so that there is one invitation lifecycle.
34. As a developer, I want Better Auth active organization to replace Bap's custom active Workspace field, so that there is one active Workspace source of truth.
35. As a developer, I want role checks centralized around Better Auth organization roles, so that owner/admin/member behavior is not duplicated.
36. As a developer, I want Better Auth teams disabled, so that no extra sub-Workspace boundary appears without a product concept.
37. As a developer, I want Better Auth organization deletion disabled, so that generic deletion cannot bypass Bap product data rules.
38. As a developer, I want Bap-specific scalar Workspace state stored as typed organization fields, so that billing and image state remains queryable and typed.
39. As a developer, I want native Better Auth organization fields used when they exist, so that Bap does not duplicate slug or other native organization concepts.
40. As a developer, I want `createdByUserId` not carried forward as Workspace state, so that current ownership is represented by Better Auth membership and future provenance can use **Audit Records**.
41. As a developer, I want nullable Workspace foreign keys to keep their current nullability, so that the hard auth cutover does not also become a data-hardening migration.
42. As a developer, I want Zero permissions to join against Better Auth `member`, so that synced reads use the same membership authority as the rest of Bap.
43. As a developer, I want old Workspace tables renamed rather than immediately dropped, so that production data can be audited during the first deploy after cutover.
44. As a developer, I want import boundary rules for Workspace versus organization terminology, so that future code does not drift back into mixed language.
45. As a developer, I want tests around migration and authorization behavior, so that the hard cutover is safe despite touching many resource tables.

## Implementation Decisions

- The product and domain term remains **Workspace**.
- Better Auth `organization` is the physical persistence primitive for Workspace identity.
- Bap product code should use a Workspace schema alias over the Better Auth organization table.
- Better Auth integration code may use organization terminology directly.
- Product resource tables keep `workspace_id` column names.
- Product resource table `workspace_id` foreign keys point to Better Auth organization ids after the cutover.
- Existing Workspace ids are preserved as organization ids.
- Existing Workspace slugs move to Better Auth's native organization slug field.
- Better Auth native organization fields are used whenever they match current Bap behavior.
- Bap-specific scalar Workspace state is added as typed organization fields only when Better Auth has no native equivalent.
- Billing plan id and Autumn customer id move onto the organization row as typed fields.
- Workspace image storage key and MIME type move onto the organization row as typed fields unless Better Auth has exact native equivalents.
- Workspace image upload and removal behavior remains Bap-owned.
- `createdByUserId` is not carried forward as organization custom state.
- Current ownership and administration are represented by Better Auth organization membership roles.
- Future historical creator provenance should use **Audit Records** or lifecycle events, not a Workspace row field.
- Better Auth `member` replaces the custom `workspace_member` table as the active membership primitive.
- Better Auth organization roles are the active Workspace role system.
- Bap does not keep an active Workspace membership enum in the database after cutover.
- Existing roles map to Better Auth roles: owner, admin, and member.
- Bap does not enforce exactly one owner unless Better Auth requires that behavior.
- Better Auth organization invitations replace the normal Workspace invitation flow.
- Normal Workspace invitation APIs create Better Auth invitation rows rather than directly inserting members.
- Existing pending invites do not require migration because the old implementation did not persist unknown-user invitations.
- Platform/admin tooling can still directly add, remove, or join Workspace members as an admin-only exception.
- Better Auth active organization replaces the custom active Workspace field.
- Server-side Bap authorization still verifies Workspace Membership against durable storage rather than trusting only session state.
- Bap keeps the current oRPC surface for workspace management so product policy and client cache behavior remain stable.
- oRPC handlers internally use Better Auth primitives or tables when appropriate.
- Workspace creation remains available to signed-in cloud users.
- Self-hosted installs use the same organization-backed Workspace model but preserve the single shared Workspace policy.
- Workspace deletion stays disabled for the first cutover.
- Better Auth teams are not enabled.
- Global Bap administration remains separate from Workspace roles.
- **Platform Admin** authority uses Better Auth admin-plugin roles.
- Current internal/admin route names and UI copy stay unchanged during this migration.
- `galien_workspace_access` and `modulr_workspace_access` remain Bap-owned multi-row access tables.
- Hosted MCP OAuth grants remain bound to their persisted Workspace ids.
- **Workspace MCP Servers** and **Workspace MCP Authorizations** remain Bap-owned resources.
- Zero permission checks use Better Auth `member` instead of the old `workspace_member` table.
- Existing nullable Workspace foreign keys keep their current nullability and delete behavior for this cutover.
- Existing custom `workspace` and `workspace_member` tables are renamed as legacy backup tables for one deploy/audit window.
- Runtime code does not read or write the legacy backup tables after the cutover.
- A later cleanup migration can drop legacy backup tables after audit.
- Add a lint or static boundary rule after the PRD/grilling phase to prevent product modules from importing Better Auth `organization` directly.
- The lint/static boundary rule should allow organization imports only in Better Auth integration, schema-generation, migration/backfill, and auth-focused test code.

## Testing Decisions

- Tests should assert externally visible behavior and database-visible contracts rather than private helper structure.
- Migration tests should verify existing Workspace ids are preserved as organization ids.
- Migration tests should verify existing Workspace slugs are preserved as native organization slugs.
- Migration tests should verify existing Workspace Membership rows become Better Auth member rows with equivalent user, Workspace, and role data.
- Migration tests should verify existing billing plan and Autumn customer values move to typed organization fields.
- Migration tests should verify Workspace image metadata moves to organization fields without changing storage behavior.
- Migration tests should verify `createdByUserId` is not required by active Workspace behavior.
- Migration tests should verify product resource `workspace_id` references still resolve after the cutover.
- Migration tests should cover conversations, coworkers, coworker folders, coworker runs, file assets, upload sessions, skills, billing rows, provider access rows, hosted MCP OAuth grants, and Workspace MCP servers.
- Authorization tests should verify Workspace Membership is checked through Better Auth member data.
- Authorization tests should verify owner/admin/member behavior matches current behavior.
- Authorization tests should verify **Platform Admin** behavior remains separate from Workspace role behavior.
- Active Workspace tests should verify switching Workspaces uses Better Auth active organization and preserves current user-facing behavior.
- Server tests should verify active Workspace defaults are still membership-checked.
- Invitation tests should verify normal Workspace invites create Better Auth invitations.
- Invitation tests should verify accepting an invitation creates Workspace Membership.
- Invitation tests should verify pending invitations do not grant access before acceptance.
- Invitation tests should verify cancellation/rejection behavior follows Better Auth invitation state.
- Admin tests should verify Platform Admin direct member add/remove/join behavior still works through Better Auth primitives.
- Self-hosted tests should verify all users resolve to the single shared Workspace using the organization-backed model.
- Billing tests should verify Workspace billing owner resolution reads organization fields and preserves current plan/top-up/portal behavior.
- Workspace image tests should verify upload, remove, and display behavior remain unchanged.
- Hosted MCP OAuth tests should verify existing grants remain bound to their persisted Workspace ids.
- Workspace MCP tests should verify server and authorization rows continue to scope by Workspace id.
- Zero schema and permission tests should verify read permissions join through Better Auth member data.
- UI tests should verify Workspace settings keep current visible behavior while invitation behavior becomes first-class.
- Import boundary tests or lint checks should verify Bap product modules use the Workspace alias rather than importing organization directly.
- Prior art exists in auth handler tests, billing/workspace lifecycle tests, Workspace image tests, hosted MCP OAuth tests, Workspace MCP server tests, Zero schema tests, and workspace settings UI tests.
- After implementation, run targeted tests for auth, billing/workspace lifecycle, invitations, Workspace images, hosted MCP OAuth, Workspace MCP, Zero schema/permissions, and Workspace settings UI.
- After implementation, run `bun run check`.
- After a large cutover implementation, run `bun run test`.

## Out of Scope

- Renaming product language from Workspace to Organization.
- Enabling Better Auth teams.
- Exposing Workspace deletion.
- Designing Workspace archive/delete semantics.
- Adding a new creator/provenance feature for Workspaces.
- Adding **Audit Records** for Workspace lifecycle events.
- Reworking existing internal/admin route names or UI copy.
- Changing current Workspace billing product behavior.
- Changing current self-hosted single shared Workspace behavior.
- Making currently nullable Workspace foreign keys non-null.
- Rewriting historical rows beyond what is required to preserve Workspace identity.
- Moving multi-row provider access allowlists into organization metadata.
- Moving **Workspace MCP Server** or **Workspace MCP Authorization** semantics into Better Auth.
- Replacing the Bap oRPC workspace management surface with direct client Better Auth calls.
- Creating or updating Linear issues directly.

## Further Notes

- This PRD follows ADR-0017, which records the architecture decision that Bap **Workspaces** use Better Auth organizations.
- ADR-0012 was updated so Zero permissions use Better Auth `member` rather than the old `workspaceMember` table.
- The hard cutover intentionally changes the primitive while keeping current product behavior wherever possible.
- The main implementation risk is breadth: Workspace identity touches auth, billing, admin tooling, Zero permissions, runtime authorization, files, coworkers, conversations, MCP, and provider access tables.
- The safest implementation shape is a small set of deep modules: Workspace identity/membership access, Workspace lifecycle operations, Workspace migration/backfill, and Workspace authorization checks.
