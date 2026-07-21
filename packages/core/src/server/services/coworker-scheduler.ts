import type { RepeatOptions } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "@bap/db/client";
import { coworker } from "@bap/db/schema";
import { SCHEDULED_COWORKER_JOB_NAME, getQueue } from "../queues/queue-client";

type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

type CoworkerScheduleRow = Pick<
  typeof coworker.$inferSelect,
  "id" | "triggerType" | "status" | "schedule"
>;

function scheduleRowSignature(row: CoworkerScheduleRow | undefined): string {
  return JSON.stringify(row ? [row.status, row.triggerType, row.schedule] : null);
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid schedule time "${time}"`);
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid schedule time "${time}"`);
  }

  return { hour, minute };
}

function parseCoworkerSchedule(schedule: unknown): CoworkerSchedule | null {
  if (!schedule || typeof schedule !== "object") {
    return null;
  }
  const value = schedule as Record<string, unknown>;

  if (value.type === "interval" && typeof value.intervalMinutes === "number") {
    return { type: "interval", intervalMinutes: value.intervalMinutes };
  }

  if (
    value.type === "daily" &&
    typeof value.time === "string" &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return { type: "daily", time: value.time, timezone: value.timezone };
  }

  if (
    value.type === "weekly" &&
    typeof value.time === "string" &&
    Array.isArray(value.daysOfWeek) &&
    value.daysOfWeek.every((day) => typeof day === "number") &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return {
      type: "weekly",
      time: value.time,
      daysOfWeek: value.daysOfWeek as number[],
      timezone: value.timezone,
    };
  }

  if (
    value.type === "monthly" &&
    typeof value.time === "string" &&
    typeof value.dayOfMonth === "number" &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return {
      type: "monthly",
      time: value.time,
      dayOfMonth: value.dayOfMonth,
      timezone: value.timezone,
    };
  }

  return null;
}

export function getCoworkerSchedulerId(coworkerId: string): string {
  return `coworker:${coworkerId}`;
}

export function getLegacyCoworkerSchedulerId(coworkerId: string): string {
  return `workflow:${coworkerId}`;
}

export function isCoworkerSchedulable(row: CoworkerScheduleRow): boolean {
  return (
    row.triggerType === "schedule" &&
    row.status === "on" &&
    parseCoworkerSchedule(row.schedule) !== null
  );
}

function buildRepeatOptions(schedule: CoworkerSchedule): Omit<RepeatOptions, "key"> {
  if (schedule.type === "interval") {
    return { every: schedule.intervalMinutes * 60 * 1000 };
  }

  const { hour, minute } = parseTime(schedule.time);
  const tz = schedule.timezone ?? "UTC";

  if (schedule.type === "daily") {
    return { pattern: `${minute} ${hour} * * *`, tz };
  }

  if (schedule.type === "weekly") {
    const days = [...new Set(schedule.daysOfWeek)].toSorted((a, b) => a - b).join(",");
    return { pattern: `${minute} ${hour} * * ${days}`, tz };
  }

  return { pattern: `${minute} ${hour} ${schedule.dayOfMonth} * *`, tz };
}

export async function removeCoworkerScheduleJob(coworkerId: string): Promise<void> {
  const queue = getQueue();
  await Promise.all([
    queue.removeJobScheduler(getCoworkerSchedulerId(coworkerId)),
    queue.removeJobScheduler(getLegacyCoworkerSchedulerId(coworkerId)),
  ]);
}

export async function upsertCoworkerScheduleJob(row: CoworkerScheduleRow): Promise<void> {
  const schedule = parseCoworkerSchedule(row.schedule);
  if (!schedule) {
    throw new Error(`Coworker "${row.id}" has invalid schedule payload`);
  }

  const queue = getQueue();
  await queue.removeJobScheduler(getLegacyCoworkerSchedulerId(row.id));
  await queue.upsertJobScheduler(getCoworkerSchedulerId(row.id), buildRepeatOptions(schedule), {
    name: SCHEDULED_COWORKER_JOB_NAME,
    data: {
      source: "schedule",
      coworkerId: row.id,
      scheduleType: schedule.type,
    },
  });
}

export async function syncCoworkerScheduleJob(row: CoworkerScheduleRow): Promise<void> {
  if (isCoworkerSchedulable(row)) {
    await upsertCoworkerScheduleJob(row);
    return;
  }

  await removeCoworkerScheduleJob(row.id);
}

export async function reconcileCoworkerScheduleJob(coworkerId: string): Promise<void> {
  while (true) {
    const row = await db.query.coworker.findFirst({
      where: eq(coworker.id, coworkerId),
      columns: {
        id: true,
        status: true,
        triggerType: true,
        schedule: true,
      },
    });

    if (!row) {
      await removeCoworkerScheduleJob(coworkerId);
      return;
    }

    await syncCoworkerScheduleJob(row);

    const current = await db.query.coworker.findFirst({
      where: eq(coworker.id, coworkerId),
      columns: {
        id: true,
        status: true,
        triggerType: true,
        schedule: true,
      },
    });
    if (scheduleRowSignature(current) === scheduleRowSignature(row)) {
      return;
    }
  }
}

export async function reconcileScheduledCoworkerJobs(): Promise<{
  synced: number;
  failed: number;
}> {
  const rows = await db.query.coworker.findMany({
    where: and(eq(coworker.status, "on"), eq(coworker.triggerType, "schedule")),
    columns: {
      id: true,
      status: true,
      triggerType: true,
      schedule: true,
    },
  });

  let synced = 0;
  let failed = 0;
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        await syncCoworkerScheduleJob(row);
        return { synced: 1, failed: 0 };
      } catch (error) {
        console.error(`[coworker-scheduler] failed to reconcile coworker ${row.id}`, error);
        return { synced: 0, failed: 1 };
      }
    }),
  );
  synced = results.reduce<number>((sum, result) => sum + result.synced, 0);
  failed = results.reduce<number>((sum, result) => sum + result.failed, 0);

  return { synced, failed };
}
