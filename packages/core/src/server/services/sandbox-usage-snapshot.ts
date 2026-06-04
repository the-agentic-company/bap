import { db } from "@cmdclaw/db/client";
import { sandboxUsageSnapshot } from "@cmdclaw/db/schema";
import { SANDBOX_CREDITS_PER_MINUTE } from "../../lib/billing-plans";
import { isDaytonaConfigured, listAllDaytonaSandboxes } from "../sandbox/daytona";
import {
  SANDBOX_USAGE_SNAPSHOT_JOB_NAME,
  getSandboxUsageSnapshotQueue,
} from "../queues/sandbox-usage-snapshot-client";

const SANDBOX_USAGE_SNAPSHOT_SCHEDULE = "*/5 * * * *";
const SANDBOX_USAGE_SNAPSHOT_SCHEDULER_ID = "sandbox:usage-snapshot";

function resolveSchedulerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
}

function computeCredits(runtimeSeconds: number): number {
  if (!Number.isFinite(runtimeSeconds) || runtimeSeconds <= 0) {
    return 0;
  }
  return (runtimeSeconds / 60) * SANDBOX_CREDITS_PER_MINUTE;
}

type SnapshotRow = {
  snapshotAt: Date;
  provider: "e2b" | "daytona";
  sandboxId: string;
  state: string | null;
  startedAt: Date | null;
  runtimeSeconds: number;
  credits: number;
  metadata: Record<string, unknown> | null;
};

function toSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

async function collectE2B(now: Date): Promise<SnapshotRow[]> {
  try {
    const { isE2BConfigured, listAllE2BSandboxes } = await import("../sandbox/e2b");
    if (!isE2BConfigured()) {
      return [];
    }
    const rows = await listAllE2BSandboxes();
    return rows.map((s) => {
      const startedAt = s.startedAt instanceof Date ? s.startedAt : new Date(s.startedAt);
      const runtimeSeconds =
        s.state === "running" && Number.isFinite(startedAt.getTime())
          ? toSeconds(now.getTime() - startedAt.getTime())
          : 0;
      return {
        snapshotAt: now,
        provider: "e2b" as const,
        sandboxId: s.sandboxId,
        state: s.state,
        startedAt,
        runtimeSeconds,
        credits: computeCredits(runtimeSeconds),
        metadata: { ...s.metadata, templateId: s.templateId, cpuCount: s.cpuCount, memoryMB: s.memoryMB },
      };
    });
  } catch (error) {
    console.warn("[sandbox-usage-snapshot] E2B listing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function collectDaytona(now: Date): Promise<SnapshotRow[]> {
  if (!isDaytonaConfigured()) {
    return [];
  }
  try {
    const rows = await listAllDaytonaSandboxes();
    return rows.map((s) => {
      const startedAt = s.startedAt ?? null;
      const runtimeSeconds =
        s.state === "running" && startedAt ? toSeconds(now.getTime() - startedAt.getTime()) : 0;
      return {
        snapshotAt: now,
        provider: "daytona" as const,
        sandboxId: s.sandboxId,
        state: s.state,
        startedAt,
        runtimeSeconds,
        credits: computeCredits(runtimeSeconds),
        metadata: {
          ...s.metadata,
          lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
        },
      };
    });
  } catch (error) {
    console.warn("[sandbox-usage-snapshot] Daytona listing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function collectSandboxUsageSnapshot(now: Date = new Date()): Promise<{
  inserted: number;
  e2b: number;
  daytona: number;
  failed: number;
}> {
  const [e2bRows, daytonaRows] = await Promise.all([collectE2B(now), collectDaytona(now)]);
  const rows = [...e2bRows, ...daytonaRows].filter((r) => r.sandboxId);

  if (rows.length === 0) {
    return { inserted: 0, e2b: e2bRows.length, daytona: daytonaRows.length, failed: 0 };
  }

  let inserted = 0;
  let failed = 0;
  try {
    await db.insert(sandboxUsageSnapshot).values(rows);
    inserted = rows.length;
  } catch (error) {
    failed = rows.length;
    console.error("[sandbox-usage-snapshot] insert failed", {
      count: rows.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { inserted, e2b: e2bRows.length, daytona: daytonaRows.length, failed };
}

export async function syncSandboxUsageSnapshotJob(): Promise<void> {
  const queue = getSandboxUsageSnapshotQueue();
  await queue.upsertJobScheduler(
    SANDBOX_USAGE_SNAPSHOT_SCHEDULER_ID,
    {
      pattern: SANDBOX_USAGE_SNAPSHOT_SCHEDULE,
      tz: resolveSchedulerTimezone(),
    },
    {
      name: SANDBOX_USAGE_SNAPSHOT_JOB_NAME,
      data: {},
    },
  );
}
