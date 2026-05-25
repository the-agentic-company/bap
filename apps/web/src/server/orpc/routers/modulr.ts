import {
  addModulrWorkspaceAccess,
  canUserUseModulrInWorkspace,
  deleteModulrWorkspaceConnection,
  getModulrWorkspaceConnectionStatus,
  listModulrWorkspaceAccess,
  normalizeModulrWorkspaceConnection,
  removeModulrWorkspaceAccess,
  setModulrWorkspaceConnection,
  validateModulrWorkspaceConnection,
} from "@cmdclaw/core/server/modulr/service";
import { listWorkspaceExecutorSources } from "@cmdclaw/core/server/executor/workspace-sources";
import { user, workspace } from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { AuthenticatedContext } from "../middleware";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";
import { z } from "zod";

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

const connectionInput = z.object({
  database: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  locale: z.enum(["fr", "en"]).default("fr"),
  baseUrl: z.string().url().default("https://app.modulr-courtage.fr"),
});

const status = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id);
  return getModulrWorkspaceConnectionStatus({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
});

const test = protectedProcedure.input(connectionInput).handler(async ({ input, context }) => {
  const access = await requireActiveWorkspaceAdmin(context.user.id);
  const allowed = await canUserUseModulrInWorkspace({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
  if (!allowed) {
    throw new ORPCError("FORBIDDEN", {
      message: "Modulr is not enabled for this user in this workspace.",
    });
  }
  return validateModulrWorkspaceConnection(normalizeModulrWorkspaceConnection(input));
});

const connect = protectedProcedure.input(connectionInput).handler(async ({ input, context }) => {
  const access = await requireActiveWorkspaceAdmin(context.user.id);
  const allowed = await canUserUseModulrInWorkspace({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
  if (!allowed) {
    throw new ORPCError("FORBIDDEN", {
      message: "Modulr is not enabled for this user in this workspace.",
    });
  }
  await listWorkspaceExecutorSources({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
  });

  await setModulrWorkspaceConnection({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
    connection: normalizeModulrWorkspaceConnection(input),
  });

  return getModulrWorkspaceConnectionStatus({
    database: context.db,
    userId: context.user.id,
    workspaceId: access.workspace.id,
  });
});

const disconnect = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAdmin(context.user.id);
  await deleteModulrWorkspaceConnection({
    database: context.db,
    workspaceId: access.workspace.id,
  });
  return getModulrWorkspaceConnectionStatus({
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
    return listModulrWorkspaceAccess({
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
    return addModulrWorkspaceAccess({
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
    const removed = await removeModulrWorkspaceAccess({
      database: context.db,
      id: input.id,
    });
    if (!removed) {
      throw new ORPCError("NOT_FOUND", { message: "Modulr access entry not found." });
    }
    return removed;
  });

export const modulrRouter = {
  status,
  test,
  connect,
  disconnect,
  adminListAccess,
  adminAddAccess,
  adminRemoveAccess,
};
