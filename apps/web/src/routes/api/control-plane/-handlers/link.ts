import {
  exchangeCloudAccountLink,
  getCloudManagedIntegrationConnectUrl,
} from "@cmdclaw/core/server/control-plane/client";
import {
  consumeCloudAccountLinkState,
  upsertCloudAccountLinkForUser,
} from "@cmdclaw/core/server/control-plane/local-links";
import { db } from "@cmdclaw/db/client";
import { controlPlaneLinkRequest } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";
import {
  assertCloudControlPlaneEnabled,
  assertValidInstanceApiKey,
  getValidLinkRequest,
  requireCloudSession,
} from "@/server/control-plane/auth";
import { env } from "@/env";
import { redirectResponse } from "./redirect";

/**
 * Framework-neutral control-plane account-link handlers (Request -> Response). These power
 * the frozen cloud-account-link flow (start/authorize/callback/exchange). Route adapters
 * under `src/routes/api/control-plane/link/**` delegate here. No `next/*` imports; redirects
 * preserve the 307 contract. API authorization stays inside these handlers.
 */

/** GET /api/control-plane/link/authorize */
export async function authorizeHandler(request: Request): Promise<Response> {
  try {
    assertCloudControlPlaneEnabled();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) {
      return Response.json({ message: "Missing code" }, { status: 400 });
    }

    const pending = await getValidLinkRequest(code);
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
      .update(controlPlaneLinkRequest)
      .set({
        completedByUserId: sessionData.user.id,
      })
      .where(eq(controlPlaneLinkRequest.code, code));

    const redirectUrl = new URL(pending.returnUrl);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", pending.localState);
    return redirectResponse(redirectUrl);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Failed to authorize link" },
      { status: 500 },
    );
  }
}

/** GET /api/control-plane/link/callback */
export async function callbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return Response.json({ message: "Missing code or state" }, { status: 400 });
  }

  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.user?.id) {
    const loginUrl = buildRequestAwareUrl("/login", request);
    loginUrl.searchParams.set("callbackUrl", url.pathname + url.search);
    return redirectResponse(loginUrl);
  }

  const linkState = await consumeCloudAccountLinkState({
    state,
    userId: sessionData.user.id,
  });

  if (!linkState) {
    return Response.json({ message: "Invalid or expired link state" }, { status: 400 });
  }

  const cloudUserId = await exchangeCloudAccountLink(code);
  await upsertCloudAccountLinkForUser(sessionData.user.id, cloudUserId);

  if (linkState.requestedIntegrationType) {
    return redirectResponse(
      getCloudManagedIntegrationConnectUrl(linkState.requestedIntegrationType),
    );
  }

  const redirectUrl = buildRequestAwareUrl(linkState.returnPath || "/toolbox", request);
  redirectUrl.searchParams.set("cloudLinked", "1");
  return redirectResponse(redirectUrl);
}

/** POST /api/control-plane/link/exchange */
export async function exchangeHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as { code?: string };
    if (!body.code) {
      return Response.json({ message: "Missing code" }, { status: 400 });
    }

    const pending = await getValidLinkRequest(body.code);
    if (!pending?.completedByUserId || pending.completedAt) {
      return Response.json({ message: "Invalid or incomplete code" }, { status: 400 });
    }

    await db
      .update(controlPlaneLinkRequest)
      .set({
        completedAt: new Date(),
      })
      .where(eq(controlPlaneLinkRequest.code, body.code));

    return Response.json({
      cloudUserId: pending.completedByUserId,
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/control-plane/link/start */
export async function startHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as {
      localState?: string;
      returnUrl?: string;
      requestedIntegrationType?: string | null;
    };

    if (!body.localState || !body.returnUrl) {
      return Response.json({ message: "Missing localState or returnUrl" }, { status: 400 });
    }

    const code = crypto.randomUUID();
    await db.insert(controlPlaneLinkRequest).values({
      code,
      localState: body.localState,
      returnUrl: body.returnUrl,
      requestedIntegrationType: body.requestedIntegrationType ?? null,
    });

    const appUrl = env.APP_URL ?? env.VITE_APP_URL;
    if (!appUrl) {
      return Response.json({ message: "APP_URL is not configured" }, { status: 500 });
    }

    return Response.json({
      authorizeUrl: `${appUrl}/api/control-plane/link/authorize?code=${encodeURIComponent(code)}`,
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
