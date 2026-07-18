import { isManagedBapRpcAllowed } from "@bap/core/server/managed-bap-capabilities";
import { generation } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import type { ORPCContext } from "@/server/orpc/context";

const TERMINAL_GENERATION_STATUSES = new Set(["completed", "cancelled", "error"]);

export type ManagedBapAuthorizationResult =
  | { allowed: true }
  | { allowed: false; status: 403; message: string };

function procedureFromRequest(request: Request): string | null {
  const prefix = "/api/rpc/";
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
}

export async function authorizeManagedBapRpcRequest(params: {
  request: Request;
  context: ORPCContext;
}): Promise<ManagedBapAuthorizationResult> {
  const runtime = params.context.runtimeMcp;
  if (params.context.authSource !== "managed_mcp" || !runtime || runtime.internalKey !== "bap") {
    return { allowed: true };
  }

  const procedure = procedureFromRequest(params.request);
  if (!procedure || !isManagedBapRpcAllowed(runtime.surface, procedure)) {
    return {
      allowed: false,
      status: 403,
      message: "This managed Bap token cannot call the requested procedure.",
    };
  }

  if (!runtime.generationId) {
    return {
      allowed: false,
      status: 403,
      message: "Managed Bap tokens must be bound to a Generation.",
    };
  }

  const record = await params.context.db.query.generation.findFirst({
    where: eq(generation.id, runtime.generationId),
    with: { conversation: true },
  });
  if (
    !record ||
    record.conversation.userId !== runtime.userId ||
    record.conversation.workspaceId !== runtime.workspaceId ||
    (runtime.conversationId !== undefined && record.conversationId !== runtime.conversationId) ||
    TERMINAL_GENERATION_STATUSES.has(record.status)
  ) {
    return {
      allowed: false,
      status: 403,
      message: "The managed Bap Generation is unavailable or terminal.",
    };
  }

  return { allowed: true };
}
