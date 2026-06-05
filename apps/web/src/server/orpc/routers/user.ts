import {
  buildUserForwardingAddress,
  EMAIL_FORWARDED_TRIGGER_TYPE,
} from "@cmdclaw/core/lib/email-forwarding";
import { ensureWorkspaceForUser } from "@cmdclaw/core/server/billing/service";
import { user, coworker } from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";

function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// Get current user with onboardedAt status
const me = protectedProcedure.handler(async ({ context }) => {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
  });
  const workspace = await ensureWorkspaceForUser(context.user.id, dbUser?.activeWorkspaceId);

  return {
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    image: context.user.image,
    role: dbUser?.role ?? "user",
    onboardedAt: dbUser?.onboardedAt ?? null,
    timezone: dbUser?.timezone ?? null,
    activeWorkspaceId: workspace.id,
    billingPlanId: workspace.billingPlanId,
  };
});

// Mark onboarding as complete
const completeOnboarding = protectedProcedure.handler(async ({ context }) => {
  await context.db
    .update(user)
    .set({ onboardedAt: new Date() })
    .where(eq(user.id, context.user.id));

  return { success: true };
});

// Reset onboarding for the current user
const resetOnboarding = protectedProcedure.handler(async ({ context }) => {
  await context.db.update(user).set({ onboardedAt: null }).where(eq(user.id, context.user.id));

  return { success: true };
});

const forwarding = protectedProcedure.handler(async ({ context }) => {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: {
      id: true,
      defaultForwardedCoworkerId: true,
      activeWorkspaceId: true,
    },
  });
  const workspace = await ensureWorkspaceForUser(context.user.id, dbUser?.activeWorkspaceId);

  const receivingDomain = process.env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase() ?? null;
  const userForwardingAddress = receivingDomain
    ? buildUserForwardingAddress(context.user.id, receivingDomain)
    : null;

  const coworkers = await context.db.query.coworker.findMany({
    where: and(
      eq(coworker.ownerId, context.user.id),
      eq(coworker.workspaceId, workspace.id),
      eq(coworker.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
    ),
    columns: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
    },
    orderBy: (row, { desc }) => [desc(row.updatedAt)],
  });

  return {
    receivingDomain,
    userForwardingAddress,
    defaultForwardedCoworkerId: dbUser?.defaultForwardedCoworkerId ?? null,
    coworkers,
  };
});

const setDefaultForwardedCoworker = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { activeWorkspaceId: true },
    });
    const workspace = await ensureWorkspaceForUser(context.user.id, dbUser?.activeWorkspaceId);
    if (input.coworkerId) {
      const owned = await context.db.query.coworker.findFirst({
        where: and(
          eq(coworker.id, input.coworkerId),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspace.id),
          eq(coworker.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
        ),
        columns: { id: true },
      });

      if (!owned) {
        throw new ORPCError("NOT_FOUND", {
          message: "Coworker not found for forwarded-email default",
        });
      }
    }

    await context.db
      .update(user)
      .set({ defaultForwardedCoworkerId: input.coworkerId })
      .where(eq(user.id, context.user.id));

    return { success: true };
  });

const setTimezone = protectedProcedure
  .input(
    z.object({
      timezone: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .refine((value) => isValidIanaTimezone(value), "Invalid IANA timezone"),
    }),
  )
  .handler(async ({ input, context }) => {
    await context.db
      .update(user)
      .set({ timezone: input.timezone })
      .where(eq(user.id, context.user.id));

    return { success: true, timezone: input.timezone };
  });

export const userRouter = {
  me,
  completeOnboarding,
  resetOnboarding,
  forwarding,
  setDefaultForwardedCoworker,
  setTimezone,
};
