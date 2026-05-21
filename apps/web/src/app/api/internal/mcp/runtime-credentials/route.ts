import {
  getEnabledIntegrationTypes,
  getTokensForIntegrations,
} from "@cmdclaw/core/server/integrations/cli-env";
import {
  ConnectedAccountResolutionError,
  resolveConnectedAccountCredential,
} from "@cmdclaw/core/server/integrations/connected-account-resolution";
import { NextResponse } from "next/server";
import { env } from "@/env";

function assertValidServerSecret(request: Request) {
  const expected = env.CMDCLAW_SERVER_SECRET ? `Bearer ${env.CMDCLAW_SERVER_SECRET}` : "";
  if (!expected || request.headers.get("authorization") !== expected) {
    throw new Error("Unauthorized");
  }
}

export async function POST(request: Request) {
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
    };

    if (!body.userId) {
      return NextResponse.json({ message: "Missing userId" }, { status: 400 });
    }

    if (body.resolve?.integrationType) {
      try {
        const credential = await resolveConnectedAccountCredential({
          userId: body.userId,
          integrationType: body.resolve.integrationType as never,
          accountLabel: body.resolve.accountLabel,
          allowedIntegrationTypes: body.resolve.allowedIntegrationTypes as never,
        });
        return NextResponse.json({
          credential,
          issuedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof ConnectedAccountResolutionError) {
          return NextResponse.json(
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

    return NextResponse.json({
      userId: body.userId,
      workspaceId: body.workspaceId ?? null,
      tokens: await getTokensForIntegrations(body.userId, body.integrationTypes ?? []),
      enabledIntegrations: await getEnabledIntegrationTypes(body.userId),
      issuedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
