import { z } from "zod";
import {
  createCoworkerFolder,
  deleteCoworkerFolder,
  listVisibleCoworkerFolders,
  moveCoworkerFolder,
  moveCoworkerToFolder,
  normalizeFolderName,
  updateTopLevelCoworkerFolderVisibility,
} from "@/server/services/coworker-folder-domain";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

const visibilitySchema = z.enum(["private", "workspace"]);

function normalizeFolderPath(value: string) {
  return value.split("/").map(normalizeFolderName).filter(Boolean);
}

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

  return listVisibleCoworkerFolders({
    context,
    workspaceId,
    userId: context.user.id,
  });
});

const create = protectedProcedure
  .input(
    z.object({
      name: z.string().min(1).max(100),
      parentId: z.string().nullable().optional(),
      visibility: visibilitySchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    return createCoworkerFolder({
      context,
      workspaceId,
      userId: context.user.id,
      name: input.name,
      parentId: input.parentId ?? null,
      visibility: input.visibility,
    });
  });

const createPath = protectedProcedure
  .input(
    z.object({
      path: z.string().min(1).max(240),
      parentId: z.string().nullable().optional(),
      visibility: visibilitySchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    let parentId = input.parentId ?? null;
    let created = null as Awaited<ReturnType<typeof createCoworkerFolder>> | null;
    const pathParts = normalizeFolderPath(input.path);
    if (pathParts.length === 0) {
      throw new Error("Folder name is required.");
    }

    const createNext = async (
      index: number,
      currentParentId: string | null,
    ): Promise<typeof created> => {
      const name = pathParts[index];
      if (!name) {
        return created;
      }
      const next = await createCoworkerFolder({
        context,
        workspaceId,
        userId: context.user.id,
        name,
        parentId: currentParentId,
        visibility: index === 0 ? input.visibility : undefined,
      });
      created = next;
      return index === pathParts.length - 1 ? next : createNext(index + 1, next.id);
    };

    return createNext(0, parentId);
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

    return moveCoworkerToFolder({
      context,
      workspaceId,
      userId: context.user.id,
      coworkerId: input.coworkerId,
      folderId: input.folderId,
    });
  });

const moveFolder = protectedProcedure
  .input(
    z.object({
      folderId: z.string(),
      parentId: z.string().nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    return moveCoworkerFolder({
      context,
      workspaceId,
      userId: context.user.id,
      folderId: input.folderId,
      parentId: input.parentId,
    });
  });

const updateVisibility = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      visibility: visibilitySchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    return updateTopLevelCoworkerFolderVisibility({
      context,
      workspaceId,
      userId: context.user.id,
      folderId: input.id,
      visibility: input.visibility,
    });
  });

const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    return deleteCoworkerFolder({
      context,
      workspaceId,
      userId: context.user.id,
      folderId: input.id,
    });
  });

export const coworkerFolderRouter = {
  list,
  create,
  createPath,
  moveCoworker,
  moveFolder,
  updateVisibility,
  delete: del,
};
