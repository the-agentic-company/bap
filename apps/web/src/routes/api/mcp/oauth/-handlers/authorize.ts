import { auth } from "@/lib/auth";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";
import {
  assertHostedMcpWorkspaceMembership,
  createHostedMcpAuthorizationCode,
  listHostedMcpConsentWorkspaces,
  parseHostedMcpAuthorizationRequest,
  renderHostedMcpConsentHtml,
} from "@/server/hosted-mcp-oauth";

/**
 * Framework-neutral handlers for the hosted MCP OAuth authorization endpoint
 * (`/api/mcp/oauth/authorize`). Authorization (Better Auth session) is enforced
 * inside the handlers; unauthenticated requests are redirected to login while
 * preserving the original target as the callback URL.
 */

function canonicalizeHostedMcpLoginHostname(hostname: string): string {
  for (const prefix of ["mcp.", "www."]) {
    if (!hostname.startsWith(prefix)) {
      continue;
    }

    const candidate = hostname.slice(prefix.length);
    if (candidate === "heybap.com" || candidate.endsWith(".heybap.com")) {
      return candidate;
    }
  }

  return hostname;
}

function buildLoginRedirect(request: Request): Response {
  const requestUrl = new URL(request.url);
  const callbackUrl = `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
  const loginUrl = buildRequestAwareUrl(
    `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    request,
  );
  loginUrl.hostname = canonicalizeHostedMcpLoginHostname(loginUrl.hostname);
  return Response.redirect(loginUrl, 303);
}

function buildErrorRedirect(
  redirectUri: string,
  params: { error: string; description: string; state?: string | null },
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", params.error);
  target.searchParams.set("error_description", params.description);
  if (params.state) {
    target.searchParams.set("state", params.state);
  }
  return Response.redirect(target, 303);
}

export async function handleHostedMcpAuthorizeGet(request: Request): Promise<Response> {
  try {
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData?.user?.id) {
      return buildLoginRedirect(request);
    }

    const parsed = await parseHostedMcpAuthorizationRequest(new URL(request.url).searchParams);
    const workspaces = await listHostedMcpConsentWorkspaces(sessionData.user.id);

    return new Response(
      renderHostedMcpConsentHtml({
        clientId: parsed.clientId,
        clientName: parsed.clientName,
        redirectUri: parsed.redirectUri,
        resource: parsed.resource,
        resourceName: parsed.resourceName,
        scopes: parsed.scopes,
        state: parsed.state,
        codeChallenge: parsed.codeChallenge,
        currentWorkspaceId:
          workspaces.find((workspace) => workspace.active)?.id ?? workspaces[0]?.id ?? null,
        workspaces,
      }),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: error instanceof Error ? error.message : "Invalid authorization request",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

export async function handleHostedMcpAuthorizePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const decision = String(formData.get("decision") ?? "").trim();

  try {
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData?.user?.id) {
      return buildLoginRedirect(request);
    }

    const parsed = await parseHostedMcpAuthorizationRequest(
      new URLSearchParams(
        Array.from(formData.entries()).map(([key, value]) => [key, String(value)]),
      ),
    );

    if (decision !== "approve") {
      return buildErrorRedirect(parsed.redirectUri, {
        error: "access_denied",
        description: "The user denied this authorization request.",
        state: parsed.state,
      });
    }

    const workspaceId = String(formData.get("workspace_id") ?? "").trim();
    if (!workspaceId) {
      return buildErrorRedirect(parsed.redirectUri, {
        error: "invalid_request",
        description: "workspace_id is required.",
        state: parsed.state,
      });
    }

    await assertHostedMcpWorkspaceMembership(sessionData.user.id, workspaceId);
    const code = await createHostedMcpAuthorizationCode({
      clientId: parsed.clientId,
      userId: sessionData.user.id,
      workspaceId,
      resource: parsed.resource,
      scopes: parsed.scopes,
      redirectUri: parsed.redirectUri,
      codeChallenge: parsed.codeChallenge,
    });

    const redirectUrl = new URL(parsed.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (parsed.state) {
      redirectUrl.searchParams.set("state", parsed.state);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const redirectUri = String(formData.get("redirect_uri") ?? "").trim();
    const state = String(formData.get("state") ?? "").trim() || null;
    if (redirectUri && URL.canParse(redirectUri)) {
      return buildErrorRedirect(redirectUri, {
        error: "invalid_request",
        description: error instanceof Error ? error.message : "Authorization failed",
        state,
      });
    }

    return Response.json(
      {
        error: "invalid_request",
        error_description: error instanceof Error ? error.message : "Authorization failed",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
