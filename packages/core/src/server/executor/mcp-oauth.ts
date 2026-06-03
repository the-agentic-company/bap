import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | ReadonlyArray<JsonValue>;

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type McpOAuthMetadata = {
  tokenType: string;
  scope: string | null;
  redirectUri: string;
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
  resourceMetadata: JsonObject | null;
  authorizationServerMetadata: JsonObject | null;
  clientInformation: JsonObject | null;
};

export type McpOAuthSession = {
  endpoint: string;
  redirectUrl: string;
  codeVerifier: string;
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
  resourceMetadata: JsonObject | null;
  authorizationServerMetadata: JsonObject | null;
  clientInformation: JsonObject | null;
};

export type McpOAuthCredential = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  metadata: McpOAuthMetadata;
};

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function toJsonObject(value: unknown): JsonObject | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function expiresAtFromTokens(tokens: OAuthTokens): Date | null {
  return typeof tokens.expires_in === "number"
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;
}

function expiresInSeconds(expiresAt: Date | null): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveCmdClawLogoUrl(redirectUrl: string): string {
  const baseUrlCandidates = [
    process.env.APP_URL?.trim(),
    process.env.VITE_APP_URL?.trim(),
    redirectUrl,
  ];

  for (const candidate of baseUrlCandidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsedCandidate = new URL(candidate);
      if (!isLoopbackHostname(parsedCandidate.hostname)) {
        return new URL("/logo.png", parsedCandidate).toString();
      }
    } catch {
      // Ignore invalid URLs and continue to the public fallback.
    }
  }

  return "https://cmdclaw.ai/logo.png";
}

export function buildMcpOAuthClientMetadata(redirectUrl: string) {
  return {
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_name: "CmdClaw",
    logo_uri: resolveCmdClawLogoUrl(redirectUrl),
  };
}

export function resolveMcpEndpoint(input: {
  endpoint: string;
  queryParams?: Readonly<Record<string, string>> | null;
}): string {
  const url = new URL(input.endpoint);
  for (const [key, value] of Object.entries(input.queryParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function startMcpOAuthAuthorization(input: {
  endpoint: string;
  redirectUrl: string;
  state: string;
}): Promise<{
  authorizationUrl: string;
  session: McpOAuthSession;
}> {
  const captured: {
    authorizationUrl?: URL;
    codeVerifier?: string;
    discoveryState?: OAuthDiscoveryState;
    clientInformation?: OAuthClientInformationMixed;
  } = {};

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return input.redirectUrl;
    },
    get clientMetadata() {
      return buildMcpOAuthClientMetadata(input.redirectUrl);
    },
    state: () => input.state,
    clientInformation: () => captured.clientInformation,
    saveClientInformation: (clientInformation) => {
      captured.clientInformation = clientInformation;
    },
    tokens: () => undefined,
    saveTokens: () => undefined,
    redirectToAuthorization: (authorizationUrl) => {
      captured.authorizationUrl = authorizationUrl;
    },
    saveCodeVerifier: (codeVerifier) => {
      captured.codeVerifier = codeVerifier;
    },
    codeVerifier: () => {
      if (!captured.codeVerifier) {
        throw new Error("OAuth code verifier was not captured");
      }

      return captured.codeVerifier;
    },
    saveDiscoveryState: (state) => {
      captured.discoveryState = state;
    },
    discoveryState: () => captured.discoveryState,
  };

  const result = await auth(provider, {
    serverUrl: input.endpoint,
  }).catch((cause) => {
    throw toError(cause);
  });

  if (result !== "REDIRECT" || !captured.authorizationUrl || !captured.codeVerifier) {
    throw new Error("MCP OAuth flow did not produce an authorization redirect.");
  }

  return {
    authorizationUrl: captured.authorizationUrl.toString(),
    session: {
      endpoint: input.endpoint,
      redirectUrl: input.redirectUrl,
      codeVerifier: captured.codeVerifier,
      resourceMetadataUrl: captured.discoveryState?.resourceMetadataUrl ?? null,
      authorizationServerUrl: captured.discoveryState?.authorizationServerUrl ?? null,
      resourceMetadata: toJsonObject(captured.discoveryState?.resourceMetadata),
      authorizationServerMetadata: toJsonObject(
        captured.discoveryState?.authorizationServerMetadata,
      ),
      clientInformation: toJsonObject(captured.clientInformation),
    },
  };
}

export async function exchangeMcpOAuthAuthorizationCode(input: {
  session: McpOAuthSession;
  code: string;
}): Promise<McpOAuthCredential> {
  const captured: {
    tokens?: OAuthTokens;
    discoveryState?: OAuthDiscoveryState;
    clientInformation?: OAuthClientInformationMixed;
  } = {
    discoveryState: {
      authorizationServerUrl:
        input.session.authorizationServerUrl ?? new URL("/", input.session.endpoint).toString(),
      resourceMetadataUrl: input.session.resourceMetadataUrl ?? undefined,
      resourceMetadata: input.session.resourceMetadata as OAuthDiscoveryState["resourceMetadata"],
      authorizationServerMetadata:
        input.session.authorizationServerMetadata as OAuthDiscoveryState["authorizationServerMetadata"],
    },
    clientInformation: input.session.clientInformation as OAuthClientInformationMixed | undefined,
  };

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return input.session.redirectUrl;
    },
    get clientMetadata() {
      return buildMcpOAuthClientMetadata(input.session.redirectUrl);
    },
    clientInformation: () => captured.clientInformation,
    saveClientInformation: (clientInformation) => {
      captured.clientInformation = clientInformation;
    },
    tokens: () => undefined,
    saveTokens: (tokens) => {
      captured.tokens = tokens;
    },
    redirectToAuthorization: () => {
      throw new Error("Unexpected redirect while completing MCP OAuth.");
    },
    saveCodeVerifier: () => undefined,
    codeVerifier: () => input.session.codeVerifier,
    saveDiscoveryState: (state) => {
      captured.discoveryState = state;
    },
    discoveryState: () => captured.discoveryState,
  };

  const result = await auth(provider, {
    serverUrl: input.session.endpoint,
    authorizationCode: input.code,
  }).catch((cause) => {
    throw toError(cause);
  });

  if (result !== "AUTHORIZED" || !captured.tokens) {
    throw new Error("MCP OAuth redirect did not complete authorization.");
  }

  return {
    accessToken: captured.tokens.access_token,
    refreshToken: captured.tokens.refresh_token ?? null,
    expiresAt: expiresAtFromTokens(captured.tokens),
    metadata: {
      tokenType: captured.tokens.token_type ?? "Bearer",
      scope: captured.tokens.scope ?? null,
      redirectUri: input.session.redirectUrl,
      resourceMetadataUrl: captured.discoveryState?.resourceMetadataUrl ?? null,
      authorizationServerUrl: captured.discoveryState?.authorizationServerUrl ?? null,
      resourceMetadata: toJsonObject(captured.discoveryState?.resourceMetadata),
      authorizationServerMetadata: toJsonObject(
        captured.discoveryState?.authorizationServerMetadata,
      ),
      clientInformation: toJsonObject(captured.clientInformation),
    },
  };
}

export async function ensureValidMcpOAuthCredential(input: {
  endpoint: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  metadata: McpOAuthMetadata;
}): Promise<{
  credential: McpOAuthCredential;
  refreshed: boolean;
  reauthRequired: boolean;
}> {
  let currentCredential: McpOAuthCredential = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    metadata: input.metadata,
  };
  let refreshed = false;
  let reauthRequired = false;

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return currentCredential.metadata.redirectUri;
    },
    get clientMetadata() {
      return buildMcpOAuthClientMetadata(currentCredential.metadata.redirectUri);
    },
    state: () => `cmdclaw-executor-source-${crypto.randomUUID()}`,
    clientInformation: () =>
      currentCredential.metadata.clientInformation as OAuthClientInformationMixed | undefined,
    saveClientInformation: (clientInformation) => {
      currentCredential = {
        ...currentCredential,
        metadata: {
          ...currentCredential.metadata,
          clientInformation: toJsonObject(clientInformation),
        },
      };
    },
    tokens: () => ({
      access_token: currentCredential.accessToken,
      token_type: currentCredential.metadata.tokenType,
      ...(currentCredential.refreshToken ? { refresh_token: currentCredential.refreshToken } : {}),
      ...(currentCredential.metadata.scope ? { scope: currentCredential.metadata.scope } : {}),
      ...(expiresInSeconds(currentCredential.expiresAt) !== undefined
        ? { expires_in: expiresInSeconds(currentCredential.expiresAt) }
        : {}),
    }),
    saveTokens: (tokens) => {
      refreshed = true;
      currentCredential = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? currentCredential.refreshToken,
        expiresAt: expiresAtFromTokens(tokens) ?? currentCredential.expiresAt,
        metadata: {
          ...currentCredential.metadata,
          tokenType: tokens.token_type ?? currentCredential.metadata.tokenType,
          scope: tokens.scope ?? currentCredential.metadata.scope,
        },
      };
    },
    redirectToAuthorization: () => {
      reauthRequired = true;
      throw new Error("MCP OAuth re-authorization is required.");
    },
    saveCodeVerifier: () => undefined,
    codeVerifier: () => {
      throw new Error("Persisted MCP OAuth credentials do not retain a PKCE verifier.");
    },
    saveDiscoveryState: (state) => {
      currentCredential = {
        ...currentCredential,
        metadata: {
          ...currentCredential.metadata,
          resourceMetadataUrl: state.resourceMetadataUrl ?? null,
          authorizationServerUrl: state.authorizationServerUrl ?? null,
          resourceMetadata: toJsonObject(state.resourceMetadata),
          authorizationServerMetadata: toJsonObject(state.authorizationServerMetadata),
        },
      };
    },
    discoveryState: () =>
      currentCredential.metadata.authorizationServerUrl === null
        ? undefined
        : {
            resourceMetadataUrl: currentCredential.metadata.resourceMetadataUrl ?? undefined,
            authorizationServerUrl: currentCredential.metadata.authorizationServerUrl,
            resourceMetadata:
              currentCredential.metadata.resourceMetadata as OAuthDiscoveryState["resourceMetadata"],
            authorizationServerMetadata:
              currentCredential.metadata
                .authorizationServerMetadata as OAuthDiscoveryState["authorizationServerMetadata"],
          },
  };

  try {
    const result = await auth(provider, {
      serverUrl: input.endpoint,
    });

    if (result !== "AUTHORIZED") {
      throw new Error("MCP OAuth flow did not reach an authorized state.");
    }
  } catch (cause) {
    if (!reauthRequired) {
      throw toError(cause);
    }
  }

  return {
    credential: currentCredential,
    refreshed,
    reauthRequired,
  };
}
