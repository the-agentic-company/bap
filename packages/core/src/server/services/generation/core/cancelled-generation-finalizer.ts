import { db } from "@bap/db/client";
import { conversation, coworkerRun, generation } from "@bap/db/schema";
import { inArray } from "drizzle-orm";
import { generationInterruptService } from "../../generation-interrupt-service";

export type FinalizeCancelledGenerationsInput = {
  generationIds: string[];
  completedAt: Date;
  message: string;
};

export async function finalizeCancelledGenerationRows(
  input: FinalizeCancelledGenerationsInput,
  emitTerminalEvent: (generationId: string) => Promise<void>,
): Promise<void> {
  if (input.generationIds.length === 0) {
    return;
  }

  await Promise.all(
    input.generationIds.map((id) => generationInterruptService.cancelInterruptsForGeneration(id)),
  );

  await db
    .update(generation)
    .set({
      status: "cancelled",
      pendingApproval: null,
      pendingAuth: null,
      isPaused: false,
      resumeInterruptId: null,
      suspendedAt: null,
      cancelRequestedAt: null,
      completionReason: "user_cancel",
      completedAt: input.completedAt,
    })
    .where(inArray(generation.id, input.generationIds));

  await db
    .update(coworkerRun)
    .set({ status: "cancelled", finishedAt: input.completedAt, errorMessage: input.message })
    .where(inArray(coworkerRun.generationId, input.generationIds));

  await db
    .update(conversation)
    .set({ generationStatus: "idle" })
    .where(inArray(conversation.currentGenerationId, input.generationIds));

  await Promise.all(input.generationIds.map((id) => emitTerminalEvent(id)));
}
