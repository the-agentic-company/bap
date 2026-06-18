import { getWorkspaceMembershipForUser } from "@bap/core/server/billing/service";
import { syncCoworkerScheduleJob } from "@bap/core/server/services/coworker-scheduler";
import { coworker, workspace } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

type MoveContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

export async function moveCoworkerToWorkspace(input: {
  context: MoveContext;
  coworkerId: string;
  targetWorkspaceId: string;
}) {
  const existing = await input.context.db.query.coworker.findFirst({
    where: eq(coworker.id, input.coworkerId),
  });

  if (!existing || existing.ownerId !== input.context.user.id || !existing.workspaceId) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  const sourceWorkspaceId = existing.workspaceId;

  if (sourceWorkspaceId === input.targetWorkspaceId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker is already in that workspace.",
    });
  }

  const targetWorkspace = await input.context.db.query.workspace.findFirst({
    where: eq(workspace.id, input.targetWorkspaceId),
    columns: { id: true },
  });

  if (!targetWorkspace) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  const [sourceMembership, targetMembership] = await Promise.all([
    getWorkspaceMembershipForUser(input.context.user.id, sourceWorkspaceId),
    getWorkspaceMembershipForUser(input.context.user.id, input.targetWorkspaceId),
  ]);

  if (!sourceMembership) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  if (!targetMembership) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  const [moved] = await input.context.db
    .update(coworker)
    .set({
      workspaceId: input.targetWorkspaceId,
      folderId: null,
      sharedAt: null,
      allowedWorkspaceMcpServerIds: [],
      builderConversationId: null,
    })
    .where(
      and(
        eq(coworker.id, input.coworkerId),
        eq(coworker.ownerId, input.context.user.id),
        eq(coworker.workspaceId, sourceWorkspaceId),
      ),
    )
    .returning();

  if (!moved) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  if (moved.triggerType === "schedule") {
    try {
      await syncCoworkerScheduleJob(moved);
    } catch (error) {
      console.error(`[coworker] failed to sync scheduler after move (${moved.id})`, error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Coworker moved but failed to sync schedule job",
      });
    }
  }

  return {
    id: moved.id,
    workspaceId: moved.workspaceId,
    sourceWorkspaceId,
    targetWorkspaceId: input.targetWorkspaceId,
    triggerType: moved.triggerType,
  };
}
