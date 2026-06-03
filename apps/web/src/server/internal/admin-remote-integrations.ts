import {
  getLocalRemoteIntegrationCredentials,
  listLocalRemoteIntegrationUsers,
  remoteIntegrationCredentialsResponseSchema,
  remoteIntegrationTypeSchema,
  remoteIntegrationUserSummarySchema,
} from "@cmdclaw/core/server/integrations/remote-integrations";
import { z } from "zod";
import { isAuthorizedByServerSecret } from "@/server/internal/server-secret";

const credentialsRequestSchema = z.object({
  remoteUserId: z.string().min(1),
  integrationTypes: z.array(remoteIntegrationTypeSchema).default([]),
  requestedByUserId: z.string().min(1).optional(),
  requestedByEmail: z.string().email().nullable().optional(),
});

const usersRequestSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(25).optional(),
});

/** POST /api/internal/admin/remote-integrations/credentials */
export async function handleRemoteIntegrationCredentials(request: Request): Promise<Response> {
  if (!isAuthorizedByServerSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = credentialsRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const credentials = await getLocalRemoteIntegrationCredentials({
      remoteUserId: parsed.data.remoteUserId,
      integrationTypes: parsed.data.integrationTypes,
    });

    console.info("[Internal] remote integration credentials issued", {
      targetUserId: credentials.remoteUserId,
      targetUserEmail: credentials.remoteUserEmail,
      requestedByUserId: parsed.data.requestedByUserId ?? null,
      requestedByEmail: parsed.data.requestedByEmail ?? null,
      enabledIntegrations: credentials.enabledIntegrations,
    });

    return Response.json(remoteIntegrationCredentialsResponseSchema.parse(credentials));
  } catch (error) {
    if (error instanceof Error && error.message === "Remote integration user not found") {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("[Internal] remote integration credential fetch error:", error);
    return Response.json(
      { error: "Failed to fetch remote integration credentials" },
      { status: 500 },
    );
  }
}

/** POST /api/internal/admin/remote-integrations/users */
export async function handleRemoteIntegrationUsers(request: Request): Promise<Response> {
  if (!isAuthorizedByServerSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = usersRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const users = await listLocalRemoteIntegrationUsers(parsed.data);
    return Response.json({
      users: users.map((entry) => remoteIntegrationUserSummarySchema.parse(entry)),
    });
  } catch (error) {
    console.error("[Internal] remote integration user search error:", error);
    return Response.json({ error: "Failed to search remote integration users" }, { status: 500 });
  }
}
