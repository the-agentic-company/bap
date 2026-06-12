import type { Session, User } from "better-auth";
import {
  type HostedMcpAudience,
  verifyHostedMcpAccessToken,
} from "@cmdclaw/core/server/hosted-mcp-oauth";
import {
  type ManagedMcpTokenClaims,
  verifyManagedMcpToken,
} from "@cmdclaw/core/server/managed-mcp-auth";
import { db } from "@cmdclaw/db/client";
import { user as userTable } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export type HostedMcpContext = {
  token: string;
  userId: string;
  workspaceId: string;
  audience: HostedMcpAudience;
  scopes: string[];
  clientId: string;
  grantId: string;
  expiresAt: number;
};

// Runtime-originated caller: the Bap Platform MCP Server inside a
// generation sandbox, authenticated with a managed token (ADR-0013).
export type RuntimeMcpContext = {
  token: string;
  userId: string;
  workspaceId: string;
  spawnDepth: number;
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

const CMDCLAW_MANAGED_INTERNAL_KEY = "bap";

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
  if (claims.internalKey !== CMDCLAW_MANAGED_INTERNAL_KEY) {
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
  const authorization = headers.get("authorization");
  const token =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;

  if (!token) {
    return null;
  }

  try {
    const claims = await verifyHostedMcpAccessToken(token, {
      secret: process.env.APP_SERVER_SECRET ?? "",
    });
    const dbUser = await db.query.user.findFirst({
      where: eq(userTable.id, claims.userId),
    });
    if (!dbUser) {
      return null;
    }

    return {
      user: dbUser as unknown as User,
      session: {
        id: `hosted-mcp:${claims.grantId}`,
        userId: claims.userId,
        token: `hosted-mcp:${claims.grantId}`,
        expiresAt: new Date(claims.exp * 1000),
        createdAt: new Date(claims.iat * 1000),
        updatedAt: new Date(claims.iat * 1000),
        ipAddress: null,
        userAgent: headers.get("user-agent"),
      } as Session,
      hostedMcp: {
        token,
        userId: claims.userId,
        workspaceId: claims.workspaceId,
        audience: claims.audience,
        scopes: claims.scope,
        clientId: claims.clientId,
        grantId: claims.grantId,
        expiresAt: claims.exp,
      },
    };
  } catch {
    return null;
  }
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

    // Confine the token to its own workspace. Most routes resolve the user's
    // active workspace and ignore context.workspaceId, so a token minted for
    // workspace A could otherwise act in whatever workspace is currently active.
    // Fail closed when they diverge; the platform re-mints with the live
    // workspace on the next generation.
    const activeWorkspaceId = (dbUser as { activeWorkspaceId?: string | null }).activeWorkspaceId;
    if (activeWorkspaceId && activeWorkspaceId !== claims.workspaceId) {
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
        workspaceId: claims.workspaceId,
        spawnDepth: claims.spawnDepth ?? 0,
        expiresAt: claims.exp,
      },
    };
  } catch {
    return null;
  }
}

export async function createORPCContext(opts: { headers: Headers }): Promise<ORPCContext> {
  // Get session from Better-Auth
  const sessionData = await auth.api.getSession({
    headers: opts.headers,
  });

  if (sessionData?.session && sessionData.user) {
    return {
      headers: opts.headers,
      db,
      session: sessionData.session,
      user: sessionData.user,
      authSource: "session",
      hostedMcp: null,
      runtimeMcp: null,
      workspaceId: null,
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
