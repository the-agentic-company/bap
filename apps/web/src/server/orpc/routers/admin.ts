import { SCHEDULED_COWORKER_JOB_NAME, buildQueueJobId, getQueue } from "@bap/core/server/queues";
import { approvedLoginEmailAllowlist, coworker, coworkerRun, user } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { randomBytes } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  isApprovedLoginEmail,
  normalizeApprovedLoginEmail,
} from "@/server/lib/approved-login-emails";
import {
  findAuthUserByEmail,
  findAuthUserById,
  resolveOrCreateAuthUserByEmail,
  setCredentialPassword,
} from "@/server/lib/credential-accounts";
import { protectedProcedure, type AuthenticatedContext } from "../middleware";
import { queryCoworkerOverview } from "../shared/overview-queries";
import { queryUsageDashboard } from "../shared/usage-queries";
import { getChatOverview } from "./admin-chat-overview";
import { getPerformanceDashboard } from "./admin-performance";
import { requireAdmin } from "./admin-require-admin";
import { adminKillSandbox, getSandboxUsageHistory, listSandboxes } from "./admin-sandbox";

function generateDemoPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function ensureApprovedLoginEntry(context: AuthenticatedContext, email: string) {
  if (await isApprovedLoginEmail(email)) {
    return;
  }

  await context.db
    .insert(approvedLoginEmailAllowlist)
    .values({
      email,
      createdByUserId: context.user.id,
    })
    .onConflictDoNothing({
      target: [approvedLoginEmailAllowlist.email],
    });
}

async function resolveOrCreateDemoUser(params: {
  context: AuthenticatedContext;
  email: string;
  name?: string | null;
}) {
  const normalizedEmail = normalizeApprovedLoginEmail(params.email);
  await ensureApprovedLoginEntry(params.context, normalizedEmail);
  const createdUser = await resolveOrCreateAuthUserByEmail({
    email: normalizedEmail,
    name: params.name,
  });

  return {
    userId: createdUser.id,
    email: createdUser.email,
  };
}

type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

function parseCoworkerSchedule(value: unknown): CoworkerSchedule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const schedule = value as Record<string, unknown>;

  if (schedule.type === "interval" && typeof schedule.intervalMinutes === "number") {
    return { type: "interval", intervalMinutes: schedule.intervalMinutes };
  }

  if (
    schedule.type === "daily" &&
    typeof schedule.time === "string" &&
    (schedule.timezone === undefined || typeof schedule.timezone === "string")
  ) {
    return {
      type: "daily",
      time: schedule.time,
      timezone: schedule.timezone,
    };
  }

  if (
    schedule.type === "weekly" &&
    typeof schedule.time === "string" &&
    Array.isArray(schedule.daysOfWeek) &&
    schedule.daysOfWeek.every((day) => typeof day === "number") &&
    (schedule.timezone === undefined || typeof schedule.timezone === "string")
  ) {
    return {
      type: "weekly",
      time: schedule.time,
      daysOfWeek: schedule.daysOfWeek as number[],
      timezone: schedule.timezone,
    };
  }

  if (
    schedule.type === "monthly" &&
    typeof schedule.time === "string" &&
    typeof schedule.dayOfMonth === "number" &&
    (schedule.timezone === undefined || typeof schedule.timezone === "string")
  ) {
    return {
      type: "monthly",
      time: schedule.time,
      dayOfMonth: schedule.dayOfMonth,
      timezone: schedule.timezone,
    };
  }

  return null;
}

const getUsageDashboard = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);
    return queryUsageDashboard(context.db, input.workspaceId);
  });

const getCoworkerOverview = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);
    return queryCoworkerOverview(context.db, {
      workspaceId: input.workspaceId,
    });
  });

const createDemoPasswordAccount = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
      name: z.string().trim().min(1).max(120).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const password = generateDemoPassword();
    const user = await resolveOrCreateDemoUser({
      context,
      email: input.email,
      name: input.name,
    });

    await setCredentialPassword({
      userId: user.userId,
      password,
    });

    return {
      userId: user.userId,
      email: user.email,
      password,
    };
  });

const resetDemoPassword = protectedProcedure
  .input(
    z
      .object({
        userId: z.string().min(1).optional(),
        email: z.string().email().optional(),
      })
      .refine((value) => Boolean(value.userId || value.email), {
        message: "userId or email is required",
      }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const existingUser = input.userId
      ? await findAuthUserById(input.userId)
      : await findAuthUserByEmail(normalizeApprovedLoginEmail(input.email ?? ""));

    if (!existingUser) {
      throw new ORPCError("NOT_FOUND", { message: "User not found" });
    }

    const normalizedEmail = normalizeApprovedLoginEmail(existingUser.email);
    await ensureApprovedLoginEntry(context, normalizedEmail);

    const password = generateDemoPassword();
    await setCredentialPassword({
      userId: existingUser.id,
      password,
    });

    return {
      userId: existingUser.id,
      email: normalizedEmail,
      password,
    };
  });

const setUserAdminRole = protectedProcedure
  .input(
    z.object({
      userId: z.string().min(1),
      isAdmin: z.boolean(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    if (context.user.id === input.userId && !input.isAdmin) {
      throw new ORPCError("BAD_REQUEST", {
        message: "You cannot remove your own admin access.",
      });
    }

    const [updatedUser] = await context.db
      .update(user)
      .set({ role: input.isAdmin ? "admin" : "user" })
      .where(eq(user.id, input.userId))
      .returning({
        id: user.id,
        role: user.role,
      });

    if (!updatedUser) {
      throw new ORPCError("NOT_FOUND", { message: "User not found" });
    }

    return updatedUser;
  });

const grantAdminAccessByEmail = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const createdUser = await resolveOrCreateDemoUser({
      context,
      email: input.email,
    });

    const [updatedUser] = await context.db
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.id, createdUser.userId))
      .returning({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

    if (!updatedUser) {
      throw new ORPCError("NOT_FOUND", { message: "User not found" });
    }

    return updatedUser;
  });

const getOpsScheduledCoworkers = protectedProcedure.handler(async ({ context }) => {
  await requireAdmin(context);

  const coworkers = await context.db.query.coworker.findMany({
    where: eq(coworker.triggerType, "schedule"),
    columns: {
      id: true,
      name: true,
      username: true,
      status: true,
      schedule: true,
      updatedAt: true,
    },
    orderBy: (table, { asc }) => [asc(table.name), asc(table.id)],
  });

  const latestRunResult =
    coworkers.length > 0
      ? await context.db.execute(sql`
          select distinct on (r.coworker_id)
            r.coworker_id as "coworkerId",
            r.id as "runId",
            r.status as "status",
            r.started_at as "startedAt",
            r.finished_at as "finishedAt",
            r.error_message as "errorMessage"
          from ${coworkerRun} r
          where r.coworker_id in ${sql.raw(`(${coworkers.map((row) => `'${row.id}'`).join(",")})`)}
          order by r.coworker_id, r.started_at desc
        `)
      : null;

  const latestRunRows = (latestRunResult?.rows ?? []) as Array<{
    coworkerId: string;
    runId: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage: string | null;
  }>;

  const latestRunByCoworkerId = new Map(latestRunRows.map((row) => [row.coworkerId, row]));

  return coworkers.map((row) => {
    const schedule = parseCoworkerSchedule(row.schedule);
    const latestRun = latestRunByCoworkerId.get(row.id) ?? null;

    return {
      id: row.id,
      name: row.name,
      username: row.username,
      status: row.status,
      schedule,
      isHourlyInterval: schedule?.type === "interval" && schedule.intervalMinutes === 60,
      updatedAt: row.updatedAt,
      latestRun: latestRun
        ? {
            id: latestRun.runId,
            status: latestRun.status,
            startedAt: latestRun.startedAt,
            finishedAt: latestRun.finishedAt,
            errorMessage: latestRun.errorMessage,
          }
        : null,
    };
  });
});

const enqueueScheduledCoworkersNow = protectedProcedure
  .input(
    z.object({
      ids: z.array(z.string().min(1)).min(1).max(100),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const uniqueIds = [...new Set(input.ids)];
    const rows = await context.db.query.coworker.findMany({
      where: inArray(coworker.id, uniqueIds),
      columns: {
        id: true,
        name: true,
        status: true,
        triggerType: true,
        schedule: true,
      },
    });

    const rowById = new Map(rows.map((row) => [row.id, row]));
    const queue = getQueue();
    const batchStartedAt = Date.now();
    const scheduledFor = new Date(batchStartedAt).toISOString();
    const results = await Promise.all(
      uniqueIds.map(async (id, index) => {
        const row = rowById.get(id);
        if (!row) {
          return { id, ok: false as const, reason: "not_found" };
        }

        if (row.triggerType !== "schedule") {
          return {
            id,
            ok: false as const,
            reason: "not_scheduled",
            name: row.name,
          };
        }

        if (row.status !== "on") {
          return { id, ok: false as const, reason: "off", name: row.name };
        }

        const schedule = parseCoworkerSchedule(row.schedule);
        if (!schedule) {
          return {
            id,
            ok: false as const,
            reason: "invalid_schedule",
            name: row.name,
          };
        }

        const jobId = buildQueueJobId([
          "admin-ops-scheduled-coworker",
          row.id,
          batchStartedAt,
          index + 1,
        ]);

        await queue.add(
          SCHEDULED_COWORKER_JOB_NAME,
          {
            source: "schedule",
            coworkerId: row.id,
            scheduleType: schedule.type,
            scheduledFor,
          },
          {
            jobId,
            removeOnComplete: true,
            removeOnFail: 200,
          },
        );

        return {
          id,
          ok: true as const,
          name: row.name,
          jobId,
          scheduleType: schedule.type,
        };
      }),
    );

    return {
      scheduledFor,
      enqueuedCount: results.filter((result) => result.ok).length,
      skippedCount: results.filter((result) => !result.ok).length,
      results,
    };
  });

export const adminRouter = {
  createDemoPasswordAccount,
  resetDemoPassword,
  setUserAdminRole,
  grantAdminAccessByEmail,
  getChatOverview,
  getUsageDashboard,
  getCoworkerOverview,
  getPerformanceDashboard,
  getOpsScheduledCoworkers,
  enqueueScheduledCoworkersNow,
  listSandboxes,
  killSandbox: adminKillSandbox,
  getSandboxUsageHistory,
};
