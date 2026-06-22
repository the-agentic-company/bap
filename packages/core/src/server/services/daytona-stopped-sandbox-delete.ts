import { Daytona } from "@daytonaio/sdk";
import { db } from "@bap/db/client";
import { conversationRuntime, generation } from "@bap/db/schema";
import { and, inArray, isNotNull } from "drizzle-orm";
import {
  getDaytonaClientConfig,
  listDaytonaSandboxPages,
} from "../sandbox/daytona";
import { getDaytonaRunawayCleanupQueue } from "../queues/daytona-runaway-cleanup-client";

export const DAYTONA_STOPPED_SANDBOX_DELETE_SCHEDULER_ID = "daytona:stopped-sandbox-delete";

type DaytonaSandboxSummary = {
  id?: string;
  state?: string;
  delete?: (timeout?: number) => Promise<void>;
};

function isDeletableTerminalState(state: string | undefined): boolean {
  const normalized = (state ?? "").toLowerCase();
  return normalized === "stopped" || normalized === "error" || normalized === "build_failed";
}

export async function cleanupStoppedDaytonaSandboxes(): Promise<{
  scanned: number;
  stopped: number;
  errored: number;
  deleted: number;
  deleteFailed: number;
  skippedMissingId: number;
}> {
  const daytona = new Daytona(getDaytonaClientConfig());
  const sandboxes = await listDaytonaSandboxPages(daytona as unknown as Parameters<typeof listDaytonaSandboxPages>[0]);

  let stopped = 0;
  let errored = 0;
  let deleted = 0;
  let deleteFailed = 0;
  let skippedMissingId = 0;
  const deletedIds: string[] = [];

  for (const sandbox of sandboxes) {
    const state = (sandbox.state ?? "").toLowerCase();
    if (!isDeletableTerminalState(state)) {
      continue;
    }

    if (state === "stopped") {
      stopped += 1;
    } else {
      errored += 1;
    }

    const sandboxId = sandbox.id?.trim();
    if (!sandboxId) {
      skippedMissingId += 1;
      continue;
    }

    try {
      if (sandbox.delete) {
        await sandbox.delete(60);
      } else {
        const loaded = (await daytona.get(sandboxId)) as DaytonaSandboxSummary;
        if (!loaded.delete) {
          throw new Error("Sandbox did not expose a delete method");
        }
        await loaded.delete(60);
      }
      deleted += 1;
      deletedIds.push(sandboxId);
    } catch (error) {
      deleteFailed += 1;
      console.warn("[daytona-stopped-sandbox-delete] Failed to delete stopped sandbox", {
        sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deletedIds.length > 0) {
    await db
      .update(conversationRuntime)
      .set({
        status: "dead",
        sandboxId: null,
        sessionId: null,
        activeGenerationId: null,
      })
      .where(
        and(
          isNotNull(conversationRuntime.sandboxId),
          inArray(conversationRuntime.sandboxId, deletedIds),
        ),
      );

    await db
      .update(generation)
      .set({
        sandboxId: null,
      })
      .where(and(isNotNull(generation.sandboxId), inArray(generation.sandboxId, deletedIds)));
  }

  return {
    scanned: sandboxes.length,
    stopped,
    errored,
    deleted,
    deleteFailed,
    skippedMissingId,
  };
}

export async function syncStoppedDaytonaSandboxDeleteJob(): Promise<void> {
  const queue = getDaytonaRunawayCleanupQueue();
  await queue.removeJobScheduler(DAYTONA_STOPPED_SANDBOX_DELETE_SCHEDULER_ID);
}
