import { ORPCError } from "@orpc/server";
import type { HostedMcpContext, ORPCContext } from "./context";

function isHostedBapMcpContext(
  hostedMcp: HostedMcpContext | null | undefined,
): hostedMcp is HostedMcpContext {
  return hostedMcp?.audience === "bap";
}

export function canHostedMcpAccessWorkspace(
  hostedMcp: HostedMcpContext | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  if (!isHostedBapMcpContext(hostedMcp) || !workspaceId) {
    return true;
  }

  return hostedMcp.allowAllWorkspaces || hostedMcp.allowedWorkspaceIds.includes(workspaceId);
}

export function assertHostedMcpWorkspaceAccess(
  context: Pick<ORPCContext, "hostedMcp">,
  workspaceId: string | null | undefined,
  message = "This MCP authorization does not cover the requested workspace.",
) {
  if (canHostedMcpAccessWorkspace(context.hostedMcp, workspaceId)) {
    return;
  }

  throw new ORPCError("FORBIDDEN", { message });
}

export function assertHostedMcpAllWorkspaceAccess(
  context: Pick<ORPCContext, "hostedMcp">,
  message = "This action requires MCP authorization for all workspaces.",
) {
  if (!isHostedBapMcpContext(context.hostedMcp) || context.hostedMcp.allowAllWorkspaces) {
    return;
  }

  throw new ORPCError("FORBIDDEN", { message });
}
