import { triggerCoworkerRun } from "@bap/core/server/services/coworker-service";
import { env } from "@/env";

/**
 * Framework-neutral handler for `POST /api/coworkers/trigger`.
 *
 * Authorized by the `APP_SERVER_SECRET` bearer token (control-plane style), not by a
 * user session. Triggers a coworker run from a JSON body and returns its result. API auth
 * lives here, not in a route page-guard.
 */
export async function triggerCoworker(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = env.APP_SERVER_SECRET ? `Bearer ${env.APP_SERVER_SECRET}` : "";

  if (!expected || authorization !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const coworkerId = body?.coworkerId;
    const payload = body?.payload ?? {};

    if (!coworkerId || typeof coworkerId !== "string") {
      return Response.json({ error: "coworkerId is required" }, { status: 400 });
    }

    const result = await triggerCoworkerRun({
      coworkerId,
      startKind: "external_trigger",
      triggerPayload: payload,
    });

    return Response.json(result);
  } catch (error) {
    console.error("Coworker trigger error:", error);
    return Response.json({ error: "Failed to trigger coworker" }, { status: 500 });
  }
}
