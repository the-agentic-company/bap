import type { RouterClient } from "@orpc/server";
import { db } from "@bap/db/client";
import { conversation, coworkerRun } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import type { AppRouter } from "@/server/orpc";
import {
  type CoworkerDetails,
  formatConversationTranscript,
  formatDate,
  sleep,
  TERMINAL_STATUSES,
} from "./coworker-format";

export type DebugControl = {
  stopRequested: boolean;
  cleanupStarted: boolean;
  signalCount: number;
};

type ContentPartLike =
  | {
      type?: unknown;
      id?: unknown;
      name?: unknown;
      input?: unknown;
      tool_use_id?: unknown;
      text?: unknown;
      content?: unknown;
    }
  | Record<string, unknown>;

export function printPrefixedBlock(prefix: string, content: string): void {
  for (const line of content.split("\n")) {
    console.log(`${prefix} ${line}`);
  }
}

export function printDebugCoworkerSnapshot(details: CoworkerDetails): void {
  console.log("[debug] Current coworker definition");
  console.log(`[debug] id: ${details.id}`);
  console.log(`[debug] name: ${details.name}`);
  console.log(`[debug] updated: ${formatDate(details.updatedAt)}`);
  console.log(`[debug] trigger: ${details.triggerType}`);
  console.log(`[debug] model: ${details.model}`);
  console.log(`[debug] auth source: ${details.authSource ?? "-"}`);
  console.log(`[debug] auto approve: ${details.autoApprove ? "yes" : "no"}`);
  console.log(`[debug] tool access: ${details.toolAccessMode}`);
  console.log(`[debug] allowed integrations: ${details.allowedIntegrations.join(", ") || "-"}`);
  console.log(
    `[debug] custom integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`,
  );
  console.log(`[debug] allowed skills: ${details.allowedSkillSlugs.join(", ") || "-"}`);
  console.log("[debug] prompt:");
  printPrefixedBlock("[debug]", details.prompt || "(empty)");
  if (details.promptDo) {
    console.log("[debug] prompt do:");
    printPrefixedBlock("[debug]", details.promptDo);
  }
  if (details.promptDont) {
    console.log("[debug] prompt don't:");
    printPrefixedBlock("[debug]", details.promptDont);
  }
  console.log("");
}

export function createDebugControl(): {
  control: DebugControl;
  dispose: () => void;
} {
  const control: DebugControl = {
    stopRequested: false,
    cleanupStarted: false,
    signalCount: 0,
  };

  const onInterrupt = () => {
    control.signalCount += 1;
    if (control.signalCount === 1) {
      control.stopRequested = true;
      console.log(
        "\n[debug] Interrupt received, stopping live tail and printing final DB snapshot...",
      );
      return;
    }
    if (control.cleanupStarted) {
      console.log("\n[debug] Second interrupt received during cleanup, exiting immediately.");
      process.exit(130);
    }
  };

  process.on("SIGINT", onInterrupt);

  return {
    control,
    dispose: () => {
      process.off("SIGINT", onInterrupt);
    },
  };
}

function summarizeFinalContentParts(parts: unknown[] | null | undefined): Array<string> {
  const items = Array.isArray(parts) ? (parts as ContentPartLike[]) : [];
  const pickLast = (predicate: (part: ContentPartLike) => boolean) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const part = items[index];
      if (predicate(part)) {
        return part;
      }
    }
    return null;
  };

  const summaries: Array<string> = [];
  const lastToolUse = pickLast((part) => part.type === "tool_use");
  if (lastToolUse) {
    summaries.push(
      `last tool_use: ${String(lastToolUse.name ?? "unknown")} ${JSON.stringify(lastToolUse.input ?? {})}`,
    );
  }
  const lastToolResult = pickLast((part) => part.type === "tool_result");
  if (lastToolResult) {
    summaries.push(`last tool_result: ${String(lastToolResult.content ?? "")}`);
  }
  const lastText = pickLast((part) => part.type === "text");
  if (lastText) {
    summaries.push(`last text: ${String(lastText.text ?? "")}`);
  }
  return summaries;
}

async function printFinalDbSnapshot(runId: string): Promise<void> {
  try {
    const run = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.id, runId),
      with: { generation: true },
    });
    if (!run) {
      console.warn(`[db] Run ${runId} not found.`);
      return;
    }

    const linkedConversation = run.generation?.conversationId
      ? await db.query.conversation.findFirst({
          where: eq(conversation.id, run.generation.conversationId),
        })
      : null;

    console.log("");
    console.log("[db] Final persisted snapshot");
    console.log(`[db] run.id: ${run.id}`);
    console.log(`[db] run.status: ${run.status}`);
    console.log(`[db] run.startedAt: ${formatDate(run.startedAt)}`);
    console.log(`[db] run.finishedAt: ${formatDate(run.finishedAt)}`);
    console.log(`[db] run.errorMessage: ${run.errorMessage ?? "-"}`);
    console.log(`[db] run.triggerPayload: ${JSON.stringify(run.triggerPayload ?? {})}`);

    if (run.generation) {
      console.log(`[db] generation.id: ${run.generation.id}`);
      console.log(`[db] generation.status: ${run.generation.status}`);
      console.log(`[db] generation.completedAt: ${formatDate(run.generation.completedAt)}`);
      console.log(`[db] generation.errorMessage: ${run.generation.errorMessage ?? "-"}`);
      console.log(
        `[db] generation.pendingApproval: ${run.generation.pendingApproval ? "present" : "null"}`,
      );
      console.log(
        `[db] generation.pendingAuth: ${run.generation.pendingAuth ? "present" : "null"}`,
      );
      console.log(`[db] generation.sandboxId: ${run.generation.sandboxId ?? "-"}`);
      console.log(`[db] generation.sandboxProvider: ${run.generation.sandboxProvider ?? "-"}`);
      console.log(`[db] generation.runtimeHarness: ${run.generation.runtimeHarness ?? "-"}`);
      console.log(
        `[db] generation.runtimeProtocolVersion: ${run.generation.runtimeProtocolVersion ?? "-"}`,
      );
      const partSummaries = summarizeFinalContentParts(run.generation.contentParts);
      if (partSummaries.length > 0) {
        for (const summary of partSummaries) {
          printPrefixedBlock("[db]", summary);
        }
      }
    } else {
      console.log("[db] generation: -");
    }

    if (linkedConversation) {
      console.log(`[db] conversation.id: ${linkedConversation.id}`);
      console.log(`[db] conversation.generationStatus: ${linkedConversation.generationStatus}`);
      console.log(
        `[db] conversation.currentGenerationId: ${linkedConversation.currentGenerationId ?? "-"}`,
      );
      console.log(`[db] conversation.updatedAt: ${formatDate(linkedConversation.updatedAt)}`);
    } else {
      console.log("[db] conversation: -");
    }
  } catch (error) {
    console.warn(
      `[db] Failed to load final snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function debugCoworkerRun(
  client: RouterClient<AppRouter>,
  params: {
    coworkerId: string;
    runId: string;
    generationId: string;
    conversationId: string;
  },
  watchIntervalSeconds: number,
): Promise<void> {
  const { runId } = params;
  const seenEventIds = new Set<string>();
  let previousStatus = "";
  let lastTranscript = "";
  const { control, dispose } = createDebugControl();

  try {
    while (!control.stopRequested) {
      // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
      const run = await client.coworker.getRun({ id: runId });

      if (run.status !== previousStatus) {
        console.log(`[run] status: ${previousStatus || "-"} -> ${run.status}`);
        console.log(`[run] started: ${formatDate(run.startedAt)}`);
        if (run.finishedAt) {
          console.log(`[run] finished: ${formatDate(run.finishedAt)}`);
        }
        if (run.errorMessage) {
          printPrefixedBlock("[run]", `error: ${run.errorMessage}`);
        }
        previousStatus = run.status;
      }

      const unseenEvents = run.events.filter((event) => !seenEventIds.has(event.id));
      for (const event of unseenEvents) {
        seenEventIds.add(event.id);
        console.log(`[run] event ${event.type} @ ${formatDate(event.createdAt)}`);
        printPrefixedBlock("[run]", JSON.stringify(event.payload, null, 2));
      }

      if (run.conversationId) {
        try {
          // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
          const runConversation = await client.conversation.get({ id: run.conversationId });
          const transcript = formatConversationTranscript(runConversation.messages);
          if (transcript && transcript !== lastTranscript) {
            const label = lastTranscript ? "updated transcript" : "transcript";
            console.log(`[transcript] ${label}`);
            printPrefixedBlock("[transcript]", transcript);
            lastTranscript = transcript;
          }
        } catch (error) {
          console.error(
            `[transcript] Failed to load transcript: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (TERMINAL_STATUSES.has(run.status)) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- polling loop waits between sequential fetches
      await sleep(watchIntervalSeconds * 1000);
    }
  } finally {
    dispose();
  }

  control.cleanupStarted = true;
  await printFinalDbSnapshot(runId);
}
