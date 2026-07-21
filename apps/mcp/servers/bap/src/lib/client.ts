import type { ToolExtraArguments } from "xmcp";
import { createRpcClient, DEFAULT_SERVER_URL } from "@bap/client";

function resolveServerUrl(): string {
  return process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;
}

export function createMcpClient(extra?: ToolExtraArguments, workspaceId?: string) {
  const resolvedServerUrl = resolveServerUrl();
  const token = extra?.authInfo?.token;
  const authClaims = extra?.authInfo?.extra as
    | {
        audience?: string;
        authType?: string;
        issuer?: string;
        surface?: "chat" | "coworker_builder" | "coworker_runner";
        generationId?: string;
        conversationId?: string;
        coworkerId?: string;
        coworkerRunId?: string;
      }
    | undefined;
  const audience = authClaims?.audience;

  if (!token || audience !== "bap") {
    return {
      status: "needs_auth" as const,
      serverUrl: resolvedServerUrl,
      message: "Authenticate with Bap OAuth before using the Bap MCP server.",
    };
  }

  const headers: Record<string, string> = {};
  if (authClaims?.authType === "hosted_oauth" && authClaims.issuer) {
    headers["X-Bap-Public-Origin"] = authClaims.issuer;
  }
  if (workspaceId) {
    headers["X-Bap-Workspace-Id"] = workspaceId;
  }

  return {
    status: "ready" as const,
    serverUrl: resolvedServerUrl,
    client: createRpcClient(
      resolvedServerUrl,
      token,
      Object.keys(headers).length > 0 ? headers : undefined,
    ),
  };
}
