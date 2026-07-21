import { db } from "@bap/db/client";
import { coworker, coworkerRun, coworkerRunEvent, generation } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { sanitizeJsonForPostgres } from "../utils/postgres-json";
import { generationInterruptService } from "./generation-interrupt-service";
import { reconcileStaleCoworkerRunsForCoworker } from "./coworker-service";
import { NON_TERMINAL_COWORKER_RUN_STATUSES } from "./coworker-run-policy";

export async function resetCoworkerRunsAndEnable(params: {
  coworkerId: string;
  resetByUserId: string;
  workspaceId: string;
}): Promise<{
  coworkerId: string;
  totalAffectedRuns: number;
  cancelledRunCount: number;
  cancellingRunCount: number;
}> {
  const [authorized] = await db
    .update(coworker)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(coworker.id, params.coworkerId),
        eq(coworker.workspaceId, params.workspaceId),
        or(eq(coworker.ownerId, params.resetByUserId), isNotNull(coworker.sharedAt)),
      ),
    )
    .returning({ id: coworker.id });
  if (!authorized) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  await reconcileStaleCoworkerRunsForCoworker(params.coworkerId);

  const runs = await db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.coworkerId, params.coworkerId),
      inArray(coworkerRun.status, [...NON_TERMINAL_COWORKER_RUN_STATUSES]),
    ),
    columns: { id: true, status: true, generationId: true },
    with: { generation: { columns: { id: true, status: true, completedAt: true } } },
  });

  const now = new Date();
  const cancelledRuns = runs.filter((run) => !run.generationId || !run.generation);
  const cancellingRuns = runs.filter((run) => run.generationId && run.generation);
  const cancelledRunIds = cancelledRuns.map((run) => run.id);
  const cancellingRunIds = cancellingRuns.map((run) => run.id);
  const cancellingGenerationIds = cancellingRuns
    .map((run) => run.generation?.id)
    .filter((id): id is string => typeof id === "string");

  if (cancelledRunIds.length > 0) {
    await db
      .update(coworkerRun)
      .set({
        status: "cancelled",
        finishedAt: now,
        errorMessage: "Cancelled by coworker run reset.",
      })
      .where(inArray(coworkerRun.id, cancelledRunIds));
  }

  if (cancellingRunIds.length > 0) {
    await db
      .update(coworkerRun)
      .set({
        status: "cancelling",
        errorMessage: "Cancellation requested by coworker run reset.",
      })
      .where(inArray(coworkerRun.id, cancellingRunIds));
  }

  if (cancellingGenerationIds.length > 0) {
    await db
      .update(generation)
      .set({ cancelRequestedAt: now })
      .where(
        and(
          inArray(generation.id, cancellingGenerationIds),
          inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        ),
      );
    await Promise.all(
      cancellingGenerationIds.map((id) =>
        generationInterruptService.cancelInterruptsForGeneration(id),
      ),
    );
  }

  await db
    .update(coworker)
    .set({ status: "on", disabledReason: null, disabledAt: null })
    .where(eq(coworker.id, params.coworkerId));

  await Promise.all(
    runs.map((run) =>
      db.insert(coworkerRunEvent).values({
        coworkerRunId: run.id,
        type: "reset_requested",
        payload: sanitizeJsonForPostgres({
          resetByUserId: params.resetByUserId,
          previousStatus: run.status,
          nextStatus: cancellingRunIds.includes(run.id) ? "cancelling" : "cancelled",
          generationId: run.generationId,
        }),
      }),
    ),
  );

  return {
    coworkerId: params.coworkerId,
    totalAffectedRuns: runs.length,
    cancelledRunCount: cancelledRunIds.length,
    cancellingRunCount: cancellingRunIds.length,
  };
}
