import { getOAuthConfig, type IntegrationType } from "@cmdclaw/core/server/oauth/config";
import { db } from "@cmdclaw/db/client";
import { integration } from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import { buildRequestAwareUrl, getRequestAwareOrigin } from "@/lib/request-aware-url";
import { assertCloudControlPlaneEnabled, requireCloudSession } from "@/server/control-plane/auth";
import { assertValidInstanceApiKey } from "@/server/control-plane/auth";
import { generateLinkedInAuthUrl } from "@/server/integrations/unipile";
import { redirectResponse } from "./redirect";

/**
 * Framework-neutral control-plane integration handlers (Request -> Response). `connect` is a
 * browser-facing OAuth start (cloud session guard + provider redirect with `state`); the
 * instance-key handlers (`status`/`toggle`/`disconnect`) are called by self-host instances.
 * Route adapters under `src/routes/api/control-plane/integrations/**` delegate here. No
 * `next/*` imports. API authorization stays inside these handlers.
 */

const SUPPORTED_TYPES = new Set<IntegrationType>([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

function createState(payload: Record<string, string | undefined>) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** GET /api/control-plane/integrations/connect */
export async function connectHandler(request: Request): Promise<Response> {
  try {
    assertCloudControlPlaneEnabled();
    const sessionData = await requireCloudSession(request);
    if (!sessionData?.user?.id) {
      const url = new URL(request.url);
      const loginUrl = buildRequestAwareUrl("/login", request);
      loginUrl.searchParams.set("callbackUrl", url.pathname + url.search);
      return redirectResponse(loginUrl);
    }

    const url = new URL(request.url);
    const type = url.searchParams.get("type") as IntegrationType | null;
    if (!type || !SUPPORTED_TYPES.has(type)) {
      return Response.json({ message: "Unsupported integration type" }, { status: 400 });
    }

    const redirectUrl = new URL("/toolbox", getRequestAwareOrigin(request)).toString();
    if (type === "linkedin") {
      const authUrl = await generateLinkedInAuthUrl(sessionData.user.id, redirectUrl);
      return redirectResponse(authUrl);
    }

    const config = getOAuthConfig(type);
    const state = createState({
      userId: sessionData.user.id,
      type,
      redirectUrl,
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
    });

    if (type === "slack") {
      params.set("user_scope", config.scopes.join(" "));
    } else {
      params.set("scope", config.scopes.join(" "));
    }

    if (
      type === "google_gmail" ||
      type === "google_calendar" ||
      type === "google_docs" ||
      type === "google_sheets" ||
      type === "google_drive"
    ) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (type === "outlook" || type === "outlook_calendar") {
      params.set("prompt", "select_account");
    }

    if (type === "notion") {
      params.set("owner", "user");
    }

    if (type === "reddit") {
      params.set("duration", "permanent");
    }

    return redirectResponse(`${config.authUrl}?${params}`);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Failed to start integration connect" },
      { status: 500 },
    );
  }
}

/** POST /api/control-plane/integrations/status */
export async function statusHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as { cloudUserId?: string };
    if (!body.cloudUserId) {
      return Response.json({ message: "Missing cloudUserId" }, { status: 400 });
    }

    const integrations = await db.query.integration.findMany({
      where: eq(integration.userId, body.cloudUserId),
    });

    return Response.json(
      integrations.map((item) => {
        const metadata =
          typeof item.metadata === "object" && item.metadata !== null
            ? (item.metadata as Record<string, unknown>)
            : null;

        return {
          id: item.id,
          type: item.type,
          displayName: item.displayName ?? null,
          enabled: item.enabled,
          setupRequired: item.type === "dynamics" && metadata?.pendingInstanceSelection === true,
          instanceName:
            item.type === "dynamics" && typeof metadata?.instanceName === "string"
              ? metadata.instanceName
              : null,
          instanceUrl:
            item.type === "dynamics" && typeof metadata?.instanceUrl === "string"
              ? metadata.instanceUrl
              : null,
          authStatus: item.authStatus,
          authErrorCode: item.authErrorCode ?? null,
          scopes: item.scopes ?? null,
          createdAt: item.createdAt.toISOString(),
        };
      }),
    );
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/control-plane/integrations/toggle */
export async function toggleHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as {
      cloudUserId?: string;
      integrationId?: string;
      enabled?: boolean;
    };
    if (!body.cloudUserId || !body.integrationId || typeof body.enabled !== "boolean") {
      return Response.json(
        { message: "Missing cloudUserId, integrationId, or enabled" },
        { status: 400 },
      );
    }

    await db
      .update(integration)
      .set({ enabled: body.enabled })
      .where(and(eq(integration.userId, body.cloudUserId), eq(integration.id, body.integrationId)));

    return Response.json({ success: true as const });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/control-plane/integrations/disconnect */
export async function disconnectHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as {
      cloudUserId?: string;
      integrationId?: string;
    };
    if (!body.cloudUserId || !body.integrationId) {
      return Response.json({ message: "Missing cloudUserId or integrationId" }, { status: 400 });
    }

    await db
      .delete(integration)
      .where(and(eq(integration.userId, body.cloudUserId), eq(integration.id, body.integrationId)));

    return Response.json({ success: true as const });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
