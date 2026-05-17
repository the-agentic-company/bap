import {
  getWorkspaceMembershipForUser,
  requireActiveWorkspaceForUser,
} from "@cmdclaw/core/server/billing/service";
import { db } from "@cmdclaw/db/client";
import { workspace as workspaceTable } from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

function isWorkspaceAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function requireActiveWorkspaceAccess(
  userId: string,
  preferredWorkspaceId?: string | null,
) {
  if (preferredWorkspaceId) {
    const membership = await getWorkspaceMembershipForUser(userId, preferredWorkspaceId);
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }

    const workspaceRow = await db.query.workspace.findFirst({
      where: eq(workspaceTable.id, preferredWorkspaceId),
    });

    if (!workspaceRow) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }

    return {
      workspace: workspaceRow,
      membership,
    };
  }

  const workspace = await requireActiveWorkspaceForUser(userId);
  const membership = await getWorkspaceMembershipForUser(userId, workspace.id);

  if (!membership) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  return {
    workspace,
    membership,
  };
}

export async function requireActiveWorkspaceAdmin(
  userId: string,
  preferredWorkspaceId?: string | null,
) {
  const access = await requireActiveWorkspaceAccess(userId, preferredWorkspaceId);
  if (!isWorkspaceAdminRole(access.membership.role)) {
    throw new ORPCError("FORBIDDEN", { message: "Workspace admin role required" });
  }
  return access;
}
