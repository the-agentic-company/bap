import { coworkerHistoryEvent, coworkerRevision, user } from "@bap/db/schema";
import { and, arrayContains, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  applyCoworkerEdit,
  coworkerBuilderEditSchema,
} from "@bap/core/server/services/coworker-builder-service";
import { protectedProcedure } from "../../middleware";
import { requireEditableCoworkerInActiveWorkspace } from "./access";
import { getOrCreateCoworkerBuilderConversation } from "@/server/services/coworker-builder-conversation";
import { summarizeCoworkerInstructionDocumentChanges } from "./instruction-document-changes";

const edit = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      baseUpdatedAt: z.string().datetime({ offset: true }),
      changes: coworkerBuilderEditSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    await requireEditableCoworkerInActiveWorkspace(context, input.coworkerId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    return applyCoworkerEdit({
      database: context.db as unknown,
      userId: context.user.id,
      userRole: dbUser?.role ?? null,
      coworkerId: input.coworkerId,
      baseUpdatedAt: input.baseUpdatedAt,
      changes: input.changes,
    });
  });

const getOrCreateBuilderConversation = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: editableCoworker, workspaceId } =
      await requireEditableCoworkerInActiveWorkspace(context, input.id);
    const wf = {
      id: editableCoworker.id,
      name: editableCoworker.name,
      builderConversationId: editableCoworker.builderConversationId,
      model: editableCoworker.model,
      authSource: editableCoworker.authSource,
    };

    return getOrCreateCoworkerBuilderConversation({
      database: context.db as Parameters<
        typeof getOrCreateCoworkerBuilderConversation
      >[0]["database"],
      userId: context.user.id,
      workspaceId,
      coworker: wf,
    });
  });

const getInstructionDocumentChanges = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    await requireEditableCoworkerInActiveWorkspace(context, input.id);
    const latestPromptRevision = await context.db.query.coworkerRevision.findFirst({
      where: and(
        eq(coworkerRevision.coworkerId, input.id),
        arrayContains(coworkerRevision.changedFields, ["prompt"]),
      ),
      orderBy: [desc(coworkerRevision.createdAt)],
      columns: { createdAt: true },
    });
    const documentEvents = await context.db.query.coworkerHistoryEvent.findMany({
      where: and(
        eq(coworkerHistoryEvent.coworkerId, input.id),
        inArray(coworkerHistoryEvent.type, [
          "document_added",
          "document_removed",
          "document_updated",
        ]),
        latestPromptRevision
          ? gt(coworkerHistoryEvent.createdAt, latestPromptRevision.createdAt)
          : undefined,
      ),
      orderBy: [asc(coworkerHistoryEvent.createdAt)],
      columns: { type: true, payload: true },
    });
    return summarizeCoworkerInstructionDocumentChanges(documentEvents);
  });

export const coworkerBuilderProcedures = {
  edit,
  getOrCreateBuilderConversation,
  getInstructionDocumentChanges,
};
