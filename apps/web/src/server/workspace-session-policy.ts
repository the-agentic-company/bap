import { db } from "@bap/db/client";
import { workspace } from "@bap/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function addWorkspaceSessionIdleTimeouts<
  T extends { workspaces: Array<{ id: string }> },
>(overview: T) {
  const workspaceIds = overview.workspaces.map(({ id }) => id);
  const policies =
    workspaceIds.length === 0
      ? []
      : await db.query.workspace.findMany({
          where: inArray(workspace.id, workspaceIds),
          columns: { id: true, sessionIdleTimeoutMinutes: true },
        });
  const timeoutByWorkspaceId = new Map(
    policies.map((policy) => [policy.id, policy.sessionIdleTimeoutMinutes]),
  );

  return {
    ...overview,
    workspaces: overview.workspaces.map((item) => ({
      ...item,
      sessionIdleTimeoutMinutes: timeoutByWorkspaceId.get(item.id) ?? null,
    })),
  };
}

export async function setWorkspaceSessionIdleTimeout(
  workspaceId: string,
  sessionIdleTimeoutMinutes: number | null,
) {
  const [updated] = await db
    .update(workspace)
    .set({ sessionIdleTimeoutMinutes })
    .where(eq(workspace.id, workspaceId))
    .returning({
      id: workspace.id,
      sessionIdleTimeoutMinutes: workspace.sessionIdleTimeoutMinutes,
    });

  if (!updated) {
    throw new Error("Workspace not found");
  }

  return updated;
}
