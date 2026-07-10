import { describe, expect, it, vi } from "vitest";
import {
  backfillWorkspacesToOrganizations,
  workspaceOrganizationBackfillSql,
  workspaceOrganizationBackfillStatements,
} from "./workspace-organization-backfill";

describe("workspace organization backfill", () => {
  it("keeps an audit copy before transforming legacy workspace tables", () => {
    const sqlText = workspaceOrganizationBackfillSql.join("\n");

    expect(sqlText).toContain("CREATE TABLE legacy_workspace AS TABLE workspace WITH DATA");
    expect(sqlText).toContain(
      "CREATE TABLE legacy_workspace_member AS TABLE workspace_member WITH DATA",
    );
    expect(sqlText).toContain(
      "ALTER TABLE legacy_workspace_member ALTER COLUMN role TYPE text USING role::text",
    );
  });

  it("transforms legacy tables into Better Auth organization and member tables in place", () => {
    const sqlText = workspaceOrganizationBackfillSql.join("\n");

    expect(sqlText).toContain("ALTER TABLE workspace RENAME TO organization");
    expect(sqlText).toContain("ALTER TABLE workspace_member RENAME TO member");
    expect(sqlText).toContain("ALTER TABLE member RENAME COLUMN workspace_id TO organization_id");
    expect(sqlText).toContain("ALTER TABLE member ALTER COLUMN role TYPE text USING role::text");
    expect(sqlText).toContain("DROP TYPE IF EXISTS workspace_membership_role");
  });

  it("renames legacy constraints to the Better Auth table names", () => {
    const sqlText = workspaceOrganizationBackfillSql.join("\n");

    expect(sqlText).toContain(
      "ALTER TABLE organization RENAME CONSTRAINT workspace_pkey TO organization_pkey",
    );
    expect(sqlText).toContain(
      "ALTER TABLE organization RENAME CONSTRAINT workspace_slug_unique TO organization_slug_unique",
    );
    expect(sqlText).toContain(
      "ALTER TABLE member RENAME CONSTRAINT workspace_member_pkey TO member_pkey",
    );
    expect(sqlText).toContain("TO member_organization_id_organization_id_fk");
    expect(sqlText).toContain("TO member_user_id_user_id_fk");
  });

  it("preserves active workspace state on Better Auth sessions when membership exists", () => {
    const sqlText = workspaceOrganizationBackfillSql.join("\n");

    expect(sqlText).toContain(
      "ALTER TABLE session ADD COLUMN IF NOT EXISTS active_organization_id",
    );
    expect(sqlText).toContain('SET active_organization_id = "user".active_workspace_id');
    expect(sqlText).toContain('member.organization_id = "user".active_workspace_id');
  });

  it("runs statements sequentially", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await backfillWorkspacesToOrganizations({ execute });

    expect(execute).toHaveBeenCalledTimes(workspaceOrganizationBackfillStatements.length);
    expect(execute.mock.calls[0]?.[0]).toBe(workspaceOrganizationBackfillStatements[0]);
  });
});
