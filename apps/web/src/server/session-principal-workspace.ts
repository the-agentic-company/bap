import { ensureWorkspaceForUser } from "@cmdclaw/core/server/billing/service";
import { db } from "@cmdclaw/db/client";
import { user as userTable } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";

export async function resolveSessionPrincipalWorkspaceId(userId: string): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: {
      activeWorkspaceId: true,
    },
  });
  const activeWorkspace = await ensureWorkspaceForUser(userId, dbUser?.activeWorkspaceId);

  return activeWorkspace.id;
}
