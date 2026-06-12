import type { ToolExtraArguments } from "xmcp";
import { createRpcClient, DEFAULT_SERVER_URL } from "@cmdclaw/client";

function resolveServerUrl(serverUrl?: string): string {
  return serverUrl || process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;
}

export function createMcpClient(extra?: ToolExtraArguments, serverUrl?: string) {
  const resolvedServerUrl = resolveServerUrl(serverUrl);
  const token = extra?.authInfo?.token;
  const audience = (extra?.authInfo?.extra as { audience?: string } | undefined)?.audience;

  if (!token || audience !== "cmdclaw") {
    return {
      status: "needs_auth" as const,
      serverUrl: resolvedServerUrl,
      message: "Authenticate with CmdClaw OAuth before using the CmdClaw MCP server.",
    };
  }

  return {
    status: "ready" as const,
    serverUrl: resolvedServerUrl,
    client: createRpcClient(resolvedServerUrl, token),
  };
}
