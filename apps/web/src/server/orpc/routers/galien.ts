import {
  addGalienWorkspaceAccess,
  deleteGalienCredential,
  GalienCredentialValidationError,
  getGalienAccessStatus,
  listGalienWorkspaceAccess,
  removeGalienWorkspaceAccess,
  setGalienCredential,
} from "@cmdclaw/core/server/galien/service";
import { user, workspace } from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedContext } from "../middleware";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

async function requireAdmin(context: Pick<AuthenticatedContext, "db" | "user">) {
  const currentUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true },
  });

  if (currentUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
  }
}

async function assertWorkspaceExists(
  context: Pick<AuthenticatedContext, "db">,
  workspaceId: string,
) {
  const selectedWorkspace = await context.db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: { id: true },
  });

  if (!selectedWorkspace) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found." });
  }
}

const status = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id);
  return getGalienAccessStatus({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
});

const connect = protectedProcedure
  .input(
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const accessStatus = await getGalienAccessStatus({
      database: context.db,
      userId: context.user.id,
      workspaceId: access.workspace.id,
    });
    if (!accessStatus.allowed) {
      throw new ORPCError("FORBIDDEN", {
        message: "Galien is not enabled for this user in this workspace.",
      });
    }

    try {
      await setGalienCredential({
        database: context.db,
        userId: context.user.id,
        username: input.username,
        password: input.password,
      });
    } catch (error) {
      if (error instanceof GalienCredentialValidationError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }

    return getGalienAccessStatus({
      database: context.db,
      userId: context.user.id,
      workspaceId: access.workspace.id,
    });
  });

const disconnect = protectedProcedure.handler(async ({ context }) => {
  await deleteGalienCredential({
    database: context.db,
    userId: context.user.id,
  });
  const access = await requireActiveWorkspaceAccess(context.user.id);
  return getGalienAccessStatus({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
});

const adminListAccess = protectedProcedure
  .input(z.object({ workspaceId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    await requireAdmin(context);
    await assertWorkspaceExists(context, input.workspaceId);
    return listGalienWorkspaceAccess({
      database: context.db,
      workspaceId: input.workspaceId,
    });
  });

const adminAddAccess = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().min(1),
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAdmin(context);
    await assertWorkspaceExists(context, input.workspaceId);
    return addGalienWorkspaceAccess({
      database: context.db,
      workspaceId: input.workspaceId,
      email: input.email,
      createdByUserId: context.user.id,
    });
  });

const adminRemoveAccess = protectedProcedure
  .input(z.object({ id: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    await requireAdmin(context);
    const removed = await removeGalienWorkspaceAccess({
      database: context.db,
      id: input.id,
    });
    if (!removed) {
      throw new ORPCError("NOT_FOUND", { message: "Galien access entry not found." });
    }
    return removed;
  });

export const galienRouter = {
  status,
  connect,
  disconnect,
  adminListAccess,
  adminAddAccess,
  adminRemoveAccess,
};
