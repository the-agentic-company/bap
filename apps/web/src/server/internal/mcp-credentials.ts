import {
  getEnabledIntegrationTypes,
  getTokenEnvVarForIntegrationType,
  getTokensForIntegrations,
} from "@cmdclaw/core/server/integrations/cli-env";
import {
  ConnectedAccountResolutionError,
  resolveConnectedAccountCredential,
} from "@cmdclaw/core/server/integrations/connected-account-resolution";
import {
  getRemoteIntegrationCredentials,
  remoteIntegrationSourceSchema,
} from "@cmdclaw/core/server/integrations/remote-integrations";
import {
  getGalienCredentialForUser,
  getGalienWorkspaceAccessForUser,
} from "@cmdclaw/core/server/galien/service";
import {
  canUserUseModulrInWorkspace,
  getModulrWorkspaceConnection,
} from "@cmdclaw/core/server/modulr/service";
import { db } from "@cmdclaw/db/client";
import { user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { isAuthorizedByServerSecret } from "@/server/internal/server-secret";

/**
 * The MCP credential endpoints throw on an invalid server secret and convert that into a
 * 401 in their outer catch. Keeping the throw lets the existing control flow stay
 * identical to the pre-migration handlers.
 */
function assertValidServerSecret(request: Request): void {
  if (!isAuthorizedByServerSecret(request)) {
    throw new Error("Unauthorized");
  }
}

async function assertRemoteIntegrationSourceAdmin(source: {
  requestedByUserId?: string;
}): Promise<Response | null> {
  if (!source.requestedByUserId) {
    return Response.json({ message: "Missing remote integration actor" }, { status: 403 });
  }

  const actor = await db.query.user.findFirst({
    where: eq(user.id, source.requestedByUserId),
    columns: { role: true },
  });
  if (actor?.role !== "admin") {
    return Response.json({ message: "Admin access required" }, { status: 403 });
  }

  return null;
}

/** POST /api/internal/mcp/galien-credentials */
export async function handleGalienCredentials(request: Request): Promise<Response> {
  try {
    assertValidServerSecret(request);
    const body = (await request.json()) as {
      userId?: string;
      workspaceId?: string;
    };

    if (!body.userId || !body.workspaceId) {
      return Response.json({ message: "Missing userId or workspaceId" }, { status: 400 });
    }

    const access = await getGalienWorkspaceAccessForUser({
      userId: body.userId,
      workspaceId: body.workspaceId,
    });
    if (!access) {
      return Response.json({ message: "Galien is not enabled for this user." }, { status: 403 });
    }

    const credential = await getGalienCredentialForUser({
      userId: body.userId,
      targetEnv: access.targetEnv,
    });
    if (!credential) {
      return Response.json({ message: "Galien credentials are not connected." }, { status: 404 });
    }

    return Response.json({
      userId: body.userId,
      workspaceId: body.workspaceId,
      username: credential.username,
      password: credential.password,
      targetEnv: credential.targetEnv,
      apiBaseUrl: credential.apiBaseUrl,
      displayName: credential.displayName,
      galienUserId: credential.galienUserId,
      issuedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/internal/mcp/modulr-credentials */
export async function handleModulrCredentials(request: Request): Promise<Response> {
  try {
    assertValidServerSecret(request);
    const body = (await request.json()) as {
      userId?: string;
      workspaceId?: string;
    };

    if (!body.userId || !body.workspaceId) {
      return Response.json({ message: "Missing userId or workspaceId" }, { status: 400 });
    }

    const allowed = await canUserUseModulrInWorkspace({
      userId: body.userId,
      workspaceId: body.workspaceId,
    });
    if (!allowed) {
      return Response.json({ message: "Modulr is not enabled for this user." }, { status: 403 });
    }

    const connection = await getModulrWorkspaceConnection({
      workspaceId: body.workspaceId,
    });
    if (!connection) {
      return Response.json({ message: "Modulr credentials are not connected." }, { status: 404 });
    }

    return Response.json({
      userId: body.userId,
      workspaceId: body.workspaceId,
      ...connection,
      issuedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/internal/mcp/runtime-credentials */
export async function handleRuntimeCredentials(request: Request): Promise<Response> {
  try {
    assertValidServerSecret(request);
    const body = (await request.json()) as {
      userId?: string;
      workspaceId?: string;
      integrationTypes?: string[];
      resolve?: {
        integrationType?: string;
        accountLabel?: string | null;
        allowedIntegrationTypes?: string[];
      };
      remoteIntegrationSource?: unknown;
    };

    if (!body.userId) {
      return Response.json({ message: "Missing userId" }, { status: 400 });
    }

    const remoteIntegrationSourceResult = remoteIntegrationSourceSchema
      .optional()
      .safeParse(body.remoteIntegrationSource);
    if (!remoteIntegrationSourceResult.success) {
      return Response.json({ message: "Invalid remoteIntegrationSource" }, { status: 400 });
    }
    const remoteIntegrationSource = remoteIntegrationSourceResult.data;
    if (remoteIntegrationSource) {
      const forbidden = await assertRemoteIntegrationSourceAdmin(remoteIntegrationSource);
      if (forbidden) {
        return forbidden;
      }
    }

    if (body.resolve?.integrationType) {
      if (remoteIntegrationSource) {
        const integrationType = body.resolve.integrationType;
        const tokenEnvVar = getTokenEnvVarForIntegrationType(integrationType);
        if (!tokenEnvVar) {
          return Response.json(
            { message: `Remote credential resolution is not supported for ${integrationType}.` },
            { status: 400 },
          );
        }
        const credentials = await getRemoteIntegrationCredentials({
          targetEnv: remoteIntegrationSource.targetEnv,
          remoteUserId: remoteIntegrationSource.remoteUserId,
          integrationTypes: [integrationType as never],
          requestedByUserId: remoteIntegrationSource.requestedByUserId,
          requestedByEmail: remoteIntegrationSource.requestedByEmail ?? null,
        });
        const accessToken = credentials.tokens[tokenEnvVar];
        if (!accessToken) {
          return Response.json(
            {
              code: "auth_required",
              message: `No Connected Account is available for ${integrationType}.`,
              availableAccountLabels: [],
            },
            { status: 409 },
          );
        }
        return Response.json({
          credential: {
            integrationType,
            accessToken,
            connectedAccountId: remoteIntegrationSource.remoteUserId,
            connectedIdentityId: null,
            accountLabel: null,
            displayName: credentials.remoteUserName,
            metadata: {
              remoteUserEmail: credentials.remoteUserEmail,
              remoteTargetEnv: remoteIntegrationSource.targetEnv,
            },
            availableAccountLabels: [],
          },
          issuedAt: new Date().toISOString(),
        });
      }
      try {
        const credential = await resolveConnectedAccountCredential({
          userId: body.userId,
          integrationType: body.resolve.integrationType as never,
          accountLabel: body.resolve.accountLabel,
          allowedIntegrationTypes: body.resolve.allowedIntegrationTypes as never,
        });
        return Response.json({
          credential,
          issuedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof ConnectedAccountResolutionError) {
          return Response.json(
            {
              code: error.code,
              message: error.message,
              availableAccountLabels: error.availableAccountLabels,
            },
            { status: 409 },
          );
        }
        throw error;
      }
    }

    if (remoteIntegrationSource) {
      const credentials = await getRemoteIntegrationCredentials({
        targetEnv: remoteIntegrationSource.targetEnv,
        remoteUserId: remoteIntegrationSource.remoteUserId,
        integrationTypes: (body.integrationTypes ?? []) as never,
        requestedByUserId: remoteIntegrationSource.requestedByUserId,
        requestedByEmail: remoteIntegrationSource.requestedByEmail ?? null,
      });

      return Response.json({
        userId: body.userId,
        workspaceId: body.workspaceId ?? null,
        tokens: credentials.tokens,
        enabledIntegrations: credentials.enabledIntegrations,
        issuedAt: new Date().toISOString(),
      });
    }

    return Response.json({
      userId: body.userId,
      workspaceId: body.workspaceId ?? null,
      tokens: await getTokensForIntegrations(body.userId, body.integrationTypes ?? []),
      enabledIntegrations: await getEnabledIntegrationTypes(body.userId),
      issuedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
