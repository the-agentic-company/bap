import { db } from "@bap/db/client";
import { sandboxUsageSnapshot } from "@bap/db/schema";
import { SANDBOX_CREDITS_PER_MINUTE } from "../../lib/billing-plans";
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

type ProviderSnapshotResult = {
  rows: SnapshotRow[];
  failed: boolean;
};

function toSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

async function collectE2B(now: Date): Promise<ProviderSnapshotResult> {
  try {
    const { isE2BConfigured, listAllE2BSandboxes } = await import("../sandbox/e2b");
    if (!isE2BConfigured()) {
      return { rows: [], failed: false };
    }
    const rows = await listAllE2BSandboxes();
    return {
      rows: rows.map((s) => {
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
      }),
      failed: false,
    };
  } catch (error) {
    console.warn("[sandbox-usage-snapshot] E2B listing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { rows: [], failed: true };
  }
}

async function collectDaytona(): Promise<ProviderSnapshotResult> {
  // Daytona lifecycle is provider-managed; automatic listing can refresh sandbox activity.
  return { rows: [], failed: false };
}

export async function collectSandboxUsageSnapshot(now: Date = new Date()): Promise<{
  inserted: number;
  e2b: number;
  daytona: number;
  failed: number;
  providerFailures: Array<"e2b" | "daytona">;
}> {
  const [e2bResult, daytonaResult] = await Promise.all([collectE2B(now), collectDaytona()]);
  const e2bRows = e2bResult.rows;
  const daytonaRows = daytonaResult.rows;
  const rows = [...e2bRows, ...daytonaRows].filter((r) => r.sandboxId);
  const providerFailures: Array<"e2b" | "daytona"> = [
    ...(e2bResult.failed ? (["e2b"] as const) : []),
    ...(daytonaResult.failed ? (["daytona"] as const) : []),
  ];

  if (rows.length === 0) {
    return {
      inserted: 0,
      e2b: e2bRows.length,
      daytona: daytonaRows.length,
      failed: 0,
      providerFailures,
    };
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

  return { inserted, e2b: e2bRows.length, daytona: daytonaRows.length, failed, providerFailures };
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
