import type { ManagedMcpSurface } from "./managed-mcp-auth";

export type ManagedBapCapabilityProfile = ManagedMcpSurface;

const CHAT_AND_BUILDER_TOOLS = [
  "workspace_list",
  "connectedAccount_read",
  "workspaceMcpServer_list",
  "skill_read",
  "skill_save",
  "coworker_read",
  "coworker_save",
  "coworkerDocument_save",
  "coworkerDocument_delete",
  "coworkerRun_start",
  "coworkerRun_read",
] as const;

export const MANAGED_BAP_TOOL_PROFILES = {
  chat: CHAT_AND_BUILDER_TOOLS,
  coworker_builder: CHAT_AND_BUILDER_TOOLS,
  coworker_runner: ["runner_markFailed"],
} as const satisfies Record<ManagedBapCapabilityProfile, readonly string[]>;

const CHAT_AND_BUILDER_RPC_PROCEDURES = [
  "billing/overview",
  "integration/list",
  "workspaceMcpServer/list",
  "skill/list",
  "skill/get",
  "skill/import",
  "skill/update",
  "skill/share",
  "skill/unshare",
  "skill/addFile",
  "skill/updateFile",
  "coworker/list",
  "coworker/get",
  "coworker/create",
  "coworker/update",
  "coworker/uploadDocument",
  "coworker/updateDocument",
  "coworker/deleteDocument",
  "coworker/trigger",
  "coworker/getRun",
  "coworker/listWorkspaceRuns",
  "coworkerFolder/moveCoworker",
  "conversation/get",
  "conversation/downloadSandboxFile",
  "generation/start",
] as const;

export const MANAGED_BAP_RPC_PROFILES = {
  chat: CHAT_AND_BUILDER_RPC_PROCEDURES,
  coworker_builder: CHAT_AND_BUILDER_RPC_PROCEDURES,
  coworker_runner: ["generation/markCurrentCoworkerRunFailed"],
} as const satisfies Record<ManagedBapCapabilityProfile, readonly string[]>;

export function resolveManagedBapProfile(
  surface: ManagedMcpSurface | undefined,
): ManagedBapCapabilityProfile {
  return surface ?? "chat";
}

export function isManagedBapToolAllowed(
  surface: ManagedMcpSurface | undefined,
  toolName: string,
): boolean {
  return (
    MANAGED_BAP_TOOL_PROFILES[resolveManagedBapProfile(surface)] as readonly string[]
  ).includes(toolName);
}

export function isManagedBapRpcAllowed(
  surface: ManagedMcpSurface | undefined,
  procedure: string,
): boolean {
  return (
    MANAGED_BAP_RPC_PROFILES[resolveManagedBapProfile(surface)] as readonly string[]
  ).includes(procedure);
}
