import { startCloudAuth } from "@cmdclaw/core/server/control-plane/client";
import { isSelfHostedEdition } from "@cmdclaw/core/server/edition";
import { auth } from "@/lib/auth";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";
import { getInstanceHealthStatus } from "@/server/instance/health";

/**
 * Framework-neutral HTTP handlers for the `/api/instance/**` URL area.
 *
 * These use only standard Request/Response/Headers so the TanStack Start
 * server route files stay thin adapters and the logic stays testable without
 * the framework. API authorization lives here in the handlers, not in any page
 * route guard.
 */

function buildLoginRedirect(
  requestUrl: string,
  callbackUrl: string,
  error: string,
): Response {
  const loginUrl = buildRequestAwareUrl("/login", requestUrl);
  loginUrl.searchParams.set("callbackUrl", callbackUrl);
  loginUrl.searchParams.set("error", error);
  return Response.redirect(loginUrl, 307);
}

/**
 * Self-host instance auth flow (start). Redirects a self-hosted operator to the
 * cloud control-plane authorize URL, or back to `/login` with an error key when
 * cloud auth is unavailable/misconfigured.
 */
export async function handleInstanceAuthStart(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const callbackUrl = sanitizeReturnPath(url.searchParams.get("callbackUrl"), "/chat");

  if (!isSelfHostedEdition()) {
    return buildLoginRedirect(request.url, callbackUrl, "cloud_auth_not_available");
  }

  try {
    const authorizeUrl = await startCloudAuth({ returnPath: callbackUrl });
    return Response.redirect(authorizeUrl, 307);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start cloud login";
    const errorKey =
      message === "Cloud control plane is not configured"
        ? "cloud_auth_not_configured"
        : "cloud_auth_unavailable";
    return buildLoginRedirect(request.url, callbackUrl, errorKey);
  }
}

/**
 * Instance health check. Requires an authenticated session; returns the full
 * instance health status with 200 when healthy and 503 when degraded.
 */
export async function handleInstanceHealth(request: Request): Promise<Response> {
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.user?.id) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const status = await getInstanceHealthStatus();
  return Response.json(status, { status: status.ok ? 200 : 503 });
}
