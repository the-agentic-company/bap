import { triggerCoworkerRun } from "@bap/core/server/services/coworker-service";
import { evaluateSpawnRequest } from "@bap/core/server/services/generation/spawn-depth";
import type { RemoteIntegrationSource } from "@bap/core/server/integrations/remote-integrations";
import { user } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

type RemoteIntegrationSourceInput = Pick<RemoteIntegrationSource, "targetEnv" | "remoteUserId">;

type TriggerDatabase = {
  query: {
    user: {
      findFirst: (args: unknown) => Promise<{ role: string | null; email: string | null } | null>;
    };
  };
};

type TriggerContext = {
  user: { id: string };
  db: TriggerDatabase;
  authSource?: string | null;
  runtimeMcp?: { spawnDepth: number } | null;
};

export async function triggerCoworkerFromWeb(input: {
  context: TriggerContext;
  coworkerId: string;
  payload?: unknown;
  fileAttachments?: Array<{
    fileAssetId: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
  trustedUserInput?: string;
  remoteIntegrationSource?: RemoteIntegrationSourceInput;
  debugRunDeadlineMs?: number;
}) {
  const dbUser = await input.context.db.query.user.findFirst({
    where: eq(user.id, input.context.user.id),
    columns: { role: true, email: true },
  });

  if (input.remoteIntegrationSource && dbUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }

  let spawnDepth: number | undefined;
  if (input.context.authSource === "managed_mcp" && input.context.runtimeMcp) {
    const spawnEvaluation = evaluateSpawnRequest(input.context.runtimeMcp.spawnDepth);
    if (!spawnEvaluation.allowed) {
      throw new ORPCError("BAD_REQUEST", { message: spawnEvaluation.message });
    }
    spawnDepth = spawnEvaluation.childSpawnDepth;
  }

  return triggerCoworkerRun({
    coworkerId: input.coworkerId,
    startKind: "user_intent",
    triggerPayload: input.payload ?? {},
    trustedUserInput: input.trustedUserInput,
    fileAttachments: input.fileAttachments,
    userId: input.context.user.id,
    userRole: dbUser?.role ?? null,
    debugRunDeadlineMs: input.debugRunDeadlineMs,
    spawnDepth,
    remoteIntegrationSource: input.remoteIntegrationSource
      ? {
          ...input.remoteIntegrationSource,
          requestedByUserId: input.context.user.id,
          requestedByEmail: dbUser?.email ?? null,
        }
      : undefined,
  });
}
