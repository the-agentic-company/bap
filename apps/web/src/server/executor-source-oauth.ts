import type { McpOAuthSession } from "@cmdclaw/core/server/executor/mcp-oauth";
import { consumePending, getPending, storePending } from "@/server/ai/pending-oauth";

const WORKSPACE_MCP_SERVER_OAUTH_PROVIDER_PREFIX = "workspace_mcp_server:";

type PendingWorkspaceMcpServerOAuthPayload = {
  redirectUrl: string;
  session: McpOAuthSession;
};

function providerKeyForWorkspaceMcpServer(workspaceMcpServerId: string): string {
  return `${WORKSPACE_MCP_SERVER_OAUTH_PROVIDER_PREFIX}${workspaceMcpServerId}`;
}

function parsePendingPayload(raw: string): PendingWorkspaceMcpServerOAuthPayload {
  const parsed = JSON.parse(raw) as PendingWorkspaceMcpServerOAuthPayload;
  if (!parsed || typeof parsed !== "object" || typeof parsed.redirectUrl !== "string") {
    throw new Error("Invalid Workspace MCP Server OAuth payload.");
  }
  if (!parsed.session || typeof parsed.session !== "object") {
    throw new Error("Missing Workspace MCP Server OAuth session.");
  }
  return parsed;
}

export async function storeWorkspaceMcpServerOAuthPending(input: {
  state: string;
  userId: string;
  workspaceMcpServerId: string;
  redirectUrl: string;
  session: McpOAuthSession;
}) {
  await storePending(input.state, {
    userId: input.userId,
    provider: providerKeyForWorkspaceMcpServer(input.workspaceMcpServerId),
    codeVerifier: JSON.stringify({
      redirectUrl: input.redirectUrl,
      session: input.session,
    } satisfies PendingWorkspaceMcpServerOAuthPayload),
  });
}

async function readWorkspaceMcpServerOAuthPending(
  state: string,
  reader: typeof getPending | typeof consumePending,
) {
  const pending = await reader(state);
  if (!pending || !pending.provider.startsWith(WORKSPACE_MCP_SERVER_OAUTH_PROVIDER_PREFIX)) {
    return undefined;
  }

  const workspaceMcpServerId = pending.provider.slice(
    WORKSPACE_MCP_SERVER_OAUTH_PROVIDER_PREFIX.length,
  );
  if (!workspaceMcpServerId) {
    return undefined;
  }

  return {
    userId: pending.userId,
    workspaceMcpServerId,
    ...parsePendingPayload(pending.codeVerifier),
  };
}

export async function consumeWorkspaceMcpServerOAuthPending(state: string) {
  return readWorkspaceMcpServerOAuthPending(state, consumePending);
}
