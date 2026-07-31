import { coworker } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { requireCoworkerActionInActiveWorkspace } from "./access";
import { getResolvedCoworkerToolPolicy } from "@/server/services/coworker-toolbox";

const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireCoworkerActionInActiveWorkspace(
      context,
      input.id,
      "change_visibility",
    );
    if (wf.folderId) {
      throw new Error("Folder-contained coworker sharing is controlled by its folder.");
    }
    const [shared] = await context.db
      .update(coworker)
      .set({ publishedAt: new Date() })
      .where(and(eq(coworker.id, wf.id), eq(coworker.workspaceId, workspaceId)))
      .returning({ id: coworker.id, publishedAt: coworker.publishedAt });

    return {
      success: true,
      id: shared?.id ?? wf.id,
      publishedAt: shared?.publishedAt ?? new Date(),
    };
  });

const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireCoworkerActionInActiveWorkspace(
      context,
      input.id,
      "change_visibility",
    );
    if (wf.folderId) {
      throw new Error("Folder-contained coworker sharing is controlled by its folder.");
    }
    await context.db
      .update(coworker)
      .set({ publishedAt: null })
      .where(and(eq(coworker.id, wf.id), eq(coworker.workspaceId, workspaceId)));

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
    orderBy: (wf, { desc }) => [desc(wf.publishedAt), desc(wf.updatedAt)],
  });

  return coworkers
    .filter((wf) => wf.publishedAt)
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
        publishedAt: wf.publishedAt,
        updatedAt: wf.updatedAt,
        owner: {
          id: wf.owner?.id ?? wf.createdByUserId ?? "",
          name: wf.owner?.name ?? wf.createdByNameSnapshot ?? "Former member",
          email: wf.owner?.email ?? "",
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
