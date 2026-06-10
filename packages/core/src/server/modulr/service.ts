import { db } from "@cmdclaw/db/client";
import {
  modulrWorkspaceAccess,
  workspaceMcpServer,
  workspaceMcpAuthorization,
  workspaceMember,
} from "@cmdclaw/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { decrypt, encrypt } from "../utils/encryption";

type DatabaseLike = typeof db;

export const MODULR_INTERNAL_KEY = "modulr";
export const MODULR_DEFAULT_BASE_URL = "https://app.modulr-courtage.fr";
export const MODULR_DEFAULT_LOCALE = "fr";

export type ModulrWorkspaceConnection = {
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
};

export type ModulrConnectionStatus = {
  allowed: boolean;
  connected: boolean;
  database: string | null;
  clientId: string | null;
  locale: "fr" | "en" | null;
  baseUrl: string | null;
  displayName: string | null;
  updatedAt: Date | null;
};

export function normalizeModulrAccessEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Modulr connection must be an object.");
  }
}

function normalizeLocale(value: unknown): "fr" | "en" {
  const locale = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!locale) {
    return MODULR_DEFAULT_LOCALE;
  }
  if (locale === "fr" || locale === "en") {
    return locale;
  }
  throw new Error("Modulr locale must be fr or en.");
}

function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : MODULR_DEFAULT_BASE_URL;
  const url = new URL(raw);
  return url.origin;
}

export function normalizeModulrWorkspaceConnection(
  input: unknown,
): ModulrWorkspaceConnection {
  assertObject(input);
  const database = typeof input.database === "string" ? input.database.trim() : "";
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";

  if (!database) {
    throw new Error("Modulr database is required.");
  }
  if (!clientId) {
    throw new Error("Modulr client id is required.");
  }
  if (!clientSecret) {
    throw new Error("Modulr client secret is required.");
  }

  return {
    database,
    clientId,
    clientSecret,
    locale: normalizeLocale(input.locale),
    baseUrl: normalizeBaseUrl(input.baseUrl),
  };
}

async function readModulrErrorBody(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return JSON.stringify(await response.json());
  }
  if (contentType.startsWith("text/")) {
    return response.text();
  }
  return "";
}

function readModulrTokenPayload(payload: unknown): {
  accessToken: string | null;
  expiresIn: number | null;
} {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : {};
  const accessToken = typeof root.access_token === "string"
    ? root.access_token.trim()
    : typeof data.access_token === "string"
      ? data.access_token.trim()
      : "";
  const expiresIn = typeof root.expires_in === "number"
    ? root.expires_in
    : typeof data.expires_in === "number"
      ? data.expires_in
      : null;

  return {
    accessToken: accessToken || null,
    expiresIn,
  };
}

export async function validateModulrWorkspaceConnection(
  connection: ModulrWorkspaceConnection,
): Promise<{ ok: true; expiresIn: number | null }> {
  const normalized = normalizeModulrWorkspaceConnection(connection);
  const response = await fetch(
    new URL(`/${normalized.locale}/api/1.0/tokens/users`, normalized.baseUrl),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        Database: normalized.database,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: normalized.clientId,
        client_secret: normalized.clientSecret,
      }).toString(),
    },
  );

  if (!response.ok) {
    const body = await readModulrErrorBody(response);
    throw new Error(
      `Modulr authentication failed (${response.status} ${response.statusText})${
        body ? `: ${body}` : ""
      }`,
    );
  }

  const tokenPayload = readModulrTokenPayload(await response.json());
  if (!tokenPayload.accessToken) {
    throw new Error("Modulr authentication succeeded but did not return an access token.");
  }

  return {
    ok: true,
    expiresIn: tokenPayload.expiresIn,
  };
}

async function findModulrManagedSource(input: {
  database?: DatabaseLike;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  return database.query.workspaceMcpServer.findFirst({
    where: and(
      eq(workspaceMcpServer.workspaceId, input.workspaceId),
      eq(workspaceMcpServer.internalKey, MODULR_INTERNAL_KEY),
    ),
  });
}

async function findModulrCredential(input: {
  database?: DatabaseLike;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  const source = await findModulrManagedSource(input);
  if (!source) {
    return { source: null, credential: null };
  }

  const credential = await database.query.workspaceMcpAuthorization.findFirst({
    where: and(
      eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
      eq(workspaceMcpAuthorization.enabled, true),
    ),
    orderBy: (record) => [desc(record.updatedAt)],
  });

  return { source, credential };
}

export async function getModulrWorkspaceConnection(input: {
  database?: DatabaseLike;
  workspaceId: string;
}): Promise<ModulrWorkspaceConnection | null> {
  const { credential } = await findModulrCredential(input);
  if (!credential?.secret) {
    return null;
  }

  return normalizeModulrWorkspaceConnection(JSON.parse(decrypt(credential.secret)));
}

export async function canUserUseModulrInWorkspace(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const database = input.database ?? db;
  const membership = await database.query.workspaceMember.findFirst({
    where: and(
      eq(workspaceMember.userId, input.userId),
      eq(workspaceMember.workspaceId, input.workspaceId),
    ),
    with: {
      user: {
        columns: {
          email: true,
        },
      },
    },
  });

  const normalizedEmail = membership?.user?.email
    ? normalizeModulrAccessEmail(membership.user.email)
    : "";
  if (!normalizedEmail) {
    return false;
  }

  const allowed = await database.query.modulrWorkspaceAccess.findFirst({
    where: and(
      eq(modulrWorkspaceAccess.workspaceId, input.workspaceId),
      eq(modulrWorkspaceAccess.email, normalizedEmail),
    ),
    columns: { id: true },
  });

  return Boolean(allowed);
}

export async function listModulrWorkspaceAccess(input: {
  database?: DatabaseLike;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  return database.query.modulrWorkspaceAccess.findMany({
    where: eq(modulrWorkspaceAccess.workspaceId, input.workspaceId),
    orderBy: (entry, { asc }) => [asc(entry.email), asc(entry.createdAt)],
  });
}

export async function addModulrWorkspaceAccess(input: {
  database?: DatabaseLike;
  workspaceId: string;
  email: string;
  createdByUserId: string;
}) {
  const database = input.database ?? db;
  const email = normalizeModulrAccessEmail(input.email);
  if (!email) {
    throw new Error("Email is required.");
  }

  const [entry] = await database
    .insert(modulrWorkspaceAccess)
    .values({
      workspaceId: input.workspaceId,
      email,
      createdByUserId: input.createdByUserId,
    })
    .onConflictDoUpdate({
      target: [modulrWorkspaceAccess.workspaceId, modulrWorkspaceAccess.email],
      set: {
        createdByUserId: input.createdByUserId,
      },
    })
    .returning();

  return entry;
}

export async function removeModulrWorkspaceAccess(input: {
  database?: DatabaseLike;
  id: string;
}) {
  const database = input.database ?? db;
  const [entry] = await database
    .delete(modulrWorkspaceAccess)
    .where(eq(modulrWorkspaceAccess.id, input.id))
    .returning();
  return entry ?? null;
}

export async function getModulrWorkspaceConnectionStatus(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}): Promise<ModulrConnectionStatus> {
  const [allowed, found] = await Promise.all([
    canUserUseModulrInWorkspace(input),
    findModulrCredential(input),
  ]);
  const { credential } = found;
  if (!credential?.secret) {
    return {
      allowed,
      connected: false,
      database: null,
      clientId: null,
      locale: null,
      baseUrl: null,
      displayName: null,
      updatedAt: null,
    };
  }

  const connection = normalizeModulrWorkspaceConnection(JSON.parse(decrypt(credential.secret)));
  return {
    allowed,
    connected: true,
    database: connection.database,
    clientId: connection.clientId,
    locale: connection.locale,
    baseUrl: connection.baseUrl,
    displayName: credential.displayName,
    updatedAt: credential.updatedAt,
  };
}

export async function setModulrWorkspaceConnection(input: {
  database?: DatabaseLike;
  workspaceId: string;
  userId: string;
  connection: ModulrWorkspaceConnection;
}) {
  const database = input.database ?? db;
  const source = await findModulrManagedSource({
    database,
    workspaceId: input.workspaceId,
  });
  if (!source) {
    throw new Error("Modulr MCP source is not configured for this workspace.");
  }

  const connection = normalizeModulrWorkspaceConnection(input.connection);
  await validateModulrWorkspaceConnection(connection);

  await database
    .insert(workspaceMcpAuthorization)
    .values({
      workspaceMcpServerId: source.id,
      userId: input.userId,
      secret: encrypt(JSON.stringify(connection)),
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      oauthMetadata: null,
      displayName: connection.database,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [
        workspaceMcpAuthorization.userId,
        workspaceMcpAuthorization.workspaceMcpServerId,
      ],
      set: {
        secret: encrypt(JSON.stringify(connection)),
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        oauthMetadata: null,
        displayName: connection.database,
        enabled: true,
        updatedAt: new Date(),
      },
    });

  await database
    .delete(workspaceMcpAuthorization)
    .where(
      and(
        eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
        ne(workspaceMcpAuthorization.userId, input.userId),
      ),
    );
}

export async function deleteModulrWorkspaceConnection(input: {
  database?: DatabaseLike;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  const source = await findModulrManagedSource({
    database,
    workspaceId: input.workspaceId,
  });
  if (!source) {
    return;
  }

  await database
    .delete(workspaceMcpAuthorization)
    .where(eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id));
}
