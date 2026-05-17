import type { IntegrationType } from "../oauth/config";

type CloudAccountLink = {
  cloudUserId: string;
  status: string;
  linkedAt: string;
  updatedAt: string;
};

export type IntegrationLinkStatus = {
  id: string;
  type: IntegrationType;
  displayName: string | null;
  enabled: boolean;
  setupRequired: boolean;
  instanceName: string | null;
  instanceUrl: string | null;
  authStatus: string;
  authErrorCode: string | null;
  scopes: string[] | null;
  createdAt: string;
};

export type DelegatedRuntimeCredentialsRequest = {
  integrationTypes: string[];
  workspaceId?: string;
  allowedExecutorSourceIds?: string[];
};

export type DelegatedRuntimeCredentialsResponse = {
  cliEnv: Record<string, string>;
  tokens: Record<string, string>;
  enabledIntegrations: string[];
  connectedProviders: string[];
  providerAuths: Array<{
    provider: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
  }>;
  executorBootstrap: {
    revisionHash: string;
    configJson: string;
    workspaceStateJson: string;
    sources: Array<{
      id: string;
      name: string;
      namespace: string;
      kind: string;
      internalKey?: string | null;
      enabled: boolean;
      connected: boolean;
    }>;
  } | null;
  issuedAt: string;
};

export type ControlPlaneHealthStatus = {
  ok: boolean;
  edition: "cloud";
  checkedAt: string;
};

export type ProviderAuthStatusPayload = {
  connected: string[];
};

export type CloudAuthExchangePayload = {
  cloudUserId: string;
  email: string;
  name: string | null;
  image: string | null;
};
