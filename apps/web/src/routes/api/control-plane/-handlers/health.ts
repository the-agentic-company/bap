import { assertValidInstanceApiKey } from "@/server/control-plane/auth";

/**
 * Framework-neutral control-plane health handler (Request -> Response). Self-host instances
 * call this with the instance API key to confirm the cloud control plane is reachable.
 * No `next/*` imports. API authorization stays inside this handler.
 */

/** GET /api/control-plane/health */
export async function healthHandler(request: Request): Promise<Response> {
  try {
    assertValidInstanceApiKey(request);
    return Response.json({
      ok: true,
      edition: "cloud" as const,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
