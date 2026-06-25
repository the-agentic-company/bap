import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const HOSTED_MCP_AUDIENCES = ["gmail", "bap", "galien", "modulr"] as const;

export type HostedMcpAudience = (typeof HOSTED_MCP_AUDIENCES)[number];
export type HostedMcpScope = HostedMcpAudience;

export type HostedMcpAccessTokenClaims = {
  userId: string;
  workspaceId: string;
  allowedWorkspaceIds: string[];
  allowAllWorkspaces: boolean;
  audience: HostedMcpAudience;
  scope: HostedMcpScope[];
  clientId: string;
  grantId: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
};

type HostedMcpJwtPayload = {
  workspace_id: string;
  allowed_workspace_ids?: string[];
  allow_all_workspaces?: boolean;
  client_id: string;
  grant_id: string;
  scope: string;
};

function getSigningKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function normalizeIssuerCandidate(value: string | URL): URL {
  const parsed = value instanceof URL ? new URL(value.toString()) : new URL(value);
  return new URL(parsed.origin);
}

export function resolveHostedMcpIssuerUrl(value?: string | URL): URL {
  if (value) {
    return normalizeIssuerCandidate(value);
  }

  const configured = process.env.APP_URL?.trim() || process.env.VITE_APP_URL?.trim();
  if (configured) {
    return normalizeIssuerCandidate(configured);
  }

  return new URL("http://localhost:3000");
}

export function isHostedMcpAudience(value: string): value is HostedMcpAudience {
  return HOSTED_MCP_AUDIENCES.includes(value as HostedMcpAudience);
}

export function normalizeHostedMcpScopes(value: unknown): HostedMcpScope[] {
  const rawScopes = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];

  const scopes = rawScopes
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter((scope): scope is HostedMcpScope => isHostedMcpAudience(scope));

  return Array.from(new Set(scopes));
}

export function hashHostedMcpSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function signHostedMcpAccessToken(input: {
  userId: string;
  workspaceId: string;
  allowedWorkspaceIds?: string[];
  allowAllWorkspaces?: boolean;
  audience: HostedMcpAudience;
  scope: HostedMcpScope[];
  clientId: string;
  grantId: string;
  secret: string;
  issuer?: string | URL;
  expiresInSeconds?: number;
  nowSeconds?: number;
}): Promise<string> {
  const issuer = resolveHostedMcpIssuerUrl(input.issuer).toString();
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresInSeconds = input.expiresInSeconds ?? 3600;
  const scope = normalizeHostedMcpScopes(input.scope);

  if (scope.length === 0) {
    throw new Error("Hosted MCP access tokens require at least one scope.");
  }

  return new SignJWT({
    workspace_id: input.workspaceId,
    allowed_workspace_ids: Array.from(
      new Set(
        (input.allowedWorkspaceIds ?? [])
          .map((workspaceId) => workspaceId.trim())
          .filter((workspaceId) => workspaceId.length > 0),
      ),
    ),
    allow_all_workspaces: input.allowAllWorkspaces ?? false,
    client_id: input.clientId,
    grant_id: input.grantId,
    scope: scope.join(" "),
  } satisfies HostedMcpJwtPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(input.userId)
    .setAudience(input.audience)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + expiresInSeconds)
    .sign(getSigningKey(input.secret));
}

export async function verifyHostedMcpAccessToken(
  token: string,
  input: {
    secret: string;
    expectedAudience?: HostedMcpAudience;
    issuer?: string | URL;
    nowSeconds?: number;
  },
): Promise<HostedMcpAccessTokenClaims> {
  const issuer = resolveHostedMcpIssuerUrl(input.issuer).toString();

  const verified = await jwtVerify(token, getSigningKey(input.secret), {
    issuer,
    audience: input.expectedAudience,
    currentDate:
      typeof input.nowSeconds === "number" ? new Date(input.nowSeconds * 1000) : undefined,
  });

  const payload = verified.payload as typeof verified.payload & HostedMcpJwtPayload;
  const userId = typeof payload.sub === "string" ? payload.sub : null;
  const workspaceId = typeof payload.workspace_id === "string" ? payload.workspace_id.trim() : "";
  const allowedWorkspaceIds = Array.isArray(payload.allowed_workspace_ids)
    ? Array.from(
        new Set(
          payload.allowed_workspace_ids
            .map((workspaceId) => (typeof workspaceId === "string" ? workspaceId.trim() : ""))
            .filter((workspaceId) => workspaceId.length > 0),
        ),
      )
    : [];
  const allowAllWorkspaces = payload.allow_all_workspaces === true;
  const clientId = typeof payload.client_id === "string" ? payload.client_id.trim() : "";
  const grantId = typeof payload.grant_id === "string" ? payload.grant_id.trim() : "";
  const audience =
    typeof payload.aud === "string"
      ? payload.aud
      : Array.isArray(payload.aud)
        ? payload.aud[0]
        : null;
  const scopes = normalizeHostedMcpScopes(payload.scope);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  const iss = typeof payload.iss === "string" ? payload.iss : issuer;

  if (
    !userId ||
    !workspaceId ||
    !clientId ||
    !grantId ||
    !audience ||
    !isHostedMcpAudience(audience) ||
    scopes.length === 0 ||
    exp === null ||
    iat === null
  ) {
    throw new Error("Invalid hosted MCP access token payload.");
  }

  return {
    userId,
    workspaceId,
    allowedWorkspaceIds,
    allowAllWorkspaces,
    audience,
    scope: scopes,
    clientId,
    grantId,
    exp,
    iat,
    iss,
    sub: userId,
  };
}
