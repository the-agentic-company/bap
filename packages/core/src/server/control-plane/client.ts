import { isSelfHostedEdition } from "../edition";
import type {
  CloudAuthExchangePayload,
  ControlPlaneHealthStatus,
  DelegatedRuntimeCredentialsRequest,
  DelegatedRuntimeCredentialsResponse,
  IntegrationLinkStatus,
  ProviderAuthStatusPayload,
} from "./types";
import { createControlPlaneAuthState } from "./local-auth";
import { createCloudAccountLinkState, getCloudAccountLinkForUser } from "./local-links";

const INSTANCE_API_KEY_HEADER = "x-cmdclaw-instance-api-key";

function requireControlPlaneConfig() {
  const baseUrl = process.env.CMDCLAW_CLOUD_API_BASE_URL;
  const instanceApiKey = process.env.CMDCLAW_CLOUD_INSTANCE_API_KEY;

  if (!baseUrl || !instanceApiKey) {
    throw new Error("Cloud control plane is not configured");
  }

  return { baseUrl, instanceApiKey };
}

function requireAppUrl() {
  const appUrl = process.env.APP_URL ?? process.env.VITE_APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL is not configured");
  }

  return appUrl;
}

async function callControlPlane<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, instanceApiKey } = requireControlPlaneConfig();

  const response = await fetch(new URL(path, baseUrl).toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      [INSTANCE_API_KEY_HEADER]: instanceApiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Control plane request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function requireLinkedCloudUserId(userId: string): Promise<string> {
  const link = await getCloudAccountLinkForUser(userId);
  if (!link?.cloudUserId) {
    throw new Error("Cloud account is not linked");
  }
  return link.cloudUserId;
}

export function isControlPlaneEnabled(): boolean {
  return isSelfHostedEdition();
}

export async function getControlPlaneHealth(): Promise<ControlPlaneHealthStatus> {
  return callControlPlane<ControlPlaneHealthStatus>("/api/control-plane/health");
}

export async function listCloudManagedIntegrations(userId: string): Promise<IntegrationLinkStatus[]> {
  const cloudUserId = await requireLinkedCloudUserId(userId);
  return callControlPlane<IntegrationLinkStatus[]>("/api/control-plane/integrations/status", {
    method: "POST",
    body: JSON.stringify({ cloudUserId }),
  });
}

export async function toggleCloudManagedIntegration(params: {
  userId: string;
  integrationId: string;
  enabled: boolean;
}) {
  const cloudUserId = await requireLinkedCloudUserId(params.userId);
  return callControlPlane<{ success: true }>("/api/control-plane/integrations/toggle", {
    method: "POST",
    body: JSON.stringify({
      cloudUserId,
      integrationId: params.integrationId,
      enabled: params.enabled,
    }),
  });
}

export async function disconnectCloudManagedIntegration(params: {
  userId: string;
  integrationId: string;
}) {
  const cloudUserId = await requireLinkedCloudUserId(params.userId);
  return callControlPlane<{ success: true }>("/api/control-plane/integrations/disconnect", {
    method: "POST",
    body: JSON.stringify({
      cloudUserId,
      integrationId: params.integrationId,
    }),
  });
}

export async function getDelegatedRuntimeCredentials(
  userId: string,
  input: DelegatedRuntimeCredentialsRequest,
): Promise<DelegatedRuntimeCredentialsResponse> {
  const cloudUserId = await requireLinkedCloudUserId(userId);
  return callControlPlane<DelegatedRuntimeCredentialsResponse>(
    "/api/control-plane/runtime-credentials",
    {
      method: "POST",
      body: JSON.stringify({
        cloudUserId,
        integrationTypes: input.integrationTypes,
        workspaceId: input.workspaceId,
        allowedWorkspaceMcpServerIds: input.allowedWorkspaceMcpServerIds,
      }),
    },
  );
}

export async function getCloudManagedProviderAuthStatus(
  userId: string,
): Promise<ProviderAuthStatusPayload> {
  const cloudUserId = await requireLinkedCloudUserId(userId);
  return callControlPlane<ProviderAuthStatusPayload>("/api/control-plane/provider-auth/status", {
    method: "POST",
    body: JSON.stringify({ cloudUserId }),
  });
}

export async function disconnectCloudManagedProviderAuth(params: {
  userId: string;
  provider: string;
}) {
  const cloudUserId = await requireLinkedCloudUserId(params.userId);
  return callControlPlane<{ success: true }>("/api/control-plane/provider-auth/disconnect", {
    method: "POST",
    body: JSON.stringify({
      cloudUserId,
      provider: params.provider,
    }),
  });
}

export async function getDelegatedProviderAuths(userId: string) {
  const delegated = await getDelegatedRuntimeCredentials(userId, { integrationTypes: [] });
  return delegated.providerAuths;
}

export async function startCloudAccountLink(params: {
  userId: string;
  requestedIntegrationType?: string | null;
  returnPath?: string | null;
}): Promise<string> {
  requireControlPlaneConfig();
  const appUrl = requireAppUrl();

  const localState = await createCloudAccountLinkState({
    userId: params.userId,
    requestedIntegrationType: params.requestedIntegrationType ?? null,
    returnPath: params.returnPath ?? null,
  });

  const result = await callControlPlane<{ authorizeUrl: string }>("/api/control-plane/link/start", {
    method: "POST",
    body: JSON.stringify({
      localState,
      requestedIntegrationType: params.requestedIntegrationType ?? null,
      returnUrl: new URL("/api/control-plane/link/callback", appUrl).toString(),
    }),
  });

  return result.authorizeUrl;
}

export async function exchangeCloudAccountLink(code: string): Promise<string> {
  const result = await callControlPlane<{ cloudUserId: string }>("/api/control-plane/link/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

  return result.cloudUserId;
}

export async function startCloudAuth(params: { returnPath?: string | null }): Promise<string> {
  requireControlPlaneConfig();
  const appUrl = requireAppUrl();

  const localState = await createControlPlaneAuthState({
    returnPath: params.returnPath ?? null,
  });

  const result = await callControlPlane<{ authorizeUrl: string }>("/api/control-plane/auth/start", {
    method: "POST",
    body: JSON.stringify({
      localState,
      returnPath: params.returnPath ?? null,
      returnUrl: new URL("/api/control-plane/auth/callback", appUrl).toString(),
    }),
  });

  return result.authorizeUrl;
}

export async function exchangeCloudAuth(code: string): Promise<CloudAuthExchangePayload> {
  return callControlPlane<CloudAuthExchangePayload>("/api/control-plane/auth/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function getCloudManagedIntegrationConnectUrl(type: string): string {
  const { baseUrl } = requireControlPlaneConfig();
  return new URL(
    `/api/control-plane/integrations/connect?type=${encodeURIComponent(type)}`,
    baseUrl,
  ).toString();
}

export function getCloudManagedSubscriptionsUrl(): string {
  const { baseUrl } = requireControlPlaneConfig();
  return new URL("/settings/subscriptions", baseUrl).toString();
}
