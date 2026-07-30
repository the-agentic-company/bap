import { coworker, coworkerHistoryEvent, workspaceMember } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import {
  requireAccessibleCoworkerInActiveWorkspace,
  requireCoworkerActionInActiveWorkspace,
} from "./access";

async function requireActiveMember(
  context: Parameters<typeof requireAccessibleCoworkerInActiveWorkspace>[0],
  workspaceId: string,
  userId: string,
) {
  const membership = await context.db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.organizationId, workspaceId), eq(workspaceMember.userId, userId)),
    columns: { id: true },
  });
  if (!membership) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The automation owner must be an active Workspace member",
    });
  }
}

const getAutomationOwner = protectedProcedure
  .input(z.object({ coworkerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    return {
      automationOwnerUserId: wf.automationOwnerUserId,
      automationOwnerConsentedAt: wf.automationOwnerConsentedAt,
      proposedAutomationOwnerUserId: wf.proposedAutomationOwnerUserId,
      proposedAutomationOwnerAt: wf.proposedAutomationOwnerAt,
    };
  });

const proposeAutomationOwner = protectedProcedure
  .input(z.object({ coworkerId: z.string().min(1), userId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const { workspaceId } = await requireCoworkerActionInActiveWorkspace(
      context,
      input.coworkerId,
      "propose_automation_owner",
    );
    await requireActiveMember(context, workspaceId, input.userId);
    const now = new Date();
    const assigningSelf = input.userId === context.user.id;

    const [updated] = await context.db
      .update(coworker)
      .set(
        assigningSelf
          ? {
              automationOwnerUserId: input.userId,
              automationOwnerConsentedAt: now,
              proposedAutomationOwnerUserId: null,
              proposedAutomationOwnerAt: null,
              disabledReason: null,
              disabledAt: null,
            }
          : {
              proposedAutomationOwnerUserId: input.userId,
              proposedAutomationOwnerAt: now,
            },
      )
      .where(and(eq(coworker.id, input.coworkerId), eq(coworker.workspaceId, workspaceId)))
      .returning();
    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }

    await context.db.insert(coworkerHistoryEvent).values({
      coworkerId: input.coworkerId,
      actorUserId: context.user.id,
      actorNameSnapshot: context.user.name ?? null,
      actorAvatarSnapshot: context.user.image ?? null,
      origin: "direct",
      type: assigningSelf ? "automation_owner_changed" : "automation_owner_proposed",
      payload: { userId: input.userId },
    });
    return updated;
  });

const respondToAutomationOwnerProposal = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      response: z.enum(["accept", "reject"]),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireCoworkerActionInActiveWorkspace(
      context,
      input.coworkerId,
      "accept_automation_owner",
    );
    await requireActiveMember(context, workspaceId, context.user.id);
    const now = new Date();
    const accepted = input.response === "accept";
    const [updated] = await context.db
      .update(coworker)
      .set({
        ...(accepted
          ? {
              automationOwnerUserId: context.user.id,
              automationOwnerConsentedAt: now,
              disabledReason: null,
              disabledAt: null,
            }
          : {}),
        proposedAutomationOwnerUserId: null,
        proposedAutomationOwnerAt: null,
      })
      .where(
        and(eq(coworker.id, wf.id), eq(coworker.proposedAutomationOwnerUserId, context.user.id)),
      )
      .returning();
    if (!updated) {
      throw new ORPCError("CONFLICT", { message: "Automation owner proposal is no longer active" });
    }

    await context.db.insert(coworkerHistoryEvent).values({
      coworkerId: wf.id,
      actorUserId: context.user.id,
      actorNameSnapshot: context.user.name ?? null,
      actorAvatarSnapshot: context.user.image ?? null,
      origin: "direct",
      type: accepted ? "automation_owner_accepted" : "automation_owner_rejected",
      payload: { userId: context.user.id },
    });
    return updated;
  });

export const coworkerAutomationOwnerProcedures = {
  getAutomationOwner,
  proposeAutomationOwner,
  respondToAutomationOwnerProposal,
};
