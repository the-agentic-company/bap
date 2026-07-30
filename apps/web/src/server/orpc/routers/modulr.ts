import { listWorkspaceMcpServers } from "@bap/core/server/executor/workspace-sources";
import {
  addModulrWorkspaceAccess,
  canUserUseModulrInWorkspace,
  deleteModulrWorkspaceConnection,
  getModulrWorkspaceConnectionStatus,
  getModulrWorkspaceWideAccess,
  listModulrWorkspaceAccess,
  MODULR_DEFAULT_BASE_URL,
  normalizeModulrWorkspaceConnection,
  removeModulrWorkspaceAccess,
  setModulrWorkspaceConnection,
  setModulrWorkspaceWideAccess,
  validateModulrWorkspaceConnection,
} from "@bap/core/server/modulr/service";
import { user, workspace } from "@bap/db/schema";
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

const connectionInput = z.object({
  database: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  locale: z.enum(["fr", "en"]).default("fr"),
  baseUrl: z.literal(MODULR_DEFAULT_BASE_URL).default(MODULR_DEFAULT_BASE_URL),
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
  const access = await requireActiveWorkspaceAccess(context.user.id);
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
  const access = await requireActiveWorkspaceAccess(context.user.id);
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
  await listWorkspaceMcpServers({
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
  const access = await requireActiveWorkspaceAccess(context.user.id);
  await deleteModulrWorkspaceConnection({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
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

const adminGetWorkspaceWideAccess = protectedProcedure
  .input(z.object({ workspaceId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    await requireAdmin(context);
    await assertWorkspaceExists(context, input.workspaceId);
    await listWorkspaceMcpServers({
      database: context.db,
      workspaceId: input.workspaceId,
      userId: context.user.id,
      includeAllCustomSources: true,
    });
    return getModulrWorkspaceWideAccess({
      database: context.db,
      workspaceId: input.workspaceId,
    });
  });

const adminSetWorkspaceWideAccess = protectedProcedure
  .input(z.object({ workspaceId: z.string().min(1), enabled: z.boolean() }))
  .handler(async ({ input, context }) => {
    await requireAdmin(context);
    await assertWorkspaceExists(context, input.workspaceId);
    await listWorkspaceMcpServers({
      database: context.db,
      workspaceId: input.workspaceId,
      userId: context.user.id,
      includeAllCustomSources: true,
    });
    const result = await setModulrWorkspaceWideAccess({
      database: context.db,
      workspaceId: input.workspaceId,
      enabled: input.enabled,
    });
    if (!result) {
      throw new ORPCError("NOT_FOUND", { message: "Modulr MCP Server not found." });
    }
    return result;
  });

export const modulrRouter = {
  status,
  test,
  connect,
  disconnect,
  adminListAccess,
  adminAddAccess,
  adminRemoveAccess,
  adminGetWorkspaceWideAccess,
  adminSetWorkspaceWideAccess,
};
