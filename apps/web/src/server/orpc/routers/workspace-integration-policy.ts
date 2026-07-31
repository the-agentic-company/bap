import {
  listWorkspaceIntegrationPolicyCatalog,
  replaceWorkspaceIntegrationPolicy,
  type WorkspaceIntegrationPolicySubject,
} from "@bap/core/server/services/workspace-integration-policy";
import { workspaceMcpServer, workspaceMcpToolCatalog } from "@bap/db/schema";
import {
  MANAGED_INTEGRATION_TYPES,
  WORKSPACE_INTEGRATION_OPERATION_RESTRICTIONS,
  WORKSPACE_INTEGRATION_POLICY_MODES,
  getManagedOperationDescriptor,
} from "@bap/integration-policy";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { discoverWorkspaceMcpToolCatalog } from "@/server/internal/workspace-mcp-tool-discovery";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";

export const workspaceIntegrationPolicySubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("integration"),
    integrationType: z.enum(MANAGED_INTEGRATION_TYPES),
  }),
  z.object({
    kind: z.literal("workspace_mcp_server"),
    workspaceMcpServerId: z.string().min(1),
  }),
]);

const list = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  return {
    workspaceId: access.workspace.id,
    membershipRole: access.membership.role,
    canEdit: access.membership.role === "owner" || access.membership.role === "admin",
    catalog: await listWorkspaceIntegrationPolicyCatalog({
      database: context.db,
      workspaceId: access.workspace.id,
    }),
  };
});

const discover = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  await discoverWorkspaceMcpToolCatalog({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
  });
  return { success: true };
});

const replace = protectedProcedure
  .input(
    z.object({
      subject: workspaceIntegrationPolicySubjectSchema,
      mode: z.enum(WORKSPACE_INTEGRATION_POLICY_MODES),
      restrictions: z
        .array(
          z.object({
            operationKey: z.string().min(1),
            restriction: z.enum(WORKSPACE_INTEGRATION_OPERATION_RESTRICTIONS),
          }),
        )
        .default([]),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id, context.workspaceId);
    const subject = input.subject as WorkspaceIntegrationPolicySubject;

    if (subject.kind === "integration") {
      for (const restriction of input.restrictions) {
        if (!getManagedOperationDescriptor(subject.integrationType, restriction.operationKey)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Unknown ${subject.integrationType} operation: ${restriction.operationKey}`,
          });
        }
      }
    } else {
      const server = await context.db.query.workspaceMcpServer.findFirst({
        where: and(
          eq(workspaceMcpServer.id, subject.workspaceMcpServerId),
          eq(workspaceMcpServer.workspaceId, access.workspace.id),
        ),
        columns: { id: true, internalKey: true },
      });
      if (!server) {
        throw new ORPCError("NOT_FOUND", {
          message: "Workspace MCP Server not found.",
        });
      }
      if (server.internalKey === "gmail" || server.internalKey === "bap") {
        throw new ORPCError("BAD_REQUEST", {
          message:
            server.internalKey === "gmail"
              ? "Gmail policy is managed through the Gmail Integration Type."
              : "Platform MCP Servers are not governed by Workspace integration policy.",
        });
      }

      if (input.restrictions.length > 0) {
        const knownTools = await context.db.query.workspaceMcpToolCatalog.findMany({
          where: eq(workspaceMcpToolCatalog.workspaceMcpServerId, server.id),
          columns: { toolName: true },
        });
        const knownToolNames = new Set(knownTools.map((tool) => tool.toolName));
        const unknown = input.restrictions.find((entry) => !knownToolNames.has(entry.operationKey));
        if (unknown) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Unknown Workspace MCP tool: ${unknown.operationKey}`,
          });
        }
      }
    }

    try {
      return await replaceWorkspaceIntegrationPolicy({
        database: context.db,
        workspaceId: access.workspace.id,
        subject,
        mode: input.mode,
        restrictions: input.restrictions,
        actorUserId: context.user.id,
      });
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Invalid integration policy.",
      });
    }
  });

export const workspaceIntegrationPolicyRouter = {
  discover,
  list,
  replace,
};
