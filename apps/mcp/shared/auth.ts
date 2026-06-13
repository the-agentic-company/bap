import {
  verifyHostedMcpAccessToken,
  type HostedMcpAudience,
} from "../../../packages/core/src/server/hosted-mcp-oauth";
import { verifyManagedMcpToken } from "../../../packages/core/src/server/managed-mcp-auth";
import { buildProtectedResourceMetadataPath } from "./registry";

type AuthenticatedMcpClaims = {
  userId: string;
  workspaceId: string;
  audience: HostedMcpAudience;
  grantId?: string;
  internalKey?: string;
  remoteIntegrationSource?: {
    targetEnv: "staging" | "prod";
    remoteUserId: string;
    requestedByUserId?: string;
    requestedByEmail?: string | null;
    remoteUserEmail?: string | null;
  };
  authType: "hosted_oauth" | "managed";
};

export type AuthenticatedMcpRequest = {
  auth?: {
    token: string;
    clientId: string;
    scopes: string[];
    expiresAt?: number;
    extra: AuthenticatedMcpClaims;
  };
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
  get?: (name: string) => string | undefined;
};

function getHeader(req: AuthenticatedMcpRequest, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const viaGetter = req.get?.(name) ?? req.get?.(lowerName);
  if (viaGetter) {
    return viaGetter;
  }

  const raw = req.headers?.[lowerName];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    return raw[0];
  }
  return undefined;
}

function getBearerToken(req: AuthenticatedMcpRequest): string | null {
  const authorization = getHeader(req, "authorization");
  return typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
}

function getPublicOrigin(req: AuthenticatedMcpRequest): string | null {
  const explicit = getHeader(req, "x-bap-public-origin")?.trim();
  if (explicit && URL.canParse(explicit)) {
    return new URL(explicit).origin;
  }

  const host = getHeader(req, "x-forwarded-host") ?? getHeader(req, "host");
  if (!host) {
    return null;
  }

  const protocol = getHeader(req, "x-forwarded-proto") ?? req.protocol ?? "http";
  return `${protocol}://${host}`;
}

function buildProtectedResourceMetadataUrl(
  req: AuthenticatedMcpRequest,
  slug: HostedMcpAudience,
): string | null {
  const origin = getPublicOrigin(req);
  if (!origin) {
    return null;
  }
  return new URL(buildProtectedResourceMetadataPath(slug), origin).toString();
}

export async function authenticateHostedMcpRequest(params: {
  req: AuthenticatedMcpRequest;
  requiredAudience: HostedMcpAudience;
  allowManagedToken?: boolean;
}) {
  const token = getBearerToken(params.req);
  if (!token) {
    throw new Error("Missing bearer token.");
  }

  try {
    const claims = await verifyHostedMcpAccessToken(token, {
      secret: process.env.APP_SERVER_SECRET ?? "",
      expectedAudience: params.requiredAudience,
      issuer: getPublicOrigin(params.req) ?? undefined,
    });
    const scopes = claims.scope;
    if (!scopes.includes(params.requiredAudience)) {
      throw new Error("Insufficient scope.");
    }

    return {
      token,
      clientId: claims.clientId,
      scopes,
      expiresAt: claims.exp,
      extra: {
        userId: claims.userId,
        workspaceId: claims.workspaceId,
        audience: claims.audience,
        grantId: claims.grantId,
        authType: "hosted_oauth" as const,
      },
    };
  } catch (oauthError) {
    if (!params.allowManagedToken) {
      throw oauthError instanceof Error ? oauthError : new Error("Unauthorized");
    }

    const managedClaims = verifyManagedMcpToken(token, process.env.APP_SERVER_SECRET ?? "");
    if (managedClaims.internalKey !== params.requiredAudience) {
      throw new Error("Managed token does not match this MCP audience.");
    }

    return {
      token,
      clientId: "bap-executor",
      scopes: [params.requiredAudience],
      expiresAt: managedClaims.exp,
      extra: {
        userId: managedClaims.userId,
        workspaceId: managedClaims.workspaceId,
        audience: params.requiredAudience,
        internalKey: managedClaims.internalKey,
        remoteIntegrationSource: managedClaims.remoteIntegrationSource,
        authType: "managed" as const,
      },
    };
  }
}

export function sendUnauthorizedMcpResponse(params: {
  req: AuthenticatedMcpRequest;
  res: {
    set?: (name: string, value: string) => unknown;
    status: (code: number) => {
      json: (body: unknown) => unknown;
    };
  };
  slug: HostedMcpAudience;
  message: string;
  status?: number;
}) {
  const status = params.status ?? 401;
  const metadataUrl = buildProtectedResourceMetadataUrl(params.req, params.slug);
  const authenticateHeaderParts = [
    `Bearer error="invalid_token"`,
    `error_description="${params.message.replaceAll('"', "'")}"`,
    `scope="${params.slug}"`,
  ];

  if (metadataUrl) {
    authenticateHeaderParts.push(`resource_metadata="${metadataUrl}"`);
  }

  params.res.set?.("WWW-Authenticate", authenticateHeaderParts.join(", "));
  return params.res.status(status).json({
    error: params.message,
  });
}
