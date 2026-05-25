import type { ToolExtraArguments } from "xmcp";
import { getManagedModulrCredentials } from "../../../../shared/control-plane";
import { ModulrClient, type ModulrCredentials } from "./modulr-client";

type ManagedModulrClaims = {
  userId: string;
  workspaceId: string;
  audience: string;
  internalKey?: string;
};

export async function getManagedModulrCredentialsForTool(
  extra?: ToolExtraArguments,
): Promise<ModulrCredentials> {
  const claims = extra?.authInfo?.extra as ManagedModulrClaims | undefined;
  const isModulrAudience = claims?.audience === "modulr" || claims?.internalKey === "modulr";
  if (!claims?.userId || !claims.workspaceId || !isModulrAudience) {
    throw new Error("Managed Modulr MCP authentication is required.");
  }

  return getManagedModulrCredentials({
    userId: claims.userId,
    workspaceId: claims.workspaceId,
  });
}

export async function createManagedModulrClient(extra?: ToolExtraArguments) {
  return new ModulrClient(await getManagedModulrCredentialsForTool(extra));
}
