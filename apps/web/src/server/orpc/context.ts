import type { Session, User } from "better-auth";
import {
  type HostedMcpAudience,
  verifyHostedMcpAccessToken,
} from "@bap/core/server/hosted-mcp-oauth";
import {
  type ManagedMcpTokenClaims,
  verifyManagedMcpToken,
} from "@bap/core/server/managed-mcp-auth";
import { db } from "@bap/db/client";
import { user as userTable } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { getRequestSession } from "@/server/session-auth";

export type HostedMcpContext = {
  token: string;
  userId: string;
  workspaceId: string;
  allowedWorkspaceIds: string[];
  allowAllWorkspaces: boolean;
  audience: HostedMcpAudience;
  scopes: string[];
  clientId: string;
  grantId: string;
  expiresAt: number;
  issuedAt: number;
};

// Runtime-originated caller: the Bap Platform MCP Server inside a
// generation sandbox, authenticated with a managed token (ADR-0013).
export type RuntimeMcpContext = {
  token: string;
  userId: string;
  workspaceId: string;
  spawnDepth: number;
  scopes: string[];
  surface?: ManagedMcpTokenClaims["surface"];
  generationId?: string;
  conversationId?: string;
  coworkerId?: string;
  coworkerRunId?: string;
  expiresAt: number;
};

export type ORPCContext = {
  headers: Headers;
  db: typeof db;
  session: Session | null;
  user: User | null;
  authSource: "anonymous" | "session" | "hosted_mcp" | "managed_mcp";
  hostedMcp: HostedMcpContext | null;
  runtimeMcp: RuntimeMcpContext | null;
  workspaceId: string | null;
};

const BAP_MANAGED_INTERNAL_KEY = "bap";

function resolvePublicMcpOrigin(headers: Headers): string | undefined {
  const explicit = headers.get("x-bap-public-origin")?.trim();
  if (explicit && URL.canParse(explicit)) {
    return new URL(explicit).origin;
  }

  const forwardedHost = headers.get("x-forwarded-host")?.trim();
  if (!forwardedHost) {
    return undefined;
  }

  const forwardedProto = headers.get("x-forwarded-proto")?.trim() || "https";
  return `${forwardedProto}://${forwardedHost}`;
}

export async function resolveHostedMcpClaims(
  headers: Headers,
  secret: string,
  nowSeconds?: number,
): Promise<HostedMcpContext> {
  const authorization = headers.get("authorization");
  const token =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  if (!secret) {
    throw new Error("Hosted MCP secret is not configured.");
  }

  const claims = await verifyHostedMcpAccessToken(token, {
    secret,
    expectedAudience: "bap",
    issuer: resolvePublicMcpOrigin(headers),
    nowSeconds,
  });
  if (!claims.scope.includes("bap")) {
    throw new Error("Hosted MCP token is missing the Bap scope.");
  }

  return {
    token,
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    allowedWorkspaceIds: claims.allowedWorkspaceIds,
    allowAllWorkspaces: claims.allowAllWorkspaces,
    audience: claims.audience,
    scopes: claims.scope,
    clientId: claims.clientId,
    grantId: claims.grantId,
    expiresAt: claims.exp,
    issuedAt: claims.iat,
  };
}

export function resolveManagedMcpClaims(
  headers: Headers,
  secret: string,
  nowSeconds?: number,
): ManagedMcpTokenClaims & { token: string } {
  const authorization = headers.get("authorization");
  const token =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  if (!secret) {
    throw new Error("Managed MCP secret is not configured.");
  }
  const claims = verifyManagedMcpToken(token, secret, nowSeconds);
  if (claims.internalKey !== BAP_MANAGED_INTERNAL_KEY) {
    throw new Error("Managed MCP token is not valid for the Bap API.");
  }
  // Fail closed: the platform server always mints a spawn depth. A Bap token
  // without one is malformed and must not default to spawnable root depth.
  if (typeof claims.spawnDepth !== "number") {
    throw new Error("Managed Bap token is missing its spawn depth.");
  }
  return { ...claims, token };
}

async function resolveHostedMcpContext(headers: Headers): Promise<{
  user: User;
  session: Session;
  hostedMcp: HostedMcpContext;
} | null> {
  try {
    const hostedMcp = await resolveHostedMcpClaims(headers, process.env.APP_SERVER_SECRET ?? "");
    const dbUser = await db.query.user.findFirst({
      where: eq(userTable.id, hostedMcp.userId),
    });
    if (!dbUser) {
      return null;
    }

    const workspaceId = resolveHostedMcpWorkspaceId({
      hostedMcp,
      requestedWorkspaceId: resolveRequestedMcpWorkspaceId(headers),
    });

    if (!workspaceId) {
      return null;
    }

    return {
      user: dbUser as unknown as User,
      session: {
        id: `hosted-mcp:${hostedMcp.grantId}`,
        userId: hostedMcp.userId,
        token: `hosted-mcp:${hostedMcp.grantId}`,
        expiresAt: new Date(hostedMcp.expiresAt * 1000),
        createdAt: new Date(hostedMcp.issuedAt * 1000),
        updatedAt: new Date(hostedMcp.issuedAt * 1000),
        ipAddress: null,
        userAgent: headers.get("user-agent"),
      } as Session,
      hostedMcp: {
        ...hostedMcp,
        workspaceId,
      },
    };
  } catch {
    return null;
  }
}

function resolveRequestedMcpWorkspaceId(headers: Headers): string | null {
  const rawWorkspaceId = headers.get("x-bap-workspace-id");
  if (rawWorkspaceId === null) {
    return null;
  }

  const workspaceId = rawWorkspaceId.trim();
  if (!workspaceId) {
    throw new Error("Requested workspace ID must not be empty.");
  }

  return workspaceId;
}

function resolveHostedMcpWorkspaceId(params: {
  hostedMcp: HostedMcpContext;
  requestedWorkspaceId: string | null;
}): string {
  if (!params.requestedWorkspaceId) {
    return params.hostedMcp.workspaceId;
  }

  if (
    params.hostedMcp.allowAllWorkspaces ||
    params.hostedMcp.allowedWorkspaceIds.includes(params.requestedWorkspaceId)
  ) {
    return params.requestedWorkspaceId;
  }

  throw new Error("Requested workspace is outside the hosted MCP grant.");
}

async function resolveRuntimeMcpContext(headers: Headers): Promise<{
  user: User;
  session: Session;
  runtimeMcp: RuntimeMcpContext;
} | null> {
  try {
    const claims = resolveManagedMcpClaims(headers, process.env.APP_SERVER_SECRET ?? "");
    const dbUser = await db.query.user.findFirst({
      where: eq(userTable.id, claims.userId),
    });
    if (!dbUser) {
      return null;
    }

    const requestedWorkspaceId = resolveRequestedMcpWorkspaceId(headers);
    if (requestedWorkspaceId && requestedWorkspaceId !== claims.workspaceId) {
      return null;
    }

    return {
      user: dbUser as unknown as User,
      session: {
        id: `managed-mcp:${claims.userId}`,
        userId: claims.userId,
        token: `managed-mcp:${claims.userId}`,
        expiresAt: new Date(claims.exp * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: headers.get("user-agent"),
      } as Session,
      runtimeMcp: {
        token: claims.token,
        userId: claims.userId,
        workspaceId: requestedWorkspaceId ?? claims.workspaceId,
        spawnDepth: claims.spawnDepth ?? 0,
        scopes: claims.scopes ?? [claims.internalKey],
        surface: claims.surface,
        generationId: claims.generationId,
        conversationId: claims.conversationId,
        coworkerId: claims.coworkerId,
        coworkerRunId: claims.coworkerRunId,
        expiresAt: claims.exp,
      },
    };
  } catch {
    return null;
  }
}

export async function createORPCContext(opts: { headers: Headers }): Promise<ORPCContext> {
  // Get session from Better-Auth
  const sessionData = await getRequestSession(opts.headers);

  if (sessionData?.session && sessionData.user) {
    return {
      headers: opts.headers,
      db,
      session: sessionData.session,
      user: sessionData.user,
      authSource: "session",
      hostedMcp: null,
      runtimeMcp: null,
      workspaceId:
        (sessionData.session as { activeOrganizationId?: string | null }).activeOrganizationId ??
        null,
    };
  }

  const hostedMcpAuth = await resolveHostedMcpContext(opts.headers);
  if (hostedMcpAuth) {
    return {
      headers: opts.headers,
      db,
      session: hostedMcpAuth.session,
      user: hostedMcpAuth.user,
      authSource: "hosted_mcp",
      hostedMcp: hostedMcpAuth.hostedMcp,
      runtimeMcp: null,
      workspaceId: hostedMcpAuth.hostedMcp.workspaceId,
    };
  }

  const runtimeMcpAuth = await resolveRuntimeMcpContext(opts.headers);

  return {
    headers: opts.headers,
    db,
    session: runtimeMcpAuth?.session ?? null,
    user: runtimeMcpAuth?.user ?? null,
    authSource: runtimeMcpAuth ? "managed_mcp" : "anonymous",
    hostedMcp: null,
    runtimeMcp: runtimeMcpAuth?.runtimeMcp ?? null,
    workspaceId: runtimeMcpAuth?.runtimeMcp.workspaceId ?? null,
  };
}
