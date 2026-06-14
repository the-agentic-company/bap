import { isSelfHostedEdition } from "@bap/core/server/edition";
import {
  approvedLoginEmailAllowlist,
  googleIntegrationAccessAllowlist,
  user,
} from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { shouldGrantAdminRole } from "@/lib/admin-emails";
import {
  listApprovedLoginEmailEntries,
  normalizeApprovedLoginEmail,
} from "@/server/lib/approved-login-emails";
import { protectedProcedure } from "../middleware";
import {
  GOOGLE_ACCESS_REQUEST_SLACK_CHANNEL_NAME,
  normalizeEmail,
  getSlackBotToken,
  ensureAdmin,
  canUserAccessGoogleIntegrations,
  lookupSlackChannelIdByName,
  postSlackMessage,
  googleIntegrationTypeSchema,
} from "./integration-shared";

export const getGoogleAccessStatus = protectedProcedure.handler(async ({ context }) => {
  if (isSelfHostedEdition()) {
    return { allowed: true };
  }

  const allowed = await canUserAccessGoogleIntegrations(context);
  return { allowed };
});

export const listGoogleAccessAllowlist = protectedProcedure.handler(async ({ context }) => {
  if (isSelfHostedEdition()) {
    throw new ORPCError("FORBIDDEN", { message: "Support admin is only available in cloud" });
  }

  await ensureAdmin(context);

  return context.db.query.googleIntegrationAccessAllowlist.findMany({
    columns: {
      id: true,
      email: true,
      createdByUserId: true,
      createdAt: true,
    },
    orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.createdAt)],
  });
});

export const listApprovedLoginEmailAllowlist = protectedProcedure.handler(async ({ context }) => {
  await ensureAdmin(context);
  return listApprovedLoginEmailEntries();
});

export const addApprovedLoginEmailAllowlistEntry = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    await ensureAdmin(context);

    const normalizedEmail = normalizeApprovedLoginEmail(input.email);
    const inserted = await context.db
      .insert(approvedLoginEmailAllowlist)
      .values({
        email: normalizedEmail,
        createdByUserId: context.user.id,
      })
      .onConflictDoNothing({
        target: [approvedLoginEmailAllowlist.email],
      })
      .returning({
        id: approvedLoginEmailAllowlist.id,
        email: approvedLoginEmailAllowlist.email,
        createdByUserId: approvedLoginEmailAllowlist.createdByUserId,
        createdAt: approvedLoginEmailAllowlist.createdAt,
      });

    if (inserted[0]) {
      return {
        ...inserted[0],
        isBuiltIn: false as const,
      };
    }

    if (shouldGrantAdminRole(normalizedEmail)) {
      return {
        id: `builtin:${normalizedEmail}`,
        email: normalizedEmail,
        createdByUserId: null,
        createdAt: null,
        isBuiltIn: true as const,
      };
    }

    const existing = await context.db.query.approvedLoginEmailAllowlist.findFirst({
      where: eq(approvedLoginEmailAllowlist.email, normalizedEmail),
      columns: {
        id: true,
        email: true,
        createdByUserId: true,
        createdAt: true,
      },
    });

    if (!existing) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to add approved login email",
      });
    }

    return {
      ...existing,
      isBuiltIn: false as const,
    };
  });

export const removeApprovedLoginEmailAllowlistEntry = protectedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    await ensureAdmin(context);

    if (input.id.startsWith("builtin:")) {
      throw new ORPCError("FORBIDDEN", {
        message: "Built-in admin emails cannot be removed",
      });
    }

    const removed = await context.db
      .delete(approvedLoginEmailAllowlist)
      .where(eq(approvedLoginEmailAllowlist.id, input.id))
      .returning({
        id: approvedLoginEmailAllowlist.id,
      });

    if (!removed[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: "Approved login email not found",
      });
    }

    return { success: true as const };
  });

export const addGoogleAccessAllowlistEntry = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      throw new ORPCError("FORBIDDEN", { message: "Support admin is only available in cloud" });
    }

    await ensureAdmin(context);

    const normalizedEmail = normalizeEmail(input.email);
    const inserted = await context.db
      .insert(googleIntegrationAccessAllowlist)
      .values({
        email: normalizedEmail,
        createdByUserId: context.user.id,
      })
      .onConflictDoNothing({
        target: [googleIntegrationAccessAllowlist.email],
      })
      .returning({
        id: googleIntegrationAccessAllowlist.id,
        email: googleIntegrationAccessAllowlist.email,
        createdByUserId: googleIntegrationAccessAllowlist.createdByUserId,
        createdAt: googleIntegrationAccessAllowlist.createdAt,
      });

    if (inserted[0]) {
      return inserted[0];
    }

    const existing = await context.db.query.googleIntegrationAccessAllowlist.findFirst({
      where: eq(googleIntegrationAccessAllowlist.email, normalizedEmail),
      columns: {
        id: true,
        email: true,
        createdByUserId: true,
        createdAt: true,
      },
    });

    if (!existing) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to add Google access entry",
      });
    }

    return existing;
  });

export const removeGoogleAccessAllowlistEntry = protectedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      throw new ORPCError("FORBIDDEN", { message: "Support admin is only available in cloud" });
    }

    await ensureAdmin(context);

    const removed = await context.db
      .delete(googleIntegrationAccessAllowlist)
      .where(eq(googleIntegrationAccessAllowlist.id, input.id))
      .returning({
        id: googleIntegrationAccessAllowlist.id,
      });

    if (!removed[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: "Google access entry not found",
      });
    }

    return { success: true as const };
  });

export const requestGoogleAccess = protectedProcedure
  .input(
    z.object({
      integration: googleIntegrationTypeSchema.optional(),
      source: z.enum(["integrations", "chat", "onboarding"]).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      return { ok: true as const, alreadyAllowed: true as const };
    }

    const alreadyAllowed = await canUserAccessGoogleIntegrations(context);
    if (alreadyAllowed) {
      return { ok: true as const, alreadyAllowed: true as const };
    }

    const slackBotToken = getSlackBotToken();
    if (!slackBotToken) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Slack notifications are not configured",
      });
    }

    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { email: true, name: true },
    });

    const channelId = await lookupSlackChannelIdByName(
      GOOGLE_ACCESS_REQUEST_SLACK_CHANNEL_NAME,
      slackBotToken,
    );
    const message = [
      ":lock: *Google Access Request*",
      `*User:* ${dbUser?.email ?? context.user.id}`,
      `*Name:* ${dbUser?.name ?? "unknown"}`,
      `*User ID:* ${context.user.id}`,
      `*Integration:* ${input.integration ?? "not specified"}`,
      `*Source:* ${input.source ?? "unknown"}`,
      `*Requested at:* ${new Date().toISOString()}`,
    ].join("\n");

    const slackResult = await postSlackMessage(channelId, message, slackBotToken);
    if (!slackResult.ok) {
      throw new ORPCError("BAD_GATEWAY", {
        message: slackResult.error ?? "Failed to send Slack notification",
      });
    }

    return { ok: true as const, alreadyAllowed: false as const };
  });
