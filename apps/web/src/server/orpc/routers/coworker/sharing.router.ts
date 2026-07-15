import { coworker } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { requireOwnedCoworkerInActiveWorkspace } from "./access";
import { getResolvedCoworkerToolPolicy } from "@/server/services/coworker-toolbox";

const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    if (wf.folderId) {
      throw new Error("Folder-contained coworker sharing is controlled by its folder.");
    }
    const [shared] = await context.db
      .update(coworker)
      .set({ sharedAt: new Date() })
      .where(
        and(
          eq(coworker.id, wf.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      )
      .returning({ id: coworker.id, sharedAt: coworker.sharedAt });

    return {
      success: true,
      id: shared?.id ?? wf.id,
      sharedAt: shared?.sharedAt ?? new Date(),
    };
  });

const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    if (wf.folderId) {
      throw new Error("Folder-contained coworker sharing is controlled by its folder.");
    }
    await context.db
      .update(coworker)
      .set({ sharedAt: null })
      .where(
        and(
          eq(coworker.id, wf.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  });

const listShared = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(eq(coworker.workspaceId, workspaceId)),
    with: {
      owner: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      documents: {
        columns: { id: true },
      },
    },
    orderBy: (wf, { desc }) => [desc(wf.sharedAt), desc(wf.updatedAt)],
  });

  return coworkers
    .filter((wf) => wf.sharedAt)
    .map((wf) => {
      const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);
      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        username: wf.username,
        folderId: wf.folderId,
        status: wf.status,
        disabledReason: wf.disabledReason,
        triggerType: wf.triggerType,
        toolAccessMode,
        allowedIntegrations: wf.allowedIntegrations,
        allowedSkillSlugs,
        allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
        prompt: wf.prompt,
        model: wf.model,
        sharedAt: wf.sharedAt,
        updatedAt: wf.updatedAt,
        owner: {
          id: wf.owner.id,
          name: wf.owner.name,
          email: wf.owner.email,
        },
        documentCount: wf.documents.length,
        isOwnedByCurrentUser: wf.ownerId === context.user.id,
      };
    });
});

export const coworkerSharingProcedures = {
  share,
  unshare,
  listShared,
};
