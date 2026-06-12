import { createHash } from "node:crypto";
import { env } from "../../env";
import { db } from "@cmdclaw/db/client";
import {
  workspaceMcpServer,
  workspaceMcpAuthorization,
} from "@cmdclaw/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getValidTokensForUser } from "../integrations/token-refresh";
import { canUserUseGalienInWorkspace, getGalienAccessStatus } from "../galien/service";
import { MANAGED_MCP_TOKEN_TTL_SECONDS, signManagedMcpToken } from "../managed-mcp-auth";
import {
  MODULR_INTERNAL_KEY,
  canUserUseModulrInWorkspace,
  getModulrWorkspaceConnectionStatus,
} from "../modulr/service";
import { decrypt, encrypt } from "../utils/encryption";
import { type McpOAuthMetadata, ensureValidMcpOAuthCredential } from "./mcp-oauth";
import type { RuntimeMcpServer } from "../sandbox/core/types";
import type { RemoteIntegrationSource } from "../integrations/remote-integrations";

type DatabaseLike = typeof db;

export type WorkspaceMcpServerKind = "mcp";
export type WorkspaceMcpServerAuthType = "none" | "api_key" | "bearer" | "oauth2";

type WorkspaceMcpServerRecord = typeof workspaceMcpServer.$inferSelect;
type WorkspaceMcpServerCredentialRecord =
  typeof workspaceMcpAuthorization.$inferSelect;

type ManagedWorkspaceMcpServerDefinition = {
  internalKey: "gmail" | "galien" | "modulr";
  kind: "mcp";
  name: string;
  namespace: string;
  endpoint: string;
  transport: string;
  authType: "none";
};

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const GMAIL_MANAGED_EXECUTOR_SOURCE_ENABLED = false;
const DEFINITIVE_OAUTH_REAUTH_PATTERNS = [
  /re-authorization is required/i,
  /reauthorization is required/i,
  /requires authentication/i,
  /authorization required/i,
  /invalid_grant/i,
  /invalid token/i,
  /expired/i,
  /revoked/i,
];

export function normalizeExecutorNamespace(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    throw new Error("Namespace must contain letters or numbers.");
  }

  return normalized;
}

export function computeWorkspaceMcpServerRevisionHash(input: {
  kind: WorkspaceMcpServerKind;
  internalKey?: string | null;
  name: string;
  namespace: string;
  endpoint: string;
  specUrl: string | null;
  transport: string | null;
  headers: Record<string, string> | null | undefined;
  queryParams: Record<string, string> | null | undefined;
  defaultHeaders: Record<string, string> | null | undefined;
  authType: WorkspaceMcpServerAuthType;
  authHeaderName: string | null;
  authQueryParam: string | null;
  authPrefix: string | null;
  enabled: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind,
        internalKey: input.internalKey?.trim() || null,
        name: input.name.trim(),
        namespace: normalizeExecutorNamespace(input.namespace),
        endpoint: input.endpoint.trim(),
        specUrl: input.specUrl?.trim() || null,
        transport: input.transport?.trim() || null,
        headers: input.headers ?? null,
        queryParams: input.queryParams ?? null,
        defaultHeaders: input.defaultHeaders ?? null,
        authType: input.authType,
        authHeaderName: input.authHeaderName?.trim() || null,
        authQueryParam: input.authQueryParam?.trim() || null,
        authPrefix: input.authPrefix ?? null,
        enabled: input.enabled,
      }),
    )
    .digest("hex");
}

function hasStoredCredentialSecret(
  source: WorkspaceMcpServerRecord,
  credential: WorkspaceMcpServerCredentialRecord | null | undefined,
): boolean {
  if (!credential) {
    return false;
  }

  if (source.authType === "oauth2") {
    return Boolean(credential.accessToken);
  }

  return Boolean(credential.secret);
}

function resolveManagedMcpBaseUrl(): string | null {
  const value = env.APP_MCP_BASE_URL?.trim() || env.APP_MCP_BASE_URL?.trim();
  return value && value.length > 0 ? value : null;
}

function getManagedSourceDefinition(
  internalKey: "gmail" | "galien" | "modulr",
): ManagedWorkspaceMcpServerDefinition | null {
  const baseUrl = resolveManagedMcpBaseUrl();
  if (!baseUrl) {
    return null;
  }

  if (internalKey === "galien") {
    return {
      internalKey: "galien" as const,
      kind: "mcp" as const,
      name: "Galien MCP",
      namespace: "galien",
      endpoint: new URL("/galien", baseUrl).toString(),
      transport: "http",
      authType: "none" as const,
    };
  }

  if (internalKey === MODULR_INTERNAL_KEY) {
    return {
      internalKey: MODULR_INTERNAL_KEY,
      kind: "mcp" as const,
      name: "Modulr MCP",
      namespace: "modulr",
      endpoint: new URL("/modulr", baseUrl).toString(),
      transport: "http",
      authType: "none" as const,
    };
  }

  return {
    internalKey: "gmail" as const,
    kind: "mcp" as const,
    name: "Gmail MCP",
    namespace: "gmail",
    endpoint: new URL("/gmail", baseUrl).toString(),
    transport: "http",
    authType: "none" as const,
  };
}

async function ensureManagedWorkspaceMcpServers(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId: string;
}) {
  const database = input.database ?? db;
  const definitions: Array<ManagedWorkspaceMcpServerDefinition | null> =
    GMAIL_MANAGED_EXECUTOR_SOURCE_ENABLED ? [getManagedSourceDefinition("gmail")] : [];
  const modulrDefinition = getManagedSourceDefinition(MODULR_INTERNAL_KEY);
  if (
    modulrDefinition &&
    (await canUserUseModulrInWorkspace({
      database,
      userId: input.userId,
      workspaceId: input.workspaceId,
    }))
  ) {
    definitions.push(modulrDefinition);
  }
  const galienDefinition = getManagedSourceDefinition("galien");
  if (
    galienDefinition &&
    (await canUserUseGalienInWorkspace({
      database,
      userId: input.userId,
      workspaceId: input.workspaceId,
    }))
  ) {
    definitions.push(galienDefinition);
  }

  const activeDefinitions = definitions.filter(
    (definition): definition is NonNullable<typeof definition> => Boolean(definition),
  );
  if (activeDefinitions.length === 0) {
    return;
  }

  const existing = await database.query.workspaceMcpServer.findMany({
    where: eq(workspaceMcpServer.workspaceId, input.workspaceId),
  });

  for (const definition of activeDefinitions) {
    const current = existing.find(
      (source) =>
        source.internalKey === definition.internalKey || source.namespace === definition.namespace,
    );

    const enabled =
      current && current.internalKey === definition.internalKey ? current.enabled : true;

    const revisionHash = computeWorkspaceMcpServerRevisionHash({
      kind: definition.kind,
      internalKey: definition.internalKey,
      name: definition.name,
      namespace: definition.namespace,
      endpoint: definition.endpoint,
      specUrl: null,
      transport: definition.transport,
      headers: null,
      queryParams: null,
      defaultHeaders: null,
      authType: definition.authType,
      authHeaderName: null,
      authQueryParam: null,
      authPrefix: null,
      enabled,
    });

    if (!current) {
      await database.insert(workspaceMcpServer).values({
        workspaceId: input.workspaceId,
        kind: definition.kind,
        internalKey: definition.internalKey,
        name: definition.name,
        namespace: definition.namespace,
        endpoint: definition.endpoint,
        specUrl: null,
        transport: definition.transport,
        headers: null,
        queryParams: null,
        defaultHeaders: null,
        authType: definition.authType,
        authHeaderName: null,
        authQueryParam: null,
        authPrefix: null,
        enabled: true,
        revisionHash,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      });
      continue;
    }

    if (
      current.internalKey !== definition.internalKey ||
      current.name !== definition.name ||
      current.namespace !== definition.namespace ||
      current.endpoint !== definition.endpoint ||
      current.transport !== definition.transport ||
      current.authType !== definition.authType ||
      current.revisionHash !== revisionHash
    ) {
      await database
        .update(workspaceMcpServer)
        .set({
          internalKey: definition.internalKey,
          kind: definition.kind,
          name: definition.name,
          namespace: definition.namespace,
          endpoint: definition.endpoint,
          specUrl: null,
          transport: definition.transport,
          headers: null,
          queryParams: null,
          defaultHeaders: null,
          authType: definition.authType,
          authHeaderName: null,
          authQueryParam: null,
          authPrefix: null,
          enabled,
          revisionHash,
          updatedByUserId: input.userId,
        })
        .where(eq(workspaceMcpServer.id, current.id));
    }
  }
}

async function isManagedSourceConnected(input: {
  database?: DatabaseLike;
  source: WorkspaceMcpServerRecord;
  userId?: string;
}) {
  const { source, userId } = input;
  if (source.internalKey === "galien") {
    if (!userId) {
      return false;
    }
    const status = await getGalienAccessStatus({
      database: input.database,
      userId,
      workspaceId: source.workspaceId,
    });
    return status.allowed && status.connected;
  }

  if (source.internalKey === MODULR_INTERNAL_KEY) {
    if (!userId) {
      return false;
    }
    const status = await getModulrWorkspaceConnectionStatus({
      database: input.database,
      userId,
      workspaceId: source.workspaceId,
    });
    return status.allowed && status.connected;
  }

  if (!userId) {
    return false;
  }

  if (source.internalKey !== "gmail") {
    return false;
  }

  const tokens = await getValidTokensForUser(userId, ["google_gmail"]);
  return Boolean(tokens.get("google_gmail"));
}

async function isManagedSourceVisibleForUser(input: {
  database?: DatabaseLike;
  source: WorkspaceMcpServerRecord;
  userId?: string;
}) {
  if (!input.source.internalKey) {
    return true;
  }

  if (input.source.internalKey === "galien") {
    return Boolean(
      input.userId &&
      (await canUserUseGalienInWorkspace({
        database: input.database,
        userId: input.userId,
        workspaceId: input.source.workspaceId,
      })),
    );
  }

  if (input.source.internalKey === "gmail") {
    return GMAIL_MANAGED_EXECUTOR_SOURCE_ENABLED;
  }

  if (input.source.internalKey === MODULR_INTERNAL_KEY) {
    return Boolean(
      input.userId &&
      (await canUserUseModulrInWorkspace({
        database: input.database,
        userId: input.userId,
        workspaceId: input.source.workspaceId,
      })),
    );
  }

  return true;
}

function shouldRefreshOauthCredential(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.now() >= expiresAt.getTime() - EXPIRY_BUFFER_MS;
}

function shouldTreatAsReauthRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DEFINITIVE_OAUTH_REAUTH_PATTERNS.some((pattern) => pattern.test(message));
}

function decryptWorkspaceMcpServerToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const decrypted = decrypt(value);
  return decrypted.trim().length > 0 ? decrypted : null;
}

export type StoredWorkspaceMcpServerOauthCredential = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  metadata: McpOAuthMetadata;
};

function readStoredWorkspaceMcpServerOauthCredential(
  source: WorkspaceMcpServerRecord,
  credential: WorkspaceMcpServerCredentialRecord | null | undefined,
): StoredWorkspaceMcpServerOauthCredential | null {
  if (source.authType !== "oauth2" || !credential?.oauthMetadata) {
    return null;
  }

  const accessToken = decryptWorkspaceMcpServerToken(credential.accessToken);
  if (!accessToken) {
    return null;
  }

  const metadata = credential.oauthMetadata as McpOAuthMetadata;
  if (!metadata.redirectUri || !metadata.tokenType) {
    return null;
  }

  return {
    accessToken,
    refreshToken: decryptWorkspaceMcpServerToken(credential.refreshToken),
    expiresAt: credential.expiresAt ?? null,
    metadata,
  };
}

async function upsertWorkspaceMcpServerOAuthCredential(input: {
  database?: DatabaseLike;
  workspaceMcpServerId: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  oauthMetadata: McpOAuthMetadata;
  displayName?: string | null;
  enabled?: boolean;
}) {
  const database = input.database ?? db;

  await database
    .insert(workspaceMcpAuthorization)
    .values({
      workspaceMcpServerId: input.workspaceMcpServerId,
      userId: input.userId,
      secret: null,
      accessToken: encrypt(input.accessToken),
      refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
      expiresAt: input.expiresAt,
      oauthMetadata: input.oauthMetadata,
      displayName: input.displayName?.trim() || null,
      enabled: input.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: [
        workspaceMcpAuthorization.userId,
        workspaceMcpAuthorization.workspaceMcpServerId,
      ],
      set: {
        secret: null,
        accessToken: encrypt(input.accessToken),
        refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
        expiresAt: input.expiresAt,
        oauthMetadata: input.oauthMetadata,
        displayName: input.displayName?.trim() || null,
        enabled: input.enabled ?? true,
        updatedAt: new Date(),
      },
    });
}

async function markWorkspaceMcpServerOAuthCredentialDisconnected(input: {
  database?: DatabaseLike;
  credentialId: string;
}) {
  const database = input.database ?? db;

  await database
    .update(workspaceMcpAuthorization)
    .set({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      oauthMetadata: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaceMcpAuthorization.id, input.credentialId));
}

async function getHydratedWorkspaceMcpServerOauthCredential(input: {
  database?: DatabaseLike;
  source: WorkspaceMcpServerRecord;
  credential: WorkspaceMcpServerCredentialRecord | null | undefined;
}): Promise<StoredWorkspaceMcpServerOauthCredential | null> {
  const database = input.database ?? db;
  const stored = readStoredWorkspaceMcpServerOauthCredential(input.source, input.credential);
  if (!stored) {
    return null;
  }

  if (!shouldRefreshOauthCredential(stored.expiresAt)) {
    return stored;
  }

  try {
    const result = await ensureValidMcpOAuthCredential({
      endpoint: input.source.endpoint,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      metadata: stored.metadata,
    });

    if (result.reauthRequired) {
      if (input.credential?.id) {
        await markWorkspaceMcpServerOAuthCredentialDisconnected({
          database,
          credentialId: input.credential.id,
        });
      }
      return null;
    }

    if (result.refreshed && input.credential) {
      await upsertWorkspaceMcpServerOAuthCredential({
        database,
        workspaceMcpServerId: input.source.id,
        userId: input.credential.userId,
        accessToken: result.credential.accessToken,
        refreshToken: result.credential.refreshToken,
        expiresAt: result.credential.expiresAt,
        oauthMetadata: result.credential.metadata,
        displayName: input.credential.displayName,
        enabled: input.credential.enabled,
      });
    }

    return result.credential;
  } catch (error) {
    if (stored.expiresAt && stored.expiresAt.getTime() > Date.now()) {
      return stored;
    }

    if (input.credential?.id && shouldTreatAsReauthRequired(error)) {
      await markWorkspaceMcpServerOAuthCredentialDisconnected({
        database,
        credentialId: input.credential.id,
      });
      return null;
    }

    return stored;
  }
}

function appendQueryParams(endpoint: string, queryParams: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function toRuntimeMcpTransport(transport: string | null): "http" | "sse" {
  return transport === "sse" ? "sse" : "http";
}

async function buildWorkspaceMcpRuntimeServer(input: {
  database?: DatabaseLike;
  source: WorkspaceMcpServerRecord;
  credential: WorkspaceMcpServerCredentialRecord | null | undefined;
  userId: string;
  remoteIntegrationSource?: RemoteIntegrationSource | null;
}): Promise<RuntimeMcpServer> {
  const headers: Record<string, string> = { ...(input.source.headers ?? {}) };
  const queryParams: Record<string, string> = { ...(input.source.queryParams ?? {}) };

  if (
    input.source.internalKey === "gmail" ||
    input.source.internalKey === "galien" ||
    input.source.internalKey === MODULR_INTERNAL_KEY
  ) {
    if (!env.APP_SERVER_SECRET) {
      throw new Error("APP_SERVER_SECRET is required for managed MCP servers.");
    }
    headers.Authorization = `Bearer ${signManagedMcpToken(
      {
        userId: input.userId,
        workspaceId: input.source.workspaceId,
        internalKey: input.source.internalKey,
        exp: Math.floor(Date.now() / 1000) + MANAGED_MCP_TOKEN_TTL_SECONDS,
        remoteIntegrationSource: input.remoteIntegrationSource ?? undefined,
      },
      env.APP_SERVER_SECRET,
    )}`;
  } else if (input.source.authType === "oauth2") {
    const hydrated = await getHydratedWorkspaceMcpServerOauthCredential({
      database: input.database,
      source: input.source,
      credential: input.credential,
    });
    if (hydrated?.accessToken) {
      const tokenType = hydrated.metadata.tokenType?.trim();
      const prefix =
        tokenType && tokenType.length > 0
          ? tokenType.toLowerCase() === "bearer"
            ? "Bearer"
            : tokenType
          : "Bearer";
      headers.Authorization = `${prefix} ${hydrated.accessToken}`;
    }
  } else if (input.source.authType !== "none" && input.credential?.enabled) {
    const secret = input.credential.secret ? decrypt(input.credential.secret) : null;
    if (secret?.trim()) {
      if (input.source.authType === "bearer") {
        headers[input.source.authHeaderName?.trim() || "Authorization"] =
          `${input.source.authPrefix ?? "Bearer "}${secret}`;
      } else if (input.source.authQueryParam?.trim()) {
        queryParams[input.source.authQueryParam.trim()] = secret;
      } else {
        headers[input.source.authHeaderName?.trim() || "X-API-Key"] = secret;
      }
    }
  }

  return {
    type: toRuntimeMcpTransport(input.source.transport ?? null),
    name: input.source.namespace,
    url: appendQueryParams(input.source.endpoint, queryParams),
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
  };
}

export async function listWorkspaceMcpServers(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId?: string;
}) {
  const database = input.database ?? db;
  if (input.userId) {
    await ensureManagedWorkspaceMcpServers({
      database,
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
  }
  const [sources, credentials] = await Promise.all([
    database.query.workspaceMcpServer.findMany({
      where: eq(workspaceMcpServer.workspaceId, input.workspaceId),
      orderBy: (source, { asc }) => [asc(source.name), asc(source.createdAt)],
    }),
    input.userId
      ? database.query.workspaceMcpAuthorization.findMany({
          where: eq(workspaceMcpAuthorization.userId, input.userId),
        })
      : Promise.resolve([] as WorkspaceMcpServerCredentialRecord[]),
  ]);

  const credentialBySourceId = new Map(
    credentials.map((credential) => [credential.workspaceMcpServerId, credential]),
  );

  const visibleSources = (
    await Promise.all(
      sources.map(async (source) =>
        (await isManagedSourceVisibleForUser({
          database,
          source,
          userId: input.userId,
        }))
          ? source
          : null,
      ),
    )
  ).filter((source): source is WorkspaceMcpServerRecord => Boolean(source));

  return Promise.all(
    visibleSources.map(async (source) => {
      const credential = credentialBySourceId.get(source.id);
      const connected = source.internalKey
        ? await isManagedSourceConnected({ database, source, userId: input.userId })
        : hasStoredCredentialSecret(source, credential);
      return {
        ...source,
        connected,
        credentialEnabled: source.internalKey ? connected : (credential?.enabled ?? false),
        credentialDisplayName: credential?.displayName ?? null,
        credentialUpdatedAt: credential?.updatedAt ?? null,
      };
    }),
  );
}

export type WorkspaceMcpServerResolution = {
  requestedServers: Array<{
    id: string;
    name: string;
    namespace: string;
    server: RuntimeMcpServer;
  }>;
  unavailableServers: Array<{
    id: string;
    name: string;
    namespace: string;
    reason: string;
  }>;
};

export async function resolveWorkspaceMcpServersForGeneration(input: {
  database?: DatabaseLike;
  workspaceId: string | null | undefined;
  userId: string;
  allowedWorkspaceMcpServerIds?: string[] | null;
  remoteIntegrationSource?: RemoteIntegrationSource | null;
}): Promise<WorkspaceMcpServerResolution> {
  if (!input.workspaceId) {
    return { requestedServers: [], unavailableServers: [] };
  }
  if (
    Array.isArray(input.allowedWorkspaceMcpServerIds) &&
    input.allowedWorkspaceMcpServerIds.length === 0
  ) {
    return { requestedServers: [], unavailableServers: [] };
  }

  const database = input.database ?? db;
  await ensureManagedWorkspaceMcpServers({
    database,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  const [sources, credentials] = await Promise.all([
    database.query.workspaceMcpServer.findMany({
      where:
        input.allowedWorkspaceMcpServerIds && input.allowedWorkspaceMcpServerIds.length > 0
          ? and(
              eq(workspaceMcpServer.workspaceId, input.workspaceId),
              inArray(workspaceMcpServer.id, input.allowedWorkspaceMcpServerIds),
            )
          : eq(workspaceMcpServer.workspaceId, input.workspaceId),
      orderBy: (source, { asc }) => [asc(source.namespace), asc(source.createdAt)],
    }),
    database.query.workspaceMcpAuthorization.findMany({
      where: eq(workspaceMcpAuthorization.userId, input.userId),
    }),
  ]);

  const credentialBySourceId = new Map(
    credentials.map((credential) => [credential.workspaceMcpServerId, credential]),
  );
  const visibleSources = (
    await Promise.all(
      sources.map(async (source) =>
        (await isManagedSourceVisibleForUser({
          database,
          source,
          userId: input.userId,
        }))
          ? source
          : null,
      ),
    )
  ).filter((source): source is WorkspaceMcpServerRecord => Boolean(source));

  const requestedServers: WorkspaceMcpServerResolution["requestedServers"] = [];
  const unavailableServers: WorkspaceMcpServerResolution["unavailableServers"] = [];
  const visibleSourceIds = new Set(visibleSources.map((source) => source.id));

  if (input.allowedWorkspaceMcpServerIds && input.allowedWorkspaceMcpServerIds.length > 0) {
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    for (const requestedId of input.allowedWorkspaceMcpServerIds) {
      if (visibleSourceIds.has(requestedId)) {
        continue;
      }
      const source = sourceById.get(requestedId);
      unavailableServers.push({
        id: requestedId,
        name: source?.name ?? requestedId,
        namespace: source?.namespace ?? requestedId,
        reason: source
          ? "Workspace MCP Server is not visible to this user."
          : "Workspace MCP Server was not found in this workspace.",
      });
    }
  }

  for (const source of visibleSources) {
    if (!source.enabled) {
      unavailableServers.push({
        id: source.id,
        name: source.name,
        namespace: source.namespace,
        reason: "Workspace MCP Server is disabled.",
      });
      continue;
    }
    try {
      requestedServers.push({
        id: source.id,
        name: source.name,
        namespace: source.namespace,
        server: await buildWorkspaceMcpRuntimeServer({
          database,
          source,
          credential: credentialBySourceId.get(source.id),
          userId: input.userId,
          remoteIntegrationSource: input.remoteIntegrationSource,
        }),
      });
    } catch (error) {
      unavailableServers.push({
        id: source.id,
        name: source.name,
        namespace: source.namespace,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { requestedServers, unavailableServers };
}

export async function setWorkspaceMcpServerCredential(input: {
  database?: DatabaseLike;
  workspaceMcpServerId: string;
  userId: string;
  secret: string;
  displayName?: string | null;
  enabled?: boolean;
}) {
  const database = input.database ?? db;
  const normalizedSecret = input.secret.trim();
  if (!normalizedSecret) {
    throw new Error("Secret is required.");
  }

  await database
    .insert(workspaceMcpAuthorization)
    .values({
      workspaceMcpServerId: input.workspaceMcpServerId,
      userId: input.userId,
      secret: encrypt(normalizedSecret),
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      oauthMetadata: null,
      displayName: input.displayName?.trim() || null,
      enabled: input.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: [
        workspaceMcpAuthorization.userId,
        workspaceMcpAuthorization.workspaceMcpServerId,
      ],
      set: {
        secret: encrypt(normalizedSecret),
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        oauthMetadata: null,
        displayName: input.displayName?.trim() || null,
        enabled: input.enabled ?? true,
        updatedAt: new Date(),
      },
    });
}

export async function setWorkspaceMcpServerOAuthCredential(input: {
  database?: DatabaseLike;
  workspaceMcpServerId: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  oauthMetadata: McpOAuthMetadata;
  displayName?: string | null;
  enabled?: boolean;
}) {
  await upsertWorkspaceMcpServerOAuthCredential(input);
}
