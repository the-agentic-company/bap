import type { ToolExtraArguments } from "xmcp";
import { createRpcClient, DEFAULT_SERVER_URL } from "@bap/client";

function resolveServerUrl(): string {
  return process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;
}

export function createMcpClient(extra?: ToolExtraArguments) {
  const resolvedServerUrl = resolveServerUrl();
  const token = extra?.authInfo?.token;
  const authClaims = extra?.authInfo?.extra as
    | { audience?: string; authType?: string; issuer?: string }
    | undefined;
  const audience = authClaims?.audience;

  if (!token || audience !== "bap") {
    return {
      status: "needs_auth" as const,
      serverUrl: resolvedServerUrl,
      message: "Authenticate with Bap OAuth before using the Bap MCP server.",
    };
  }

  return {
    status: "ready" as const,
    serverUrl: resolvedServerUrl,
    client: createRpcClient(
      resolvedServerUrl,
      token,
      authClaims?.authType === "hosted_oauth" && authClaims.issuer
        ? { "X-Bap-Public-Origin": authClaims.issuer }
        : undefined,
    ),
  };
}
