import { createHash } from "node:crypto";
import { env } from "../../env";
import { db } from "@cmdclaw/db/client";
import {
  workspaceExecutorPackage,
  workspaceExecutorSource,
  workspaceExecutorSourceCredential,
} from "@cmdclaw/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getValidTokensForUser } from "../integrations/token-refresh";
import {
  canUserUseGalienInWorkspace,
  getGalienCredentialStatus,
} from "../galien/service";
import { signManagedMcpToken } from "../managed-mcp-auth";
import { decrypt, encrypt } from "../utils/encryption";
import {
  type McpOAuthMetadata,
  ensureValidMcpOAuthCredential,
} from "./mcp-oauth";

type DatabaseLike = typeof db;

export type ExecutorSourceKind = "mcp" | "openapi";
export type ExecutorSourceAuthType = "none" | "api_key" | "bearer" | "oauth2";

type WorkspaceExecutorSourceRecord = typeof workspaceExecutorSource.$inferSelect;
type WorkspaceExecutorSourceCredentialRecord =
  typeof workspaceExecutorSourceCredential.$inferSelect;
type WorkspaceExecutorPackageRecord = typeof workspaceExecutorPackage.$inferSelect;

type LocalExecutorConfigSource = Record<string, unknown> & {
  kind: ExecutorSourceKind;
  name?: string;
  namespace?: string;
  enabled?: boolean;
  config: Record<string, unknown>;
};

type LocalExecutorConfig = {
  workspace?: {
    name?: string;
  };
  sources: Record<string, LocalExecutorConfigSource>;
};

type LocalWorkspaceState = {
  version: 1;
  sources: Record<
    string,
    {
      status: "draft" | "probing" | "auth_required" | "connected" | "error";
      lastError: string | null;
      sourceHash: string | null;
      createdAt: number;
      updatedAt: number;
    }
  >;
  policies: Record<string, never>;
};

type ManagedExecutorSourceDefinition = {
  internalKey: "gmail" | "galien";
  kind: "mcp";
  name: string;
  namespace: string;
  endpoint: string;
  transport: string;
  authType: "none";
};

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const MANAGED_MCP_TOKEN_TTL_SECONDS = 10 * 60;
const WORKSPACE_EXECUTOR_PACKAGE_FORMAT_VERSION = 3;
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

export function computeWorkspaceExecutorSourceRevisionHash(input: {
  kind: ExecutorSourceKind;
  internalKey?: string | null;
  name: string;
  namespace: string;
  endpoint: string;
  specUrl: string | null;
  transport: string | null;
  headers: Record<string, string> | null | undefined;
  queryParams: Record<string, string> | null | undefined;
  defaultHeaders: Record<string, string> | null | undefined;
  authType: ExecutorSourceAuthType;
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

function buildBaseSourceConfig(source: WorkspaceExecutorSourceRecord): LocalExecutorConfigSource {
  if (source.kind === "openapi") {
    return {
      kind: "openapi",
      name: source.name,
      namespace: source.namespace,
      enabled: source.enabled,
      config: {
        specUrl: source.specUrl,
        baseUrl: source.endpoint,
        auth: { kind: "none" },
        defaultHeaders: source.defaultHeaders ?? null,
      },
    };
  }

  return {
    kind: "mcp",
    name: source.name,
    namespace: source.namespace,
    enabled: source.enabled,
    config: {
      endpoint: source.endpoint,
      transport: source.transport ?? null,
      queryParams: source.queryParams ?? null,
      headers: source.headers ?? null,
      command: null,
      args: null,
      env: null,
      cwd: null,
      auth: { kind: "none" },
    },
  };
}

function buildWorkspaceState(
  sources: WorkspaceExecutorSourceRecord[],
  now = Date.now(),
): LocalWorkspaceState {
  return {
    version: 1,
    sources: Object.fromEntries(
      sources.map((source) => [
        source.id,
        {
          status: "connected",
          lastError: null,
          sourceHash: source.revisionHash,
          createdAt: source.createdAt?.getTime() ?? now,
          updatedAt: source.updatedAt?.getTime() ?? now,
        },
      ]),
    ),
    policies: {},
  };
}

function hasStoredCredentialSecret(
  source: WorkspaceExecutorSourceRecord,
  credential: WorkspaceExecutorSourceCredentialRecord | null | undefined,
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
  const value = env.CMDCLAW_MCP_BASE_URL?.trim();
  return value && value.length > 0 ? value : null;
}

function getManagedSourceDefinition(
  internalKey: "gmail" | "galien",
): ManagedExecutorSourceDefinition | null {
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
      endpoint: new URL("/galien/mcp", baseUrl).toString(),
      transport: "http",
      authType: "none" as const,
    };
  }

  return {
    internalKey: "gmail" as const,
    kind: "mcp" as const,
    name: "Gmail MCP",
    namespace: "gmail",
    endpoint: new URL("/gmail/mcp", baseUrl).toString(),
    transport: "http",
    authType: "none" as const,
  };
}

async function ensureManagedExecutorSources(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId: string;
}) {
  const database = input.database ?? db;
  const definitions: Array<ManagedExecutorSourceDefinition | null> =
    GMAIL_MANAGED_EXECUTOR_SOURCE_ENABLED ? [getManagedSourceDefinition("gmail")] : [];
  const galienDefinition = getManagedSourceDefinition("galien");
  if (
    galienDefinition &&
    await canUserUseGalienInWorkspace({
      database,
      userId: input.userId,
      workspaceId: input.workspaceId,
    })
  ) {
    definitions.push(galienDefinition);
  }

  const activeDefinitions = definitions.filter(
    (definition): definition is NonNullable<typeof definition> => Boolean(definition),
  );
  if (activeDefinitions.length === 0) {
    return;
  }

  const existing = await database.query.workspaceExecutorSource.findMany({
    where: eq(workspaceExecutorSource.workspaceId, input.workspaceId),
  });

  for (const definition of activeDefinitions) {
    const current = existing.find(
      (source) =>
        source.internalKey === definition.internalKey || source.namespace === definition.namespace,
    );

    const enabled =
      current && current.internalKey === definition.internalKey ? current.enabled : true;

    const revisionHash = computeWorkspaceExecutorSourceRevisionHash({
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
      await database.insert(workspaceExecutorSource).values({
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
        .update(workspaceExecutorSource)
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
        .where(eq(workspaceExecutorSource.id, current.id));
    }
  }
}

async function isManagedSourceConnected(source: WorkspaceExecutorSourceRecord, userId?: string) {
  if (!userId) {
    return false;
  }

  if (source.internalKey === "galien") {
    const status = await getGalienCredentialStatus({ userId });
    return status.connected;
  }

  if (source.internalKey !== "gmail") {
    return false;
  }

  const tokens = await getValidTokensForUser(userId, ["google_gmail"]);
  return Boolean(tokens.get("google_gmail"));
}

async function isManagedSourceVisibleForUser(input: {
  database?: DatabaseLike;
  source: WorkspaceExecutorSourceRecord;
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

function decryptExecutorSourceToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const decrypted = decrypt(value);
  return decrypted.trim().length > 0 ? decrypted : null;
}

export type StoredExecutorSourceOauthCredential = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  metadata: McpOAuthMetadata;
};

export type WorkspaceExecutorNativeMcpOauthBootstrapSource = {
  sourceId: string;
  name: string;
  namespace: string;
  endpoint: string;
  transport: string | null;
  queryParams: Record<string, string> | null;
  credential: StoredExecutorSourceOauthCredential | null;
};

function computeWorkspaceExecutorPackageRevision(
  sources: Array<{
    id: string;
    revisionHash: string;
    enabled: boolean;
    updatedAt: Date | null | undefined;
  }>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        formatVersion: WORKSPACE_EXECUTOR_PACKAGE_FORMAT_VERSION,
        sources: sources.map((source) => ({
          id: source.id,
          revisionHash: source.revisionHash,
          enabled: source.enabled,
          updatedAt: source.updatedAt?.toISOString() ?? null,
        })),
      }),
    )
    .digest("hex");
}

function readStoredExecutorSourceOauthCredential(
  source: WorkspaceExecutorSourceRecord,
  credential: WorkspaceExecutorSourceCredentialRecord | null | undefined,
): StoredExecutorSourceOauthCredential | null {
  if (source.authType !== "oauth2" || !credential?.oauthMetadata) {
    return null;
  }

  const accessToken = decryptExecutorSourceToken(credential.accessToken);
  if (!accessToken) {
    return null;
  }

  const metadata = credential.oauthMetadata as McpOAuthMetadata;
  if (!metadata.redirectUri || !metadata.tokenType) {
    return null;
  }

  return {
    accessToken,
    refreshToken: decryptExecutorSourceToken(credential.refreshToken),
    expiresAt: credential.expiresAt ?? null,
    metadata,
  };
}

async function upsertWorkspaceExecutorSourceOAuthCredential(input: {
  database?: DatabaseLike;
  workspaceExecutorSourceId: string;
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
    .insert(workspaceExecutorSourceCredential)
    .values({
      workspaceExecutorSourceId: input.workspaceExecutorSourceId,
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
        workspaceExecutorSourceCredential.userId,
        workspaceExecutorSourceCredential.workspaceExecutorSourceId,
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

async function markWorkspaceExecutorSourceOAuthCredentialDisconnected(input: {
  database?: DatabaseLike;
  credentialId: string;
}) {
  const database = input.database ?? db;

  await database
    .update(workspaceExecutorSourceCredential)
    .set({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      oauthMetadata: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaceExecutorSourceCredential.id, input.credentialId));
}

async function getHydratedExecutorSourceOauthCredential(input: {
  database?: DatabaseLike;
  source: WorkspaceExecutorSourceRecord;
  credential: WorkspaceExecutorSourceCredentialRecord | null | undefined;
}): Promise<StoredExecutorSourceOauthCredential | null> {
  const database = input.database ?? db;
  const stored = readStoredExecutorSourceOauthCredential(input.source, input.credential);
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
        await markWorkspaceExecutorSourceOAuthCredentialDisconnected({
          database,
          credentialId: input.credential.id,
        });
      }
      return null;
    }

    if (result.refreshed && input.credential) {
      await upsertWorkspaceExecutorSourceOAuthCredential({
        database,
        workspaceExecutorSourceId: input.source.id,
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
      await markWorkspaceExecutorSourceOAuthCredentialDisconnected({
        database,
        credentialId: input.credential.id,
      });
      return null;
    }

    return stored;
  }
}

function mergeAuthIntoSourceConfig(input: {
  database?: DatabaseLike;
  source: WorkspaceExecutorSourceRecord;
  credential: WorkspaceExecutorSourceCredentialRecord | null | undefined;
  userId: string;
  config: LocalExecutorConfigSource;
}): Promise<LocalExecutorConfigSource> {
  const next = JSON.parse(JSON.stringify(input.config)) as LocalExecutorConfigSource;
  if (input.source.internalKey === "gmail" || input.source.internalKey === "galien") {
    if (!env.CMDCLAW_SERVER_SECRET) {
      throw new Error("CMDCLAW_SERVER_SECRET is required for managed MCP sources.");
    }

    const config = (next.config ?? {}) as Record<string, unknown>;
    const headers = {
      ...((config.headers as Record<string, string> | null | undefined) ?? {}),
    };
    headers.Authorization = `Bearer ${signManagedMcpToken(
      {
        userId: input.userId,
        workspaceId: input.source.workspaceId,
        internalKey: input.source.internalKey,
        exp: Math.floor(Date.now() / 1000) + MANAGED_MCP_TOKEN_TTL_SECONDS,
      },
      env.CMDCLAW_SERVER_SECRET,
    )}`;
    config.headers = headers;
    next.config = config;
    return Promise.resolve(next);
  }

  if (input.source.authType === "none" || !input.credential?.enabled) {
    return Promise.resolve(next);
  }

  if (input.source.authType === "oauth2") {
    return Promise.resolve(next);
  }

  const secret = input.credential?.secret ? decrypt(input.credential.secret) : null;

  if (!secret || secret.trim().length === 0) {
    return Promise.resolve(next);
  }

  if (input.source.kind === "openapi") {
    const config = (next.config ?? {}) as Record<string, unknown>;
    const defaultHeaders = {
      ...((config.defaultHeaders as Record<string, string> | null | undefined) ?? {}),
    };

    if (input.source.authType === "bearer") {
      defaultHeaders[input.source.authHeaderName?.trim() || "Authorization"] =
        `${input.source.authPrefix ?? "Bearer "}${secret}`;
    } else {
      defaultHeaders[input.source.authHeaderName?.trim() || "X-API-Key"] = secret;
    }

    config.defaultHeaders = defaultHeaders;
    next.config = config;
    return Promise.resolve(next);
  }

  const config = (next.config ?? {}) as Record<string, unknown>;
  const headers = {
    ...((config.headers as Record<string, string> | null | undefined) ?? {}),
  };
  const queryParams = {
    ...((config.queryParams as Record<string, string> | null | undefined) ?? {}),
  };

  if (input.source.authType === "bearer") {
    headers[input.source.authHeaderName?.trim() || "Authorization"] =
      `${input.source.authPrefix ?? "Bearer "}${secret}`;
  } else if (input.source.authQueryParam?.trim()) {
    queryParams[input.source.authQueryParam.trim()] = secret;
  } else {
    headers[input.source.authHeaderName?.trim() || "X-API-Key"] = secret;
  }

  config.headers = headers;
  config.queryParams = queryParams;
  next.config = config;
  return Promise.resolve(next);
}

export async function listWorkspaceExecutorSources(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId?: string;
}) {
  const database = input.database ?? db;
  if (input.userId) {
    await ensureManagedExecutorSources({
      database,
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
  }
  const [sources, credentials] = await Promise.all([
    database.query.workspaceExecutorSource.findMany({
      where: eq(workspaceExecutorSource.workspaceId, input.workspaceId),
      orderBy: (source, { asc }) => [asc(source.name), asc(source.createdAt)],
    }),
    input.userId
      ? database.query.workspaceExecutorSourceCredential.findMany({
          where: eq(workspaceExecutorSourceCredential.userId, input.userId),
        })
      : Promise.resolve([] as WorkspaceExecutorSourceCredentialRecord[]),
  ]);

  const credentialBySourceId = new Map(
    credentials.map((credential) => [credential.workspaceExecutorSourceId, credential]),
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
  ).filter((source): source is WorkspaceExecutorSourceRecord => Boolean(source));

  return Promise.all(visibleSources.map(async (source) => {
    const credential = credentialBySourceId.get(source.id);
    const connected = source.internalKey
      ? await isManagedSourceConnected(source, input.userId)
      : hasStoredCredentialSecret(source, credential);
    return {
      ...source,
      connected,
      credentialEnabled: credential?.enabled ?? false,
      credentialDisplayName: credential?.displayName ?? null,
      credentialUpdatedAt: credential?.updatedAt ?? null,
    };
  }));
}

export async function getWorkspaceExecutorNativeMcpOAuthBootstrapSources(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId: string;
  allowedSourceIds?: string[] | null;
}): Promise<WorkspaceExecutorNativeMcpOauthBootstrapSource[]> {
  const database = input.database ?? db;
  const [sources, credentials] = await Promise.all([
    database.query.workspaceExecutorSource.findMany({
      where:
        input.allowedSourceIds && input.allowedSourceIds.length > 0
          ? and(
              eq(workspaceExecutorSource.workspaceId, input.workspaceId),
              inArray(workspaceExecutorSource.id, input.allowedSourceIds),
            )
          : eq(workspaceExecutorSource.workspaceId, input.workspaceId),
      orderBy: (source, { asc }) => [asc(source.namespace), asc(source.createdAt)],
    }),
    database.query.workspaceExecutorSourceCredential.findMany({
      where: eq(workspaceExecutorSourceCredential.userId, input.userId),
    }),
  ]);

  const credentialBySourceId = new Map(
    credentials.map((credential) => [credential.workspaceExecutorSourceId, credential]),
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
  ).filter((source): source is WorkspaceExecutorSourceRecord => Boolean(source));

  const oauthSources = visibleSources
    .filter(
      (source) =>
        source.kind === "mcp" &&
        source.authType === "oauth2",
    )
    .map(async (source) => {
      const credential = credentialBySourceId.get(source.id);
      return {
        sourceId: source.id,
        name: source.name,
        namespace: source.namespace,
        endpoint: source.endpoint,
        transport: source.transport ?? null,
        queryParams: source.queryParams ?? null,
        credential:
          credential?.enabled === false
            ? null
            : await getHydratedExecutorSourceOauthCredential({
                database,
                source,
                credential,
              }),
      };
    });

  return Promise.all(oauthSources);
}

async function rebuildWorkspaceExecutorPackage(input: {
  database?: DatabaseLike;
  workspaceId: string;
  workspaceName?: string | null;
}) {
  const database = input.database ?? db;
  const sources = await database.query.workspaceExecutorSource.findMany({
    where: eq(workspaceExecutorSource.workspaceId, input.workspaceId),
    orderBy: (source, { asc }) => [asc(source.namespace), asc(source.createdAt)],
  });

  const revisionHash = computeWorkspaceExecutorPackageRevision(sources);

  const config: LocalExecutorConfig = {
    workspace: input.workspaceName?.trim() ? { name: input.workspaceName.trim() } : undefined,
    sources: Object.fromEntries(
      sources.map((source) => [source.id, buildBaseSourceConfig(source)]),
    ),
  };
  const workspaceState = buildWorkspaceState(sources);

  const payload = {
    revisionHash,
    configJson: `${JSON.stringify(config, null, 2)}\n`,
    workspaceStateJson: `${JSON.stringify(workspaceState, null, 2)}\n`,
  };

  await database
    .insert(workspaceExecutorPackage)
    .values({
      workspaceId: input.workspaceId,
      revisionHash: payload.revisionHash,
      configJson: payload.configJson,
      workspaceStateJson: payload.workspaceStateJson,
      builtAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceExecutorPackage.workspaceId,
      set: {
        revisionHash: payload.revisionHash,
        configJson: payload.configJson,
        workspaceStateJson: payload.workspaceStateJson,
        builtAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return payload;
}

export async function ensureWorkspaceExecutorPackage(input: {
  database?: DatabaseLike;
  workspaceId: string;
  workspaceName?: string | null;
}) {
  const database = input.database ?? db;
  const existing = await database.query.workspaceExecutorPackage.findFirst({
    where: eq(workspaceExecutorPackage.workspaceId, input.workspaceId),
  });

  if (existing) {
    const sources = await database.query.workspaceExecutorSource.findMany({
      where: eq(workspaceExecutorSource.workspaceId, input.workspaceId),
      columns: {
        id: true,
        revisionHash: true,
        enabled: true,
        updatedAt: true,
      },
    });
    const nextRevisionHash = computeWorkspaceExecutorPackageRevision(sources);

    if (nextRevisionHash === existing.revisionHash) {
      return existing;
    }
  }

  return rebuildWorkspaceExecutorPackage({
    database,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
  });
}

export async function setWorkspaceExecutorSourceCredential(input: {
  database?: DatabaseLike;
  workspaceExecutorSourceId: string;
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
    .insert(workspaceExecutorSourceCredential)
    .values({
      workspaceExecutorSourceId: input.workspaceExecutorSourceId,
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
        workspaceExecutorSourceCredential.userId,
        workspaceExecutorSourceCredential.workspaceExecutorSourceId,
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

export async function setWorkspaceExecutorSourceOAuthCredential(input: {
  database?: DatabaseLike;
  workspaceExecutorSourceId: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  oauthMetadata: McpOAuthMetadata;
  displayName?: string | null;
  enabled?: boolean;
}) {
  await upsertWorkspaceExecutorSourceOAuthCredential(input);
}

export async function getWorkspaceExecutorBootstrap(input: {
  database?: DatabaseLike;
  workspaceId: string;
  workspaceName?: string | null;
  userId: string;
  allowedSourceIds?: string[] | null;
}) {
  const database = input.database ?? db;
  await ensureManagedExecutorSources({
    database,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  const [packageRow, sources, credentials] = await Promise.all([
    ensureWorkspaceExecutorPackage({
      database,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
    }),
    database.query.workspaceExecutorSource.findMany({
      where:
        input.allowedSourceIds && input.allowedSourceIds.length > 0
          ? and(
              eq(workspaceExecutorSource.workspaceId, input.workspaceId),
              inArray(workspaceExecutorSource.id, input.allowedSourceIds),
            )
          : eq(workspaceExecutorSource.workspaceId, input.workspaceId),
      orderBy: (source, { asc }) => [asc(source.namespace), asc(source.createdAt)],
    }),
    database.query.workspaceExecutorSourceCredential.findMany({
      where: eq(workspaceExecutorSourceCredential.userId, input.userId),
    }),
  ]);

  const config = JSON.parse(packageRow.configJson) as LocalExecutorConfig;
  const workspaceState = JSON.parse(packageRow.workspaceStateJson) as LocalWorkspaceState;
  const credentialBySourceId = new Map(
    credentials.map((credential) => [credential.workspaceExecutorSourceId, credential]),
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
  ).filter((source): source is WorkspaceExecutorSourceRecord => Boolean(source));

  const hydratedSourceEntries = await Promise.all(
    visibleSources.map(async (source) => {
      const baseConfig = config.sources[source.id] ?? buildBaseSourceConfig(source);
      const credential = credentialBySourceId.get(source.id);
      const hydratedConfig = await mergeAuthIntoSourceConfig({
        database,
        source,
        credential,
        userId: input.userId,
        config: baseConfig,
      });
      const refreshedCredential = source.authType === "oauth2"
        ? await database.query.workspaceExecutorSourceCredential.findFirst({
            where: and(
              eq(workspaceExecutorSourceCredential.workspaceExecutorSourceId, source.id),
              eq(workspaceExecutorSourceCredential.userId, input.userId),
            ),
          })
        : credential;
      const connected = source.internalKey
        ? await isManagedSourceConnected(source, input.userId)
        : Boolean(
            source.authType === "oauth2"
              ? refreshedCredential?.accessToken && refreshedCredential.enabled
              : credential?.secret && credential.enabled,
          );

      return {
        sourceId: source.id,
        config: hydratedConfig,
        connected,
      };
    }),
  );
  const hydratedSources = Object.fromEntries(
    hydratedSourceEntries.map((entry) => [entry.sourceId, entry.config]),
  );
  const visibleSourceIds = new Set(visibleSources.map((source) => source.id));
  const hydratedWorkspaceState: LocalWorkspaceState = {
    ...workspaceState,
    sources: Object.fromEntries(
      Object.entries(workspaceState.sources)
        .filter(([sourceId]) => visibleSourceIds.has(sourceId))
        .map(([sourceId, sourceState]) => {
          const sourceStatus = hydratedSourceEntries.find((entry) => entry.sourceId === sourceId);
          return [
            sourceId,
            sourceStatus && !sourceStatus.connected
              ? { ...sourceState, status: "auth_required" as const }
              : sourceState,
          ];
        }),
    ),
  };

  return {
    revisionHash: packageRow.revisionHash,
    configJson: `${JSON.stringify({ ...config, sources: hydratedSources }, null, 2)}\n`,
    workspaceStateJson: `${JSON.stringify(hydratedWorkspaceState, null, 2)}\n`,
    sources: visibleSources.map((source) => ({
      id: source.id,
      name: source.name,
      namespace: source.namespace,
      kind: source.kind,
      internalKey: source.internalKey,
      enabled: source.enabled,
      connected:
        hydratedSourceEntries.find((entry) => entry.sourceId === source.id)?.connected ?? false,
    })),
  };
}
