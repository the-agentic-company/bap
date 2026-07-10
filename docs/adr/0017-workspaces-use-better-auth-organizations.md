---
status: accepted
---

# Workspaces Use Better Auth Organizations

Bap will keep **Workspace** as the product and domain term, while using Better Auth's `organization` table as the physical persistence primitive for Workspace identity. Bap-owned product code should import a `workspace` schema alias and keep `workspace_id` columns on resource tables, even though those foreign keys point to Better Auth `organization.id`; Better Auth integration code may use `organization` terminology directly.

**Consequences**

Workspace membership, roles, invitations, and active Workspace state are owned by Better Auth organization primitives. Better Auth `member` replaces the custom `workspace_member` table, Better Auth active organization replaces `user.activeWorkspaceId`, and normal Workspace invitations use Better Auth invitations rather than the previous add-existing-users-only flow. Better Auth teams and generic organization deletion are not enabled in the first cutover.

Bap-specific scalar Workspace state lives on the Better Auth organization row through typed fields only when Better Auth has no native equivalent. Billing and image metadata move to organization fields, while native organization fields such as slug are used as-is. `createdByUserId` is not carried forward because current ownership and administration are represented by Better Auth membership roles; historical provenance belongs in future audit records if needed.

The migration is a hard runtime cutover: application code moves to Better Auth organization/member primitives rather than maintaining dual active read paths. Existing `workspace` and `workspace_member` tables are renamed as legacy backup tables for one deploy/audit window, while Bap resource tables keep their `workspace_id` column names and repoint those foreign keys to `organization.id`. Self-hosted Bap uses the same organization-backed Workspace model, with the existing single shared Workspace behavior preserved as policy.

Global Bap administration remains separate from Workspace roles. **Platform Admin** authority comes from Better Auth's admin plugin and governs platform/support operations; **Workspace Membership** roles govern access to one Workspace.
