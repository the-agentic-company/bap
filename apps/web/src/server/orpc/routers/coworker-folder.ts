import { coworker, coworkerFolder } from "@cmdclaw/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

function normalizeFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeFolderPath(value: string) {
  return value.split("/").map(normalizeFolderName).filter(Boolean);
}

async function requireWorkspaceFolder(
  context: Parameters<Parameters<typeof protectedProcedure.handler>[0]>[0]["context"],
  folderId: string,
  workspaceId: string,
) {
  const folder = await context.db.query.coworkerFolder.findFirst({
    where: and(eq(coworkerFolder.id, folderId), eq(coworkerFolder.workspaceId, workspaceId)),
  });

  if (!folder) {
    throw new Error("Folder not found.");
  }

  return folder;
}

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

  return context.db.query.coworkerFolder.findMany({
    where: eq(coworkerFolder.workspaceId, workspaceId),
    orderBy: (folder, { asc }) => [asc(folder.parentId), asc(folder.position), asc(folder.name)],
  });
});

const createPath = protectedProcedure
  .input(
    z.object({
      path: z.string().min(1).max(240),
      parentId: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    let parentId = input.parentId ?? null;
    if (parentId) {
      await requireWorkspaceFolder(context, parentId, workspaceId);
    }

    const pathParts = normalizeFolderPath(input.path);
    if (pathParts.length === 0) {
      throw new Error("Folder name is required.");
    }

    const ensureFolderPath = async (
      remainingPath: string[],
      currentParentId: string | null,
    ): Promise<typeof coworkerFolder.$inferSelect | null> => {
      const [name, ...rest] = remainingPath;
      if (!name) {
        return null;
      }

      const existing = await context.db.query.coworkerFolder.findFirst({
        where: and(
          eq(coworkerFolder.workspaceId, workspaceId),
          eq(coworkerFolder.name, name),
          currentParentId
            ? eq(coworkerFolder.parentId, currentParentId)
            : isNull(coworkerFolder.parentId),
        ),
      });

      if (existing) {
        return rest.length > 0 ? ensureFolderPath(rest, existing.id) : existing;
      }

      const [created] = await context.db
        .insert(coworkerFolder)
        .values({
          workspaceId,
          parentId: currentParentId,
          name,
        })
        .returning();

      return rest.length > 0 ? ensureFolderPath(rest, created?.id ?? null) : (created ?? null);
    };

    return ensureFolderPath(pathParts, parentId);
  });

const moveCoworker = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      folderId: z.string().nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    const existingCoworker = await context.db.query.coworker.findFirst({
      where: and(
        eq(coworker.id, input.coworkerId),
        eq(coworker.ownerId, context.user.id),
        eq(coworker.workspaceId, workspaceId),
      ),
    });

    if (!existingCoworker) {
      throw new Error("Coworker not found.");
    }

    if (input.folderId) {
      await requireWorkspaceFolder(context, input.folderId, workspaceId);
    }

    const [updated] = await context.db
      .update(coworker)
      .set({ folderId: input.folderId })
      .where(
        and(
          eq(coworker.id, input.coworkerId),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      )
      .returning();

    return updated;
  });

const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    await context.db
      .delete(coworkerFolder)
      .where(and(eq(coworkerFolder.id, input.id), eq(coworkerFolder.workspaceId, workspaceId)));

    return { success: true as const };
  });

export const coworkerFolderRouter = {
  list,
  createPath,
  moveCoworker,
  delete: del,
};
