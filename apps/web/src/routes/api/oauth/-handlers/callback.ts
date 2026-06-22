import { exchangeMcpOAuthAuthorizationCode } from "@bap/core/server/executor/mcp-oauth";
import {
  computeWorkspaceMcpServerRevisionHash,
  setWorkspaceMcpServerOAuthCredential,
} from "@bap/core/server/executor/workspace-sources";
import { assignConnectedIdentityForProviderAccount } from "@bap/core/server/integrations/connected-identities";
import { getOAuthConfig, type IntegrationType } from "@bap/core/server/oauth/config";
import { generationManager } from "@bap/core/server/services/generation-manager";
import { db } from "@bap/db/client";
import {
  integration,
  integrationToken,
  workspaceMcpServer,
  workspaceMcpAuthorization,
} from "@bap/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { buildRequestAwareUrl, getRequestAwareOrigin } from "@/lib/request-aware-url";
import { consumeWorkspaceMcpServerOAuthPending } from "@/server/executor-source-oauth";
import { fetchDynamicsInstances } from "@/server/integrations/dynamics";

/**
 * Framework-neutral handler for `GET /api/oauth/callback`.
 *
 * This is the frozen provider OAuth callback URL: provider dashboards point at
 * this exact path, so the public URL contract must not change. The handler uses
 * only standard `Request`/`Response`/`URL` so the TanStack Start route file stays
 * a thin adapter and the logic stays testable without the framework. API
 * authorization (the Better Auth session check + state user matching) lives
 * here, not in any page route guard.
 *
 * The previous handler emitted `standard redirect`, which is a **307**
 * (method-preserving) redirect. We preserve that exact status with a plain Web
 * `Response` so the observable redirect contract is unchanged.
 */

function oauthRedirect(url: URL): Response {
  return new Response(null, {
    status: 307,
    headers: { location: url.toString() },
  });
}

function buildWorkspaceMcpServerRedirectUrl(raw: string, request: Request): URL {
  try {
    return new URL(raw);
  } catch {
    return buildRequestAwareUrl(raw, request);
  }
}

function appendWorkspaceMcpServerRedirectParam(redirectUrl: URL, key: string, value: string) {
  redirectUrl.searchParams.set(key, value);
  return redirectUrl;
}

export async function handleOAuthCallback(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    if (state) {
      const executorPending = await consumeWorkspaceMcpServerOAuthPending(state).catch(
        () => undefined,
      );
      if (executorPending) {
        const redirectUrl = buildWorkspaceMcpServerRedirectUrl(
          executorPending.redirectUrl,
          request,
        );
        appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth", "error");
        appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth_error", error);
        return oauthRedirect(redirectUrl);
      }
    }

    console.error("OAuth error:", error);
    return oauthRedirect(buildRequestAwareUrl(`/toolbox?error=${error}`, request));
  }

  if (!code || !state) {
    return oauthRedirect(buildRequestAwareUrl("/toolbox?error=missing_params", request));
  }

  // Get session
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.user) {
    return oauthRedirect(buildRequestAwareUrl("/login?error=unauthorized", request));
  }

  const executorPending = state ? await consumeWorkspaceMcpServerOAuthPending(state) : undefined;
  if (executorPending) {
    const redirectUrl = buildWorkspaceMcpServerRedirectUrl(executorPending.redirectUrl, request);

    if (executorPending.userId !== sessionData.user.id) {
      appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth", "error");
      appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth_error", "user_mismatch");
      return oauthRedirect(redirectUrl);
    }

    try {
      const source = await db.query.workspaceMcpServer.findFirst({
        where: eq(workspaceMcpServer.id, executorPending.workspaceMcpServerId),
      });

      if (!source || source.kind !== "mcp" || source.authType !== "oauth2") {
        appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth", "error");
        appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth_error", "invalid_source");
        return oauthRedirect(redirectUrl);
      }

      const credential = await exchangeMcpOAuthAuthorizationCode({
        session: executorPending.session,
        code,
      });

      const existingCredential = await db.query.workspaceMcpAuthorization.findFirst({
        where: and(
          eq(workspaceMcpAuthorization.userId, sessionData.user.id),
          eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
        ),
      });

      await setWorkspaceMcpServerOAuthCredential({
        database: db,
        workspaceMcpServerId: source.id,
        userId: sessionData.user.id,
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        expiresAt: credential.expiresAt,
        oauthMetadata: credential.metadata,
        displayName: existingCredential?.displayName ?? null,
        enabled: existingCredential?.enabled ?? true,
      });
      await db
        .update(workspaceMcpServer)
        .set({
          revisionHash: computeWorkspaceMcpServerRevisionHash({
            kind: source.kind,
            name: source.name,
            namespace: source.namespace,
            endpoint: source.endpoint,
            specUrl: source.specUrl,
            transport: source.transport,
            headers: source.headers,
            queryParams: source.queryParams,
            defaultHeaders: source.defaultHeaders,
            authType: source.authType,
            authHeaderName: source.authHeaderName,
            authQueryParam: source.authQueryParam,
            authPrefix: source.authPrefix,
            enabled: source.enabled,
          }),
          updatedAt: new Date(),
        })
        .where(eq(workspaceMcpServer.id, source.id));

      appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth", "success");
      return oauthRedirect(redirectUrl);
    } catch (callbackError) {
      console.error("Executor source OAuth callback error:", callbackError);
      appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth", "error");
      appendWorkspaceMcpServerRedirectParam(redirectUrl, "oauth_error", "callback_failed");
      return oauthRedirect(redirectUrl);
    }
  }

  // Parse state
  let stateData: {
    userId: string;
    type: IntegrationType;
    redirectUrl: string;
    codeVerifier?: string;
    dynamicsInstanceUrl?: string;
    dynamicsInstanceName?: string;
    accountLabel?: string;
    connectedAccountId?: string;
    mode?: "connect" | "connect_to_label" | "reauth";
  };

  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return oauthRedirect(buildRequestAwareUrl("/toolbox?error=invalid_state", request));
  }

  // Helper to build redirect URL with the correct base path
  const buildRedirectUrl = (params: string) => {
    const baseUrl = stateData.redirectUrl || "/toolbox";
    const redirectUrl = buildRequestAwareUrl(baseUrl, request);
    const extraParams = new URLSearchParams(params);
    for (const [key, value] of extraParams.entries()) {
      redirectUrl.searchParams.set(key, value);
    }
    return redirectUrl;
  };

  const resolveAuthResumeContext = (): {
    generationId?: string;
    interruptId?: string;
    integration?: string;
  } => {
    try {
      const redirectUrl = buildRequestAwareUrl(stateData.redirectUrl, request);
      return {
        generationId: redirectUrl.searchParams.get("generation_id") ?? undefined,
        interruptId: redirectUrl.searchParams.get("interrupt_id") ?? undefined,
        integration: redirectUrl.searchParams.get("auth_complete") ?? undefined,
      };
    } catch {
      return {};
    }
  };

  // Verify user matches
  if (stateData.userId !== sessionData.user.id) {
    return oauthRedirect(buildRedirectUrl("error=user_mismatch"));
  }

  try {
    const config = getOAuthConfig(stateData.type);
    const normalizedDynamicsInstanceUrl =
      typeof stateData.dynamicsInstanceUrl === "string"
        ? stateData.dynamicsInstanceUrl.trim().replace(/\/+$/, "")
        : "";
    const isDynamicsInstanceScopedAuth =
      stateData.type === "dynamics" && normalizedDynamicsInstanceUrl.length > 0;
    const integrationScopes =
      isDynamicsInstanceScopedAuth && stateData.type === "dynamics"
        ? [
            "offline_access",
            "openid",
            "profile",
            "email",
            `${normalizedDynamicsInstanceUrl}/user_impersonation`,
          ]
        : config.scopes;

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Notion and Airtable require Basic auth header
    if (stateData.type === "notion" || stateData.type === "airtable") {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`;
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_id");
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_secret");
    }

    // Airtable and Salesforce require code_verifier for PKCE
    if (stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    // GitHub needs Accept header
    if (stateData.type === "github") {
      headers["Accept"] = "application/json";
    }

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      return oauthRedirect(buildRedirectUrl("error=token_exchange_failed"));
    }

    const tokens = await tokenResponse.json();

    // Handle different token response formats
    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number | undefined;

    if (stateData.type === "slack") {
      // Slack user tokens are in authed_user object
      accessToken = tokens.authed_user?.access_token;
      refreshToken = tokens.authed_user?.refresh_token;
      // Slack user tokens don't expire by default
    } else {
      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      expiresIn = tokens.expires_in;
    }

    if (!accessToken) {
      console.error("No access token in response:", tokens);
      return oauthRedirect(buildRedirectUrl("error=no_access_token"));
    }

    // Get user info from provider
    const userInfo = await config.getUserInfo(accessToken);

    // Salesforce: capture instance_url from token response
    if (stateData.type === "salesforce" && tokens.instance_url) {
      userInfo.metadata = {
        ...userInfo.metadata,
        instanceUrl: tokens.instance_url,
      };
    }

    // Dynamics: require environment selection before enabling integration
    if (stateData.type === "dynamics") {
      if (isDynamicsInstanceScopedAuth) {
        userInfo.metadata = {
          ...userInfo.metadata,
          pendingInstanceSelection: false,
          pendingInstanceReauth: false,
          availableInstances: [],
          instanceUrl: normalizedDynamicsInstanceUrl,
          instanceName: stateData.dynamicsInstanceName ?? normalizedDynamicsInstanceUrl,
        };
      } else {
        const instances = await fetchDynamicsInstances(accessToken);
        if (instances.length === 0) {
          return oauthRedirect(buildRedirectUrl("error=dynamics_no_environments"));
        }
        userInfo.metadata = {
          ...userInfo.metadata,
          pendingInstanceSelection: true,
          pendingInstanceReauth: false,
          availableInstances: instances,
        };
      }
    }

    const assignment = await assignConnectedIdentityForProviderAccount(db, {
      userId: sessionData.user.id,
      integrationType: stateData.type,
      providerAccountId: userInfo.id,
      displayName: userInfo.displayName,
      metadata: userInfo.metadata,
      requestedAccountLabel: stateData.accountLabel,
    });
    const explicitReauthIntegration =
      stateData.connectedAccountId && stateData.mode === "reauth"
        ? await db.query.integration.findFirst({
            where: and(
              eq(integration.id, stateData.connectedAccountId),
              eq(integration.userId, sessionData.user.id),
              eq(integration.type, stateData.type),
            ),
          })
        : null;

    if (
      explicitReauthIntegration?.providerAccountId &&
      explicitReauthIntegration.providerAccountId !== userInfo.id
    ) {
      return oauthRedirect(buildRedirectUrl("error=account_provider_identity_mismatch"));
    }

    const existingIntegration =
      explicitReauthIntegration ??
      (await db.query.integration.findFirst({
        where: and(
          eq(integration.userId, sessionData.user.id),
          eq(integration.type, stateData.type),
          eq(integration.providerAccountId, userInfo.id),
        ),
      }));

    let integId: string;

    if (existingIntegration) {
      await db
        .update(integration)
        .set({
          providerAccountId: userInfo.id,
          connectedIdentityId: assignment.connectedIdentityId,
          displayName: userInfo.displayName,
          scopes: integrationScopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics" || isDynamicsInstanceScopedAuth,
        })
        .where(eq(integration.id, existingIntegration.id));
      integId = existingIntegration.id;
    } else {
      const [newInteg] = await db
        .insert(integration)
        .values({
          userId: sessionData.user.id,
          type: stateData.type,
          connectedIdentityId: assignment.connectedIdentityId,
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          scopes: integrationScopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics" || isDynamicsInstanceScopedAuth,
        })
        .returning();
      integId = newInteg.id;
    }

    // Delete old tokens and store new ones
    await db.delete(integrationToken).where(eq(integrationToken.integrationId, integId));

    await db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      idToken: tokens.id_token,
    });

    if (stateData.type === "dynamics" && !isDynamicsInstanceScopedAuth) {
      const dynamicsRedirect = new URL("/toolbox", getRequestAwareOrigin(request));
      dynamicsRedirect.searchParams.set("dynamics_select", "true");
      const authResume = resolveAuthResumeContext();
      if (authResume.interruptId) {
        dynamicsRedirect.searchParams.set("interrupt_id", authResume.interruptId);
      }
      if (authResume.generationId) {
        dynamicsRedirect.searchParams.set("generation_id", authResume.generationId);
      }
      if (authResume.integration) {
        dynamicsRedirect.searchParams.set("auth_complete", authResume.integration);
      }
      return oauthRedirect(dynamicsRedirect);
    }

    const authResume = resolveAuthResumeContext();
    if (authResume.interruptId) {
      try {
        await generationManager.submitAuthResultByInterrupt(
          authResume.interruptId,
          authResume.integration ?? stateData.type,
          true,
          sessionData.user.id,
        );
      } catch (resumeError) {
        console.warn("[OAuth callback] Failed to auto-submit auth result:", resumeError);
      }
    } else if (authResume.generationId) {
      try {
        await generationManager.submitAuthResult(
          authResume.generationId,
          authResume.integration ?? stateData.type,
          true,
          sessionData.user.id,
        );
      } catch (resumeError) {
        console.warn("[OAuth callback] Failed to auto-submit auth result:", resumeError);
      }
    }

    return oauthRedirect(buildRedirectUrl("success=true"));
  } catch (error) {
    console.error("OAuth callback error:", error);
    return oauthRedirect(buildRedirectUrl("error=callback_failed"));
  }
}
