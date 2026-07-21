import type { BapApiClient } from "@bap/client";
import { isManagedBapToolAllowed } from "@bap/core/server/managed-bap-capabilities";
import type { ToolExtraArguments } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "./client";
import { buildBapToolError, buildBapToolResult } from "./result-contract";

export async function executeBapTool(
  extra: ToolExtraArguments | undefined,
  workspaceId: string | undefined,
  action: string,
  operation: (client: BapApiClient) => Promise<unknown>,
) {
  const authClaims = extra?.authInfo?.extra as
    | { authType?: string; surface?: "chat" | "coworker_builder" | "coworker_runner" }
    | undefined;
  if (authClaims?.authType === "managed" && !isManagedBapToolAllowed(authClaims.surface, action)) {
    return toMcpToolResult(
      buildBapToolError({
        action,
        workspaceId,
        error: new Error(`Forbidden: managed Bap profile cannot call tool ${action}.`),
      }),
    );
  }
  const clientState = createMcpClient(extra, workspaceId);
  if (clientState.status !== "ready") return toMcpToolResult(clientState);
  try {
    return toMcpToolResult(
      buildBapToolResult({
        action,
        workspaceId,
        result: await operation(clientState.client),
      }),
    );
  } catch (error) {
    return toMcpToolResult(buildBapToolError({ action, workspaceId, error }));
  }
}
