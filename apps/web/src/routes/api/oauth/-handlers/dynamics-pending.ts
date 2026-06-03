import { getOAuthConfig } from "@cmdclaw/core/server/oauth/config";
import { db } from "@cmdclaw/db/client";
import { integration } from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getRequestAwareOrigin } from "@/lib/request-aware-url";

/**
 * Framework-neutral handlers for `/api/oauth/dynamics/pending`.
 *
 * GET returns the pending Dynamics environment selection for the signed-in user;
 * POST completes the selection by kicking off an instance-scoped re-auth. Both
 * use only standard `Request`/`Response`/`Headers` and keep API authorization
 * (Better Auth session check) inside the handlers, so the TanStack Start route
 * file stays a thin adapter. JSON responses are not cached by callers; the
 * frozen behavior here is the JSON shape and the 401/404/400 status contract.
 */

type DynamicsInstance = {
  id: string;
  friendlyName: string;
  instanceUrl: string;
  apiUrl: string;
};

type DynamicsMetadata = {
  pendingInstanceSelection?: boolean;
  pendingInstanceReauth?: boolean;
  availableInstances?: DynamicsInstance[];
  instanceUrl?: string;
  instanceName?: string;
  [key: string]: unknown;
};

const completeSchema = z.object({
  instanceUrl: z.string().url(),
  generationId: z.string().optional(),
  interruptId: z.string().optional(),
  integration: z.string().optional(),
});

async function getAuthedUserId(headers: Headers): Promise<string | null> {
  const sessionData = await auth.api.getSession({ headers });
  return sessionData?.user?.id ?? null;
}

async function findPendingIntegration(userId: string) {
  return db.query.integration.findFirst({
    where: and(eq(integration.userId, userId), eq(integration.type, "dynamics")),
  });
}

function buildInstanceScope(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/+$/, "")}/user_impersonation`;
}

function getRedirectBaseUrl(request: Request): string {
  return getRequestAwareOrigin(request);
}

export async function handleDynamicsPendingGet(request: Request): Promise<Response> {
  const userId = await getAuthedUserId(request.headers);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dynamicsIntegration = await findPendingIntegration(userId);
  if (!dynamicsIntegration?.metadata) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = dynamicsIntegration.metadata as DynamicsMetadata;
  const instances = Array.isArray(metadata.availableInstances) ? metadata.availableInstances : [];

  if (!metadata.pendingInstanceSelection || instances.length === 0) {
    return Response.json({ error: "no_pending_selection" }, { status: 404 });
  }

  return Response.json({
    instances,
    displayName: dynamicsIntegration.displayName,
  });
}

export async function handleDynamicsPendingPost(request: Request): Promise<Response> {
  const userId = await getAuthedUserId(request.headers);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = completeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const dynamicsIntegration = await findPendingIntegration(userId);
  if (!dynamicsIntegration?.metadata) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = dynamicsIntegration.metadata as DynamicsMetadata;
  const instances = Array.isArray(metadata.availableInstances) ? metadata.availableInstances : [];

  if (!metadata.pendingInstanceSelection || instances.length === 0) {
    return Response.json({ error: "no_pending_selection" }, { status: 404 });
  }

  const selected = instances.find((instance) => instance.instanceUrl === parsed.data.instanceUrl);
  if (!selected) {
    return Response.json({ error: "invalid_instance" }, { status: 400 });
  }

  const config = getOAuthConfig("dynamics");
  const redirectUrl = new URL("/toolbox", getRedirectBaseUrl(request));
  if (parsed.data.generationId) {
    redirectUrl.searchParams.set("generation_id", parsed.data.generationId);
  }
  if (parsed.data.interruptId) {
    redirectUrl.searchParams.set("interrupt_id", parsed.data.interruptId);
  }
  if (parsed.data.integration) {
    redirectUrl.searchParams.set("auth_complete", parsed.data.integration);
  }

  const state = Buffer.from(
    JSON.stringify({
      userId,
      type: "dynamics",
      redirectUrl: redirectUrl.toString(),
      dynamicsInstanceUrl: selected.instanceUrl,
      dynamicsInstanceName: selected.friendlyName,
    }),
  ).toString("base64url");
  const authParams = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: [
      "offline_access",
      "openid",
      "profile",
      "email",
      buildInstanceScope(selected.instanceUrl),
    ].join(" "),
    state,
  });

  await db
    .update(integration)
    .set({
      enabled: false,
      metadata: {
        ...metadata,
        pendingInstanceSelection: false,
        pendingInstanceReauth: true,
        availableInstances: [],
        instanceUrl: selected.instanceUrl,
        instanceName: selected.friendlyName,
      },
    })
    .where(eq(integration.id, dynamicsIntegration.id));

  return Response.json({
    requiresReauth: true,
    authUrl: `${config.authUrl}?${authParams.toString()}`,
  });
}
