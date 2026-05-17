import {
  DEFAULT_SERVER_URL,
  createRpcClient,
  defaultProfileStore,
  type CmdclawApiClient,
  type CmdclawProfile,
} from "@cmdclaw/client";

export function resolveServerUrl(serverUrl?: string): string {
  return serverUrl || process.env.CMDCLAW_SERVER_URL || DEFAULT_SERVER_URL;
}

function loadStoredProfile(serverUrl?: string): CmdclawProfile | null {
  return defaultProfileStore.load(resolveServerUrl(serverUrl));
}

function createAuthenticatedClient(params?: {
  serverUrl?: string;
  token?: string;
}): { serverUrl: string; profile: CmdclawProfile; client: CmdclawApiClient } {
  const serverUrl = resolveServerUrl(params?.serverUrl);
  const profile =
    params?.token !== undefined
      ? { serverUrl, token: params.token }
      : defaultProfileStore.load(serverUrl);

  if (!profile?.token) {
    throw new Error(
      `Not authenticated for ${serverUrl}. Run 'bun run cmdclaw -- auth login --server ${serverUrl}' first.`,
    );
  }

  return {
    serverUrl,
    profile,
    client: createRpcClient(serverUrl, profile.token),
  };
}
