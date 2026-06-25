import {
  getWorkspaceMembershipForUser,
  listWorkspacesForUser,
} from "@bap/core/server/billing/service";
import { canUserUseGalienInWorkspace } from "@bap/core/server/galien/service";
import {
  type HostedMcpAudience,
  HOSTED_MCP_AUDIENCES,
  normalizeHostedMcpScopes,
  resolveHostedMcpIssuerUrl,
  signHostedMcpAccessToken,
} from "@bap/core/server/hosted-mcp-oauth";
import { canUserUseModulrInWorkspace } from "@bap/core/server/modulr/service";
import { db } from "@bap/db/client";
import {
  hostedMcpOauthAuthorizationCode,
  hostedMcpOauthClient,
  hostedMcpOauthGrant,
  hostedMcpOauthRefreshToken,
} from "@bap/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { env } from "@/env";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const AUTHORIZATION_ENDPOINT_PATH = "/api/mcp/oauth/authorize";
const TOKEN_ENDPOINT_PATH = "/api/mcp/oauth/token";
const REGISTRATION_ENDPOINT_PATH = "/api/mcp/oauth/register";
const HOSTED_MCP_AUTH_SCOPES = [...HOSTED_MCP_AUDIENCES];
const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type HostedMcpConsentParams = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  audience: HostedMcpAudience;
  resource: string;
  resourceName: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string;
  currentWorkspaceId: string | null;
  workspaces: Array<{
    id: string;
    name: string;
    active: boolean;
  }>;
  selectedWorkspaceIds?: string[];
  allowAllWorkspaces?: boolean;
};

type HostedMcpClientMetadata = {
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  policy_uri?: string;
  tos_uri?: string;
  scope?: string;
};

type HostedMcpRegisteredClientResponse = {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  policy_uri?: string;
  tos_uri?: string;
  scope?: string;
};

function hashOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function encodeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildIssuerUrl(request: Request): URL {
  return resolveHostedMcpIssuerUrl(buildRequestAwareUrl("/", request));
}

export function buildHostedMcpAuthorizationServerMetadata(request: Request) {
  const issuer = buildIssuerUrl(request);

  return {
    issuer: issuer.toString(),
    authorization_endpoint: buildRequestAwareUrl(AUTHORIZATION_ENDPOINT_PATH, request).toString(),
    token_endpoint: buildRequestAwareUrl(TOKEN_ENDPOINT_PATH, request).toString(),
    registration_endpoint: buildRequestAwareUrl(REGISTRATION_ENDPOINT_PATH, request).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: HOSTED_MCP_AUTH_SCOPES,
  };
}

function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) {
    return true;
  }

  let req: URL;
  let reg: URL;
  try {
    req = new URL(requested);
    reg = new URL(registered);
  } catch {
    return false;
  }

  if (!LOOPBACK_HOSTS.has(req.hostname) || !LOOPBACK_HOSTS.has(reg.hostname)) {
    return false;
  }

  return (
    req.protocol === reg.protocol &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search
  );
}

function resolveHostedMcpResource(resource: string | URL): {
  audience: HostedMcpAudience;
  resource: string;
  resourceName: string;
} {
  const parsed = resource instanceof URL ? resource : new URL(resource);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "/gmail" || pathname === "/gmail/mcp") {
    return {
      audience: "gmail",
      resource: parsed.toString(),
      resourceName: "Bap Gmail MCP",
    };
  }
  if (pathname === "/bap" || pathname === "/bap/mcp") {
    return {
      audience: "bap",
      resource: parsed.toString(),
      resourceName: "Bap MCP",
    };
  }
  if (pathname === "/galien" || pathname === "/galien/mcp") {
    return {
      audience: "galien",
      resource: parsed.toString(),
      resourceName: "Galien MCP",
    };
  }
  if (pathname === "/modulr" || pathname === "/modulr/mcp") {
    return {
      audience: "modulr",
      resource: parsed.toString(),
      resourceName: "Modulr MCP",
    };
  }

  throw new Error("Unsupported hosted MCP resource.");
}

function normalizeRequestedScopes(
  resourceAudience: HostedMcpAudience,
  scopeParam: string | null,
): string[] {
  const requested = normalizeHostedMcpScopes(scopeParam ?? resourceAudience);
  if (requested.length === 0) {
    return [resourceAudience];
  }

  if (requested.some((scope) => scope !== resourceAudience)) {
    return [resourceAudience];
  }

  return requested;
}

function validateClientMetadata(metadata: HostedMcpClientMetadata) {
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
    throw new Error("redirect_uris must contain at least one redirect URI.");
  }

  for (const redirectUri of metadata.redirect_uris) {
    if (typeof redirectUri !== "string" || !URL.canParse(redirectUri)) {
      throw new Error("redirect_uris must be valid URLs.");
    }
  }

  const tokenEndpointAuthMethod = metadata.token_endpoint_auth_method ?? "none";
  if (tokenEndpointAuthMethod !== "none") {
    throw new Error(
      "Only public OAuth clients with token_endpoint_auth_method=none are supported.",
    );
  }

  const grantTypes = metadata.grant_types ?? ["authorization_code", "refresh_token"];
  if (
    grantTypes.length !== 2 ||
    !grantTypes.includes("authorization_code") ||
    !grantTypes.includes("refresh_token")
  ) {
    throw new Error("Clients must support authorization_code and refresh_token grant types.");
  }

  const responseTypes = metadata.response_types ?? ["code"];
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    throw new Error("Clients must support response_type=code.");
  }
}

export async function registerHostedMcpClient(metadata: HostedMcpClientMetadata) {
  validateClientMetadata(metadata);

  const clientId = `bap-mcp-${randomUUID()}`;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const [created] = await db
    .insert(hostedMcpOauthClient)
    .values([
      {
        clientId,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method ?? "none",
        redirectUris: metadata.redirect_uris ?? [],
        grantTypes: metadata.grant_types ?? ["authorization_code", "refresh_token"],
        responseTypes: metadata.response_types ?? ["code"],
        clientName: metadata.client_name ?? null,
        clientUri: metadata.client_uri ?? null,
        logoUri: metadata.logo_uri ?? null,
        contacts: metadata.contacts ?? null,
        policyUri: metadata.policy_uri ?? null,
        tosUri: metadata.tos_uri ?? null,
        scope: metadata.scope ?? null,
      },
    ])
    .returning();

  return formatHostedMcpRegisteredClient(created, nowSeconds);
}

export async function getHostedMcpClient(clientId: string) {
  return db.query.hostedMcpOauthClient.findFirst({
    where: eq(hostedMcpOauthClient.clientId, clientId),
  });
}

function formatHostedMcpRegisteredClient(
  client: typeof hostedMcpOauthClient.$inferSelect,
  issuedAtSeconds: number,
): HostedMcpRegisteredClientResponse {
  return {
    client_id: client.clientId,
    client_id_issued_at: issuedAtSeconds,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    ...(client.clientName ? { client_name: client.clientName } : {}),
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
    ...(client.contacts && client.contacts.length > 0 ? { contacts: client.contacts } : {}),
    ...(client.policyUri ? { policy_uri: client.policyUri } : {}),
    ...(client.tosUri ? { tos_uri: client.tosUri } : {}),
    ...(client.scope ? { scope: client.scope } : {}),
  };
}

export async function createHostedMcpAuthorizationCode(params: {
  clientId: string;
  userId: string;
  workspaceId: string;
  allowedWorkspaceIds?: string[];
  allowAllWorkspaces?: boolean;
  resource: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const resolved = resolveHostedMcpResource(params.resource);
  if (
    resolved.audience === "galien" &&
    !(await canUserUseGalienInWorkspace({
      userId: params.userId,
      workspaceId: params.workspaceId,
    }))
  ) {
    throw new Error("Galien is not enabled for this user in the selected workspace.");
  }
  if (
    resolved.audience === "modulr" &&
    !(await canUserUseModulrInWorkspace({
      userId: params.userId,
      workspaceId: params.workspaceId,
    }))
  ) {
    throw new Error("Modulr is not enabled for this user in the selected workspace.");
  }

  const scopes = normalizeRequestedScopes(resolved.audience, params.scopes.join(" "));
  const grantId = randomUUID();
  const authorizationCode = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(hostedMcpOauthGrant).values({
      id: grantId,
      clientId: params.clientId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      audience: resolved.audience,
      resource: resolved.resource,
      scopes,
      allowedWorkspaceIds: params.allowedWorkspaceIds ?? [],
      allowAllWorkspaces: params.allowAllWorkspaces ?? false,
    });

    await tx.insert(hostedMcpOauthAuthorizationCode).values({
      codeHash: hashOpaqueSecret(authorizationCode),
      grantId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      expiresAt,
    });
  });

  return authorizationCode;
}

function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  const actualChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return actualChallenge === expectedChallenge;
}

async function createRefreshTokenRecord(params: {
  grantId: string;
  clientId: string;
}): Promise<string> {
  const refreshToken = randomBytes(48).toString("base64url");
  await db.insert(hostedMcpOauthRefreshToken).values({
    tokenHash: hashOpaqueSecret(refreshToken),
    grantId: params.grantId,
    clientId: params.clientId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return refreshToken;
}

async function issueHostedMcpTokenSet(params: {
  grant: typeof hostedMcpOauthGrant.$inferSelect;
  clientId: string;
  request: Request;
  refreshToken?: string;
}) {
  const accessToken = await signHostedMcpAccessToken({
    userId: params.grant.userId,
    workspaceId: params.grant.workspaceId,
    allowedWorkspaceIds: params.grant.allowedWorkspaceIds,
    allowAllWorkspaces: params.grant.allowAllWorkspaces,
    audience: resolveHostedMcpResource(params.grant.resource).audience,
    scope: normalizeHostedMcpScopes(params.grant.scopes),
    clientId: params.clientId,
    grantId: params.grant.id,
    secret: env.APP_SERVER_SECRET,
    issuer: params.grant.resource,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });
  const refreshToken =
    params.refreshToken ??
    (await createRefreshTokenRecord({
      grantId: params.grant.id,
      clientId: params.clientId,
    }));

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: params.grant.scopes.join(" "),
    refresh_token: refreshToken,
  };
}

export async function exchangeHostedMcpAuthorizationCode(params: {
  request: Request;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string | null;
  resource: string | null;
}) {
  const codeRow = await db.query.hostedMcpOauthAuthorizationCode.findFirst({
    where: eq(hostedMcpOauthAuthorizationCode.codeHash, hashOpaqueSecret(params.code)),
  });

  if (!codeRow) {
    throw new Error("Invalid authorization code.");
  }
  if (codeRow.consumedAt) {
    throw new Error("Authorization code has already been used.");
  }
  if (codeRow.expiresAt.getTime() <= Date.now()) {
    throw new Error("Authorization code has expired.");
  }
  if (params.redirectUri && !redirectUriMatches(params.redirectUri, codeRow.redirectUri)) {
    throw new Error("redirect_uri does not match the authorization code.");
  }
  if (!verifyPkceS256(params.codeVerifier, codeRow.codeChallenge)) {
    throw new Error("code_verifier does not match the authorization code challenge.");
  }

  const grant = await db.query.hostedMcpOauthGrant.findFirst({
    where: and(eq(hostedMcpOauthGrant.id, codeRow.grantId), isNull(hostedMcpOauthGrant.revokedAt)),
  });

  if (!grant || grant.clientId !== params.clientId) {
    throw new Error("Authorization grant is invalid.");
  }
  if (params.resource && params.resource !== grant.resource) {
    throw new Error("Requested resource does not match the authorization grant.");
  }

  await db
    .update(hostedMcpOauthAuthorizationCode)
    .set({ consumedAt: new Date() })
    .where(eq(hostedMcpOauthAuthorizationCode.id, codeRow.id));

  return issueHostedMcpTokenSet({
    grant,
    clientId: params.clientId,
    request: params.request,
  });
}

export async function exchangeHostedMcpRefreshToken(params: {
  request: Request;
  clientId: string;
  refreshToken: string;
  resource: string | null;
}) {
  const refreshTokenRow = await db.query.hostedMcpOauthRefreshToken.findFirst({
    where: and(
      eq(hostedMcpOauthRefreshToken.tokenHash, hashOpaqueSecret(params.refreshToken)),
      eq(hostedMcpOauthRefreshToken.clientId, params.clientId),
      isNull(hostedMcpOauthRefreshToken.revokedAt),
      gt(hostedMcpOauthRefreshToken.expiresAt, new Date()),
    ),
  });

  if (!refreshTokenRow) {
    throw new Error("Invalid refresh token.");
  }

  const grant = await db.query.hostedMcpOauthGrant.findFirst({
    where: and(
      eq(hostedMcpOauthGrant.id, refreshTokenRow.grantId),
      eq(hostedMcpOauthGrant.clientId, params.clientId),
      isNull(hostedMcpOauthGrant.revokedAt),
    ),
  });

  if (!grant) {
    throw new Error("Authorization grant is invalid.");
  }
  if (params.resource && params.resource !== grant.resource) {
    throw new Error("Requested resource does not match the authorization grant.");
  }

  await db
    .update(hostedMcpOauthRefreshToken)
    .set({
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      updatedAt: new Date(),
    })
    .where(eq(hostedMcpOauthRefreshToken.id, refreshTokenRow.id));

  return issueHostedMcpTokenSet({
    grant,
    clientId: params.clientId,
    request: params.request,
    refreshToken: params.refreshToken,
  });
}

export async function listHostedMcpConsentWorkspaces(userId: string) {
  const workspaces = await listWorkspacesForUser(userId);
  return workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    active: workspace.active,
  }));
}

export async function assertHostedMcpWorkspaceMembership(userId: string, workspaceId: string) {
  const membership = await getWorkspaceMembershipForUser(userId, workspaceId);
  if (!membership) {
    throw new Error("Workspace not found.");
  }
  return membership;
}

export function resolveHostedMcpConsentWorkspaceId(
  workspaces: Array<{ id: string; active: boolean }>,
): string | null {
  return workspaces.find((workspace) => workspace.active)?.id ?? workspaces[0]?.id ?? null;
}

export function normalizeHostedMcpSelectedWorkspaceIds(
  value: FormDataEntryValue | Array<FormDataEntryValue> | null,
): string[] {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      rawValues
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((workspaceId) => workspaceId.length > 0),
    ),
  );
}

function resolveSingleWorkspaceConsent(params: {
  userId: string;
  workspaceId: string | null;
}) {
  const workspaceId = params.workspaceId?.trim() ?? "";
  if (!workspaceId) {
    throw new Error("workspace_id is required.");
  }

  return {
    workspaceId,
    verify: assertHostedMcpWorkspaceMembership(params.userId, workspaceId),
  };
}

function resolveAllWorkspaceConsent(workspaces: Array<{ id: string; active: boolean }>) {
  const workspaceId = resolveHostedMcpConsentWorkspaceId(workspaces);
  if (!workspaceId) {
    throw new Error("At least one workspace membership is required.");
  }

  const allowedWorkspaceIds = workspaces.map((workspace) => workspace.id);
  return {
    workspaceId,
    allowedWorkspaceIds,
    allowAllWorkspaces: true,
    selectedWorkspaceIds: allowedWorkspaceIds,
  };
}

async function resolveSelectedWorkspaceConsent(params: {
  userId: string;
  workspaces: Array<{ id: string; active: boolean }>;
  selectedWorkspaceIds: string[];
}) {
  if (params.selectedWorkspaceIds.length === 0) {
    throw new Error("Select at least one workspace or authorize all workspaces.");
  }

  await Promise.all(
    params.selectedWorkspaceIds.map((workspaceId) =>
      assertHostedMcpWorkspaceMembership(params.userId, workspaceId),
    ),
  );

  const allowedWorkspaceIds = [...params.selectedWorkspaceIds];
  const currentWorkspaceId = resolveHostedMcpConsentWorkspaceId(params.workspaces);
  const workspaceId =
    (currentWorkspaceId && allowedWorkspaceIds.includes(currentWorkspaceId)
      ? currentWorkspaceId
      : allowedWorkspaceIds[0]) ?? null;

  if (!workspaceId) {
    throw new Error("Select at least one workspace or authorize all workspaces.");
  }

  return {
    workspaceId,
    allowedWorkspaceIds,
    allowAllWorkspaces: false,
    selectedWorkspaceIds: allowedWorkspaceIds,
  };
}

export async function resolveHostedMcpWorkspaceConsent(params: {
  audience: HostedMcpAudience;
  userId: string;
  workspaces: Array<{ id: string; active: boolean }>;
  workspaceAccessMode: string | null;
  selectedWorkspaceIds: string[];
  workspaceId: string | null;
}) {
  if (params.audience !== "bap") {
    const singleWorkspaceConsent = resolveSingleWorkspaceConsent({
      userId: params.userId,
      workspaceId: params.workspaceId,
    });
    await singleWorkspaceConsent.verify;
    return {
      workspaceId: singleWorkspaceConsent.workspaceId,
      allowedWorkspaceIds: [singleWorkspaceConsent.workspaceId],
      allowAllWorkspaces: false,
      selectedWorkspaceIds: [singleWorkspaceConsent.workspaceId],
    };
  }

  if (params.workspaces.length === 0) {
    throw new Error("At least one workspace membership is required.");
  }

  if (params.workspaceAccessMode === "all") {
    return resolveAllWorkspaceConsent(params.workspaces);
  }

  return resolveSelectedWorkspaceConsent({
    userId: params.userId,
    workspaces: params.workspaces,
    selectedWorkspaceIds: params.selectedWorkspaceIds,
  });
}

export async function parseHostedMcpAuthorizationRequest(params: URLSearchParams) {
  const clientId = params.get("client_id")?.trim();
  const redirectUri = params.get("redirect_uri")?.trim() ?? null;
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge")?.trim();
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");
  const resource = params.get("resource")?.trim();
  const scope = params.get("scope");

  if (!clientId) {
    throw new Error("client_id is required.");
  }
  if (responseType !== "code") {
    throw new Error("response_type must be code.");
  }
  if (!codeChallenge) {
    throw new Error("code_challenge is required.");
  }
  if (codeChallengeMethod !== "S256") {
    throw new Error("code_challenge_method must be S256.");
  }
  if (!resource || !URL.canParse(resource)) {
    throw new Error("resource is required and must be a valid URL.");
  }

  const client = await getHostedMcpClient(clientId);
  if (!client) {
    throw new Error("Unknown OAuth client.");
  }

  const effectiveRedirectUri = redirectUri ?? client.redirectUris[0] ?? null;
  if (!effectiveRedirectUri) {
    throw new Error("redirect_uri is required.");
  }
  if (
    !client.redirectUris.some((candidate) => redirectUriMatches(effectiveRedirectUri, candidate))
  ) {
    throw new Error("redirect_uri is not registered for this client.");
  }

  const resolvedResource = resolveHostedMcpResource(resource);
  const scopes = normalizeRequestedScopes(resolvedResource.audience, scope);

  return {
    client,
    clientId,
    clientName: client.clientName?.trim() || "Bap MCP Client",
    redirectUri: effectiveRedirectUri,
    state,
    codeChallenge,
    resource: resolvedResource.resource,
    resourceName: resolvedResource.resourceName,
    audience: resolvedResource.audience,
    scopes,
  };
}

export function renderHostedMcpConsentHtml(params: HostedMcpConsentParams) {
  const isBapAudience = params.audience === "bap";
  const selectedWorkspaceIds = params.selectedWorkspaceIds ?? [];
  const allowAllWorkspaces = params.allowAllWorkspaces ?? isBapAudience;
  const workspaceOptions = params.workspaces
    .map((workspace) => {
      const selected = workspace.id === params.currentWorkspaceId ? " selected" : "";
      return `<option value="${encodeHtml(workspace.id)}"${selected}>${encodeHtml(
        workspace.name,
      )}</option>`;
    })
    .join("");
  const workspaceList = params.workspaces
    .map((workspace) => {
      const activeSuffix = workspace.id === params.currentWorkspaceId ? " (current active)" : "";
      return `<li>${encodeHtml(workspace.name)}${activeSuffix}</li>`;
    })
    .join("");
  const workspaceCheckboxes = params.workspaces
    .map((workspace) => {
      const checked = !allowAllWorkspaces && selectedWorkspaceIds.includes(workspace.id) ? " checked" : "";
      const activeSuffix =
        workspace.id === params.currentWorkspaceId
          ? " <span class=\"muted\">(current active)</span>"
          : "";
      return `<label class="workspace-option"><input type="checkbox" name="workspace_ids" value="${encodeHtml(
        workspace.id,
      )}"${checked} /> <span>${encodeHtml(workspace.name)}${activeSuffix}</span></label>`;
    })
    .join("");

  const scopeList = params.scopes.map((scope) => `<li>${encodeHtml(scope)}</li>`).join("");

  const hiddenFields = [
    ["response_type", "code"],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["resource", params.resource],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", params.scopes.join(" ")],
    ["state", params.state ?? ""],
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${encodeHtml(name)}" value="${encodeHtml(value)}" />`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Authorize Bap MCP access</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f8f7f3; color: #111827; margin: 0; padding: 32px 16px; }
      .card { max-width: 640px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; border-radius: 18px; padding: 28px; box-shadow: 0 20px 50px rgba(17,24,39,0.08); }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { margin: 0 0 16px; line-height: 1.5; }
      .muted { color: #6b7280; }
      .section { margin-top: 20px; }
      .label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
      select { width: 100%; border: 1px solid #d1d5db; border-radius: 12px; padding: 12px 14px; font-size: 14px; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      .workspace-access { display: grid; gap: 12px; }
      .workspace-option { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 12px; }
      .workspace-option input { margin: 0; }
      .workspace-selection-panel { margin-top: 12px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb; }
      .workspace-selection-panel[hidden] { display: none; }
      .actions { display: flex; gap: 12px; margin-top: 24px; }
      button { border-radius: 12px; border: 1px solid #111827; padding: 12px 16px; font-size: 14px; cursor: pointer; }
      button[value="deny"] { background: white; color: #111827; }
      button[value="approve"] { background: #111827; color: white; }
      .meta { padding: 14px 16px; background: #f9fafb; border-radius: 14px; border: 1px solid #e5e7eb; }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="muted">Bap MCP OAuth</p>
      <h1>Authorize access</h1>
      <p><strong>${encodeHtml(params.clientName)}</strong> wants to connect to <strong>${encodeHtml(
        params.resourceName,
      )}</strong> as your Bap user.</p>

      <div class="meta">
        <p><strong>Client ID</strong><br />${encodeHtml(params.clientId)}</p>
        <p><strong>Redirect URI</strong><br />${encodeHtml(params.redirectUri)}</p>
      </div>

      <form method="post" action="${encodeHtml(AUTHORIZATION_ENDPOINT_PATH)}">
        ${hiddenFields}
        ${
          isBapAudience
            ? `<div class="section">
          <span class="label">Workspace access</span>
          <p class="muted">Choose whether this Bap MCP authorization covers all your current and future member workspaces, or only a selected subset.</p>
          <div class="workspace-access">
            <label class="workspace-option"><input type="radio" name="workspace_access_mode" value="all"${
              allowAllWorkspaces ? " checked" : ""
            } /> <span>All current and future member workspaces</span></label>
            <label class="workspace-option"><input type="radio" name="workspace_access_mode" value="selected"${
              allowAllWorkspaces ? "" : " checked"
            } /> <span>Only these selected workspaces</span></label>
          </div>
          <div id="workspace-selection-panel" class="workspace-selection-panel"${
            allowAllWorkspaces ? " hidden" : ""
          }>
            <span class="label">Select workspaces</span>
            <p class="muted">Choose the current member workspaces this MCP client can access.</p>
            ${workspaceCheckboxes}
          </div>
          <div class="section">
            <span class="label">Current member workspaces</span>
            <ul>${workspaceList}</ul>
          </div>
        </div>`
            : `<div class="section">
          <label class="label" for="workspace_id">Workspace</label>
          <select id="workspace_id" name="workspace_id" required>${workspaceOptions}</select>
        </div>`
        }
        <div class="section">
          <span class="label">Requested scopes</span>
          <ul>${scopeList}</ul>
        </div>
        <div class="actions">
          <button type="submit" name="decision" value="deny">Deny</button>
          <button type="submit" name="decision" value="approve">Approve</button>
        </div>
      </form>
    </div>
    ${
      isBapAudience
        ? `<script>
      const allRadio = document.querySelector('input[name="workspace_access_mode"][value="all"]');
      const selectedRadio = document.querySelector('input[name="workspace_access_mode"][value="selected"]');
      const selectionPanel = document.getElementById("workspace-selection-panel");
      const workspaceCheckboxInputs = Array.from(document.querySelectorAll('input[name="workspace_ids"]'));

      function syncWorkspaceSelectionMode() {
        const selectedMode = selectedRadio instanceof HTMLInputElement && selectedRadio.checked;
        if (selectionPanel) {
          selectionPanel.hidden = !selectedMode;
        }
        for (const input of workspaceCheckboxInputs) {
          if (!(input instanceof HTMLInputElement)) continue;
          input.disabled = !selectedMode;
        }
      }

      allRadio?.addEventListener("change", syncWorkspaceSelectionMode);
      selectedRadio?.addEventListener("change", syncWorkspaceSelectionMode);
      syncWorkspaceSelectionMode();
    </script>`
        : ""
    }
  </body>
</html>`;
}
