import {
  applyCanonicalCoworkerChange,
  type CoworkerConfigurationSnapshot,
} from "@bap/core/server/services/coworker-change-service";
import { createDrizzleCoworkerChangeRepository } from "@bap/core/server/services/coworker-change-repository";
import { coworkerHistoryEvent, coworkerRevision } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, arrayContains, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import {
  requireAccessibleCoworkerInActiveWorkspace,
  requireCoworkerActionInActiveWorkspace,
} from "./access";
import { summarizeCoworkerInstructionDocumentChanges } from "./instruction-document-changes";

const listRevisions = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAccessibleCoworkerInActiveWorkspace(context, input.coworkerId);
    const [revisions, events, latestInstructionRevision] = await Promise.all([
      context.db.query.coworkerRevision.findMany({
        where: eq(coworkerRevision.coworkerId, input.coworkerId),
        orderBy: [desc(coworkerRevision.revision)],
        limit: input.limit,
        columns: {
          id: true,
          revision: true,
          baseRevision: true,
          actorUserId: true,
          actorNameSnapshot: true,
          actorAvatarSnapshot: true,
          origin: true,
          changedFields: true,
          changes: true,
          createdAt: true,
        },
      }),
      context.db.query.coworkerHistoryEvent.findMany({
        where: eq(coworkerHistoryEvent.coworkerId, input.coworkerId),
        orderBy: [desc(coworkerHistoryEvent.createdAt)],
        limit: input.limit,
      }),
      context.db.query.coworkerRevision.findFirst({
        where: and(
          eq(coworkerRevision.coworkerId, input.coworkerId),
          arrayContains(coworkerRevision.changedFields, ["prompt"]),
        ),
        orderBy: [desc(coworkerRevision.createdAt)],
        columns: {
          createdAt: true,
        },
      }),
    ]);
    const documentEvents = await context.db.query.coworkerHistoryEvent.findMany({
      where: and(
        eq(coworkerHistoryEvent.coworkerId, input.coworkerId),
        inArray(coworkerHistoryEvent.type, ["document_added", "document_removed"]),
        latestInstructionRevision
          ? gt(coworkerHistoryEvent.createdAt, latestInstructionRevision.createdAt)
          : undefined,
      ),
      orderBy: [asc(coworkerHistoryEvent.createdAt)],
      columns: {
        type: true,
        payload: true,
      },
    });

    return {
      revisions,
      events,
      instructionDocumentChanges: summarizeCoworkerInstructionDocumentChanges(documentEvents),
    };
  });

const getRevision = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      revision: z.number().int().min(0),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAccessibleCoworkerInActiveWorkspace(context, input.coworkerId);
    const revision = await context.db.query.coworkerRevision.findFirst({
      where: and(
        eq(coworkerRevision.coworkerId, input.coworkerId),
        eq(coworkerRevision.revision, input.revision),
      ),
    });
    if (!revision) {
      throw new ORPCError("NOT_FOUND", {
        message: "Coworker revision not found",
      });
    }
    return revision;
  });

const restoreRevision = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      revision: z.number().int().min(0),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf, membershipRole } = await requireCoworkerActionInActiveWorkspace(
      context,
      input.coworkerId,
      "restore_revision",
    );
    const target = await context.db.query.coworkerRevision.findFirst({
      where: and(
        eq(coworkerRevision.coworkerId, input.coworkerId),
        eq(coworkerRevision.revision, input.revision),
      ),
    });
    if (!target) {
      throw new ORPCError("NOT_FOUND", {
        message: "Coworker revision not found",
      });
    }

    const result = await applyCanonicalCoworkerChange({
      repository: createDrizzleCoworkerChangeRepository(context.db),
      coworkerId: input.coworkerId,
      actor: {
        userId: context.user.id,
        name: context.user.name ?? null,
        avatar: context.user.image ?? null,
        workspaceRole: membershipRole,
        isActiveWorkspaceMember: true,
      },
      origin: "restore",
      expectedRevision: wf.configurationRevision,
      changes: target.snapshot as CoworkerConfigurationSnapshot,
    });
    if (result.kind === "applied" || result.kind === "unchanged") {
      return result;
    }
    if (result.kind === "conflict") {
      throw new ORPCError("CONFLICT", {
        message: "Coworker changed while restoring",
      });
    }
    throw new ORPCError(result.kind === "not_found" ? "NOT_FOUND" : "FORBIDDEN", {
      message: "Coworker revision could not be restored",
    });
  });

export const coworkerRevisionProcedures = {
  listRevisions,
  getRevision,
  restoreRevision,
};
