import { env } from "../../env";
import { requireActiveWorkspaceForUser } from "../billing/service";
import { signManagedMcpToken } from "../managed-mcp-auth";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";
import type { RuntimeMcpServer } from "./core/types";

export const CMDCLAW_PLATFORM_MCP_SERVER_NAME = "cmdclaw";
export const CMDCLAW_PLATFORM_MCP_INTERNAL_KEY = "cmdclaw";

// The platform token is minted once at generation start and embedded as a static
// Authorization header for the whole turn (it is re-minted each generation when the
// MCP set is reconciled). It must therefore outlive a single generation's run
// deadline, otherwise CmdClaw tool calls in the tail of a long run fail auth.
// Unlike the workspace managed-token path, there is no mid-run refresh.
const PLATFORM_MCP_TOKEN_BUFFER_SECONDS = 5 * 60;
export const PLATFORM_MCP_TOKEN_TTL_SECONDS =
  Math.ceil(generationLifecyclePolicy.runDeadlineMs / 1000) + PLATFORM_MCP_TOKEN_BUFFER_SECONDS;

// Platform MCP Server (see CONTEXT.md / ADR-0013): hard-wired into every
// generation, never represented as a workspaceMcpServer row and never part of
// the Workspace MCP Server Allowlist.
export function buildCmdclawPlatformMcpServer(input: {
  userId: string;
  workspaceId: string;
  spawnDepth: number;
  baseUrl: string;
  secret: string;
  nowSeconds?: number;
}): RuntimeMcpServer {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const token = signManagedMcpToken(
    {
      userId: input.userId,
      workspaceId: input.workspaceId,
      internalKey: CMDCLAW_PLATFORM_MCP_INTERNAL_KEY,
      spawnDepth: input.spawnDepth,
      exp: nowSeconds + PLATFORM_MCP_TOKEN_TTL_SECONDS,
    },
    input.secret,
  );

  return {
    type: "http",
    name: CMDCLAW_PLATFORM_MCP_SERVER_NAME,
    url: new URL("/cmdclaw", input.baseUrl).toString(),
    headers: [{ name: "Authorization", value: `Bearer ${token}` }],
  };
}

export type PlatformMcpServerResolution =
  | { server: RuntimeMcpServer }
  | { server: null; warning: { serverName: string; message: string } };

export async function resolveCmdclawPlatformMcpServer(input: {
  userId: string;
  workspaceId?: string | null;
  spawnDepth: number;
}): Promise<PlatformMcpServerResolution> {
  const baseUrl = env.APP_MCP_BASE_URL?.trim() || env.APP_MCP_BASE_URL?.trim();
  const secret = env.APP_SERVER_SECRET;
  if (!baseUrl || !secret) {
    return {
      server: null,
      warning: {
        serverName: CMDCLAW_PLATFORM_MCP_SERVER_NAME,
        message:
          "CmdClaw tools are unavailable: platform MCP server is not configured (APP_MCP_BASE_URL / APP_SERVER_SECRET).",
      },
    };
  }

  try {
    const workspaceId =
      input.workspaceId ?? (await requireActiveWorkspaceForUser(input.userId)).id;
    return {
      server: buildCmdclawPlatformMcpServer({
        userId: input.userId,
        workspaceId,
        spawnDepth: input.spawnDepth,
        baseUrl,
        secret,
      }),
    };
  } catch (error) {
    return {
      server: null,
      warning: {
        serverName: CMDCLAW_PLATFORM_MCP_SERVER_NAME,
        message: `CmdClaw tools are unavailable: ${
          error instanceof Error ? error.message : "failed to resolve workspace"
        }`,
      },
    };
  }
}
