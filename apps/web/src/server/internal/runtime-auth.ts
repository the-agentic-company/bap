import {
  type AuthorizedRuntimeContext,
  conversationRuntimeService,
} from "@cmdclaw/core/server/services/conversation-runtime-service";

/**
 * Framework-neutral runtime-turn authorization for the internal coworker/runtime callback
 * endpoints. Wraps the conversation runtime service so the thin TanStack Start route
 * adapters under /api/internal/** never call the service directly.
 */
export async function authorizeRuntimeTurn(params: {
  runtimeId: string;
  turnSeq: number;
  authorizationHeader: string | null;
}): Promise<AuthorizedRuntimeContext> {
  return await conversationRuntimeService.authorizeRuntimeTurn(params);
}

/**
 * Maps the full set of runtime authorization failure reasons (used by the interrupt
 * endpoints) to standard `Response` objects, preserving the original status codes.
 */
export function buildRuntimeAuthErrorResponse(
  reason: "invalid_token" | "runtime_not_found" | "runtime_not_active" | "stale_turn",
): Response {
  if (reason === "stale_turn") {
    return Response.json({ error: "stale_turn" }, { status: 409 });
  }
  if (reason === "runtime_not_found") {
    return Response.json({ error: "runtime_not_found" }, { status: 404 });
  }
  if (reason === "runtime_not_active") {
    return Response.json({ error: "runtime_not_active" }, { status: 409 });
  }
  return Response.json({ error: "invalid_callback_token" }, { status: 401 });
}
