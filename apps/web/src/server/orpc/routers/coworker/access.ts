import { coworker, user } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { requireActiveWorkspaceAccess } from "../../workspace-access";

export type CoworkerRouterContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
  workspaceId?: string | null;
};

export async function requireOwnedCoworkerInActiveWorkspace(
  context: CoworkerRouterContext,
  coworkerId: string,
) {
  const access = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const workspaceId = access.workspace.id;
  const coworkerRow = await context.db.query.coworker.findFirst({
    where: and(
      eq(coworker.id, coworkerId),
      eq(coworker.ownerId, context.user.id),
      eq(coworker.workspaceId, workspaceId),
    ),
  });

  if (!coworkerRow) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  return {
    coworker: coworkerRow,
    workspaceId,
    membershipRole: access.membership.role,
  };
}

export async function requireAdminUser(context: {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
}) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: {
      role: true,
      email: true,
    },
  });

  if (dbUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }

  return dbUser;
}
