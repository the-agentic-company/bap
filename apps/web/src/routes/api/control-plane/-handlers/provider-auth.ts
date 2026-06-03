import { db } from "@cmdclaw/db/client";
import { providerAuth } from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import { assertValidInstanceApiKey } from "@/server/control-plane/auth";

/**
 * Framework-neutral control-plane provider-auth handlers (Request -> Response). Called by
 * self-host instances with the instance API key to read/clear a cloud user's subscription
 * provider auth. Route adapters under `src/routes/api/control-plane/provider-auth/**`
 * delegate here. No `next/*` imports. API authorization stays inside these handlers.
 */

/** POST /api/control-plane/provider-auth/status */
export async function statusHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as { cloudUserId?: string };
    if (!body.cloudUserId) {
      return Response.json({ message: "Missing cloudUserId" }, { status: 400 });
    }

    const auths = await db.query.providerAuth.findMany({
      where: eq(providerAuth.userId, body.cloudUserId),
      columns: {
        provider: true,
      },
    });

    return Response.json({
      connected: auths.map((auth) => auth.provider),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

/** POST /api/control-plane/provider-auth/disconnect */
export async function disconnectHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    const body = (await request.json()) as {
      cloudUserId?: string;
      provider?: string;
    };

    if (!body.cloudUserId || !body.provider) {
      return Response.json({ message: "Missing cloudUserId or provider" }, { status: 400 });
    }

    await db
      .delete(providerAuth)
      .where(
        and(
          eq(providerAuth.userId, body.cloudUserId),
          eq(providerAuth.provider, body.provider as "openai" | "google" | "kimi"),
        ),
      );

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
