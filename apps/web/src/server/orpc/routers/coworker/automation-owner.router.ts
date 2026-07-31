import {
  coworker,
  coworkerAutomationRegistration,
  coworkerHistoryEvent,
  workspaceMember,
} from "@bap/db/schema";
import {
  canManageAutomationRegistration,
  pausedRegistrationStatus,
} from "@bap/core/server/services/coworker-automation-registration-policy";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import {
  requireAccessibleCoworkerInActiveWorkspace,
  requireCoworkerActionInActiveWorkspace,
} from "./access";
import { integrationTypeSchema } from "./schemas";
import { activateCoworkerAutomationRegistration } from "@/server/services/coworker-automation-registration";

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
    const {
      coworker: wf,
      workspaceId,
      membershipRole,
    } = await requireAccessibleCoworkerInActiveWorkspace(context, input.coworkerId);
    const members = await context.db.query.workspaceMember.findMany({
      where: eq(workspaceMember.organizationId, workspaceId),
      with: {
        user: {
          columns: { id: true, name: true, email: true, image: true },
        },
      },
    });
    return {
      automationOwnerUserId: wf.automationOwnerUserId,
      automationOwnerConsentedAt: wf.automationOwnerConsentedAt,
      proposedAutomationOwnerUserId: wf.proposedAutomationOwnerUserId,
      proposedAutomationOwnerAt: wf.proposedAutomationOwnerAt,
      canProposeAutomationOwner:
        wf.createdByUserId === context.user.id ||
        wf.ownerId === context.user.id ||
        membershipRole === "admin" ||
        membershipRole === "owner",
      members: members.map((membership) => membership.user),
    };
  });

function requireScheduledCoworker(triggerType: string) {
  if (triggerType !== "schedule") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Automation registrations are available only for scheduled Coworkers",
    });
  }
}

const getAutomationRegistrations = protectedProcedure
  .input(z.object({ coworkerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, membershipRole } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    requireScheduledCoworker(wf.triggerType);
    const registrations = await context.db.query.coworkerAutomationRegistration.findMany({
      where: eq(coworkerAutomationRegistration.coworkerId, wf.id),
      with: {
        user: { columns: { id: true, name: true, email: true, image: true } },
      },
      orderBy: (registration, { asc }) => [asc(registration.registeredAt)],
    });
    const items = registrations.map((registration) => ({
      id: registration.id,
      userId: registration.userId,
      name: registration.user?.name ?? registration.memberNameSnapshot ?? "Former member",
      email: registration.user?.email ?? null,
      image: registration.user?.image ?? registration.memberAvatarSnapshot,
      status: registration.status,
      statusReason: registration.statusReason,
      isYou: registration.userId === context.user.id,
      registeredAt: registration.registeredAt,
      pausedAt: registration.pausedAt,
    }));
    return {
      registrations: items,
      activeCount: items.filter((item) => item.status === "active").length,
      currentUserId: context.user.id,
      currentUserRegistration: items.find((item) => item.userId === context.user.id) ?? null,
      canAdminister: membershipRole === "admin" || membershipRole === "owner",
    };
  });

const registerForAutomation = protectedProcedure
  .input(z.object({ coworkerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const {
      coworker: wf,
      workspaceId,
      membershipRole,
    } = await requireAccessibleCoworkerInActiveWorkspace(context, input.coworkerId);
    requireScheduledCoworker(wf.triggerType);
    if (
      !canManageAutomationRegistration({
        action: "register",
        actorUserId: context.user.id,
        registrationUserId: context.user.id,
        workspaceRole: membershipRole,
        isActiveWorkspaceMember: true,
      })
    ) {
      throw new ORPCError("FORBIDDEN", { message: "You cannot register this member" });
    }
    return activateCoworkerAutomationRegistration({
      database: context.db,
      coworkerId: wf.id,
      workspaceId,
      actor: {
        userId: context.user.id,
        name: context.user.name ?? null,
        image: context.user.image ?? null,
      },
    });
  });

const changeAutomationRegistration = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      userId: z.string().min(1),
      action: z.enum(["pause", "resume", "remove"]),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf, membershipRole } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    requireScheduledCoworker(wf.triggerType);
    if (
      !canManageAutomationRegistration({
        action: input.action,
        actorUserId: context.user.id,
        registrationUserId: input.userId,
        workspaceRole: membershipRole,
        isActiveWorkspaceMember: true,
      })
    ) {
      throw new ORPCError("FORBIDDEN", {
        message:
          input.action === "resume"
            ? "Only the registered member can resume these runs"
            : "You cannot manage this registration",
      });
    }
    const now = new Date();
    const status =
      input.action === "resume"
        ? "active"
        : input.action === "remove"
          ? "removed"
          : pausedRegistrationStatus({
              actorUserId: context.user.id,
              registrationUserId: input.userId,
            });
    const [registration] = await context.db
      .update(coworkerAutomationRegistration)
      .set({
        status,
        statusReason:
          input.action === "pause"
            ? status === "admin_paused"
              ? "Paused by a Workspace administrator"
              : "Paused by member"
            : null,
        statusChangedByUserId: context.user.id,
        pausedAt: input.action === "pause" ? now : null,
        removedAt: input.action === "remove" ? now : null,
        revokedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(coworkerAutomationRegistration.coworkerId, wf.id),
          eq(coworkerAutomationRegistration.userId, input.userId),
        ),
      )
      .returning();
    if (!registration) {
      throw new ORPCError("NOT_FOUND", { message: "Automation registration not found" });
    }
    await context.db.insert(coworkerHistoryEvent).values({
      coworkerId: wf.id,
      actorUserId: context.user.id,
      actorNameSnapshot: context.user.name ?? null,
      actorAvatarSnapshot: context.user.image ?? null,
      origin: "direct",
      type: `automation_registration_${input.action}d`,
      payload: { registrationId: registration.id, userId: input.userId },
    });
    return registration;
  });

const getMyAutomationAccountPreferences = protectedProcedure
  .input(z.object({ coworkerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    requireScheduledCoworker(wf.triggerType);
    const registration = await context.db.query.coworkerAutomationRegistration.findFirst({
      where: and(
        eq(coworkerAutomationRegistration.coworkerId, wf.id),
        eq(coworkerAutomationRegistration.userId, context.user.id),
      ),
      columns: { connectedAccountPreferences: true },
    });
    if (!registration) {
      throw new ORPCError("NOT_FOUND", { message: "Automation registration not found" });
    }
    return registration.connectedAccountPreferences;
  });

const setMyAutomationAccountPreference = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      integrationType: integrationTypeSchema,
      accountLabel: z.string().trim().min(1).max(128).nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    requireScheduledCoworker(wf.triggerType);
    const registration = await context.db.query.coworkerAutomationRegistration.findFirst({
      where: and(
        eq(coworkerAutomationRegistration.coworkerId, wf.id),
        eq(coworkerAutomationRegistration.userId, context.user.id),
      ),
      columns: { id: true, connectedAccountPreferences: true },
    });
    if (!registration) {
      throw new ORPCError("NOT_FOUND", { message: "Automation registration not found" });
    }
    const preferences = { ...registration.connectedAccountPreferences };
    if (input.accountLabel) {
      preferences[input.integrationType] = { accountLabel: input.accountLabel };
    } else {
      delete preferences[input.integrationType];
    }
    await context.db
      .update(coworkerAutomationRegistration)
      .set({ connectedAccountPreferences: preferences, updatedAt: new Date() })
      .where(eq(coworkerAutomationRegistration.id, registration.id));
    return { success: true };
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
      throw new ORPCError("CONFLICT", {
        message: "Automation owner proposal is no longer active",
      });
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
  getAutomationRegistrations,
  registerForAutomation,
  changeAutomationRegistration,
  getMyAutomationAccountPreferences,
  setMyAutomationAccountPreference,
  getAutomationOwner,
  proposeAutomationOwner,
  respondToAutomationOwnerProposal,
};
