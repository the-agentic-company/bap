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

function normalizeHostedMcpWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((workspaceId) => (typeof workspaceId === "string" ? workspaceId.trim() : ""))
        .filter((workspaceId) => workspaceId.length > 0),
    ),
  );
}

function readRequiredHostedMcpString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveHostedMcpAudienceClaim(value: unknown): HostedMcpAudience | null {
  const audience =
    typeof value === "string" ? value : Array.isArray(value) ? readRequiredHostedMcpString(value[0]) : null;

  return audience && isHostedMcpAudience(audience) ? audience : null;
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
    allowed_workspace_ids: normalizeHostedMcpWorkspaceIds(input.allowedWorkspaceIds ?? []),
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
  const userId = readRequiredHostedMcpString(payload.sub);
  const workspaceId = readRequiredHostedMcpString(payload.workspace_id);
  const allowedWorkspaceIds = normalizeHostedMcpWorkspaceIds(payload.allowed_workspace_ids);
  const allowAllWorkspaces = payload.allow_all_workspaces === true;
  const clientId = readRequiredHostedMcpString(payload.client_id);
  const grantId = readRequiredHostedMcpString(payload.grant_id);
  const audience = resolveHostedMcpAudienceClaim(payload.aud);
  const scopes = normalizeHostedMcpScopes(payload.scope);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  const iss = readRequiredHostedMcpString(payload.iss) ?? issuer;

  if (
    !userId ||
    !workspaceId ||
    !clientId ||
    !grantId ||
    !audience ||
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
