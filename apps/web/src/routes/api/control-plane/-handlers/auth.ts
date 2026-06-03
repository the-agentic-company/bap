import {
  exchangeCloudAuth,
  isControlPlaneEnabled,
} from "@cmdclaw/core/server/control-plane/client";
import { consumeControlPlaneAuthState } from "@cmdclaw/core/server/control-plane/local-auth";
import { db } from "@cmdclaw/db/client";
import { controlPlaneAuthRequest, user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { INVITE_ONLY_LOGIN_ERROR } from "@/lib/admin-emails";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";
import {
  assertCloudControlPlaneEnabled,
  assertValidInstanceApiKey,
  getValidAuthRequest,
  requireCloudSession,
} from "@/server/control-plane/auth";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";
import {
  createLocalSessionRedirectResponse,
  resolveOrCreateLocalUserFromCloudIdentity,
} from "@/server/control-plane/selfhost-auth";
import { env } from "@/env";
import { redirectResponse } from "./redirect";

/**
 * Framework-neutral control-plane auth handlers (Request -> Response). These power the
 * frozen OAuth-style cloud login flow between self-host instances and the cloud control
 * plane. Route files under `src/routes/api/control-plane/auth/**` are thin adapters that
 * delegate here. No `next/*` imports: redirects use the standard 307 helper, JSON uses
 * `Response.json`. API authorization stays inside these handlers.
 */

/** GET /api/control-plane/auth/authorize */
export async function authorizeHandler(request: Request): Promise<Response> {
  try {
    assertCloudControlPlaneEnabled();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) {
      return Response.json({ message: "Missing code" }, { status: 400 });
    }

    const pending = await getValidAuthRequest(code);
    if (!pending) {
      return Response.json({ message: "Invalid or expired code" }, { status: 400 });
    }

    const sessionData = await requireCloudSession(request);
    if (!sessionData?.user?.id) {
      const loginUrl = buildRequestAwareUrl("/login", request);
      loginUrl.searchParams.set("callbackUrl", url.pathname + url.search);
      return redirectResponse(loginUrl);
    }

    await db
      .update(controlPlaneAuthRequest)
      .set({
        completedByUserId: sessionData.user.id,
      })
      .where(eq(controlPlaneAuthRequest.code, code));

    const redirectUrl = new URL(pending.returnUrl);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", pending.localState);
    return redirectResponse(redirectUrl);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Failed to authorize login" },
      { status: 500 },
    );
  }
}

function redirectToLogin(requestUrl: string, callbackUrl: string, error: string): Response {
  const loginUrl = buildRequestAwareUrl("/login", requestUrl);
  loginUrl.searchParams.set("callbackUrl", callbackUrl);
  loginUrl.searchParams.set("error", error);
  return redirectResponse(loginUrl);
}

function redirectToInviteOnly(requestUrl: string, email?: string): Response {
  const inviteOnlyUrl = buildRequestAwareUrl("/invite-only", requestUrl);
  inviteOnlyUrl.searchParams.set("source", "selfhost-cloud-login");
  if (email) {
    inviteOnlyUrl.searchParams.set("email", email);
  }
  return redirectResponse(inviteOnlyUrl);
}

/** GET /api/control-plane/auth/callback */
export async function callbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!isControlPlaneEnabled()) {
    return redirectToLogin(request.url, "/chat", "cloud_auth_not_available");
  }

  if (!code || !state) {
    return redirectToLogin(request.url, "/chat", "missing_params");
  }

  const authState = await consumeControlPlaneAuthState(state);
  if (!authState) {
    return redirectToLogin(request.url, "/chat", "invalid_state");
  }

  const callbackUrl = sanitizeReturnPath(authState.returnPath, "/chat");
  let exchangedIdentityEmail: string | undefined;

  try {
    const identity = await exchangeCloudAuth(code);
    exchangedIdentityEmail = identity.email;
    const userId = await resolveOrCreateLocalUserFromCloudIdentity(identity);
    const redirectUrl = buildRequestAwareUrl(callbackUrl, request);
    return createLocalSessionRedirectResponse({
      userId,
      redirectUrl,
      requestUrl: request.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete cloud login";
    if (message === INVITE_ONLY_LOGIN_ERROR) {
      return redirectToInviteOnly(request.url, exchangedIdentityEmail);
    }
    const errorKey =
      message === "Cloud control plane is not configured"
        ? "cloud_auth_not_configured"
        : message.includes("Invalid or incomplete code") || message.includes("Invalid")
          ? "invalid_code"
          : message.includes("different cloud account")
            ? "account_conflict"
            : "cloud_auth_unavailable";
    return redirectToLogin(request.url, callbackUrl, errorKey);
  }
}

/** POST /api/control-plane/auth/exchange */
export async function exchangeHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as { code?: string };
    if (!body.code) {
      return Response.json({ message: "Missing code" }, { status: 400 });
    }

    const pending = await getValidAuthRequest(body.code);
    if (!pending?.completedByUserId || pending.completedAt) {
      return Response.json({ message: "Invalid or incomplete code" }, { status: 400 });
    }

    const cloudUser = await db.query.user.findFirst({
      where: eq(user.id, pending.completedByUserId),
      columns: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    if (!cloudUser) {
      return Response.json({ message: "Cloud user not found" }, { status: 404 });
    }

    await db
      .update(controlPlaneAuthRequest)
      .set({
        completedAt: new Date(),
      })
      .where(eq(controlPlaneAuthRequest.code, body.code));

    return Response.json({
      cloudUserId: cloudUser.id,
      email: cloudUser.email,
      name: cloudUser.name,
      image: cloudUser.image,
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/control-plane/auth/start */
export async function startHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as {
      localState?: string;
      returnUrl?: string;
      returnPath?: string | null;
    };

    if (!body.localState || !body.returnUrl) {
      return Response.json({ message: "Missing localState or returnUrl" }, { status: 400 });
    }

    const code = crypto.randomUUID();
    await db.insert(controlPlaneAuthRequest).values({
      code,
      localState: body.localState,
      returnUrl: body.returnUrl,
      returnPath: body.returnPath ?? null,
    });

    const appUrl = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return Response.json({ message: "APP_URL is not configured" }, { status: 500 });
    }

    return Response.json({
      authorizeUrl: `${appUrl}/api/control-plane/auth/authorize?code=${encodeURIComponent(code)}`,
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
