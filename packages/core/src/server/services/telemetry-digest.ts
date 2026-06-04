import { and, asc, count, eq, gte, lt } from "drizzle-orm";
import { db } from "@cmdclaw/db/client";
import { user, userDailyActivity } from "@cmdclaw/db/schema";
import { DAILY_TELEMETRY_DIGEST_JOB_NAME, getQueue } from "../queues/queue-client";
import { postMessageToOpsTelemetryChannel } from "./telemetry-slack";

const OPS_DAILY_DIGEST_TIME = "09:00";
const DEFAULT_DIGEST_TIMEZONE = "Europe/Dublin";
const MAX_USER_PREVIEW_COUNT = 10;

const DAILY_TELEMETRY_DIGEST_SCHEDULER_ID = "telemetry:daily-digest";

type UserPreview = {
  id: string;
  email: string;
  name: string;
};

type AppUrlSource = "APP_URL" | "NEXT_PUBLIC_APP_URL";

export type DailyTelemetryDigestSummary = {
  activityDate: string;
  newSignups: number;
  activeUsers: number;
  returningActiveUsers: number;
  signupsPreview: UserPreview[];
  activeUsersPreview: UserPreview[];
  returningActiveUsersPreview: UserPreview[];
  appUrl: string | null;
  appUrlDomain: string | null;
  appUrlSource: AppUrlSource | null;
};

function formatUserPreviewLabel(preview: UserPreview): string {
  return preview.name.trim().length > 0 ? `${preview.name} <${preview.email}>` : preview.email;
}

function parseDigestTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":").map((value) => Number(value));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid digest time "${time}"`);
  }

  return { hour, minute };
}

function resolveDigestTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || DEFAULT_DIGEST_TIMEZONE;
}

function formatLocalDate(dateValue: Date): string {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPreviousDayWindow(now: Date): { start: Date; end: Date; activityDate: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return {
    start,
    end,
    activityDate: formatLocalDate(start),
  };
}

function resolveDigestAppUrl(): {
  appUrl: string | null;
  appUrlDomain: string | null;
  appUrlSource: AppUrlSource | null;
} {
  const candidates: Array<{ value: string | undefined; source: AppUrlSource }> = [
    { value: process.env.APP_URL?.trim(), source: "APP_URL" },
    { value: process.env.NEXT_PUBLIC_APP_URL?.trim(), source: "NEXT_PUBLIC_APP_URL" },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    try {
      const url = new URL(candidate.value);
      return {
        appUrl: candidate.value,
        appUrlDomain: url.host,
        appUrlSource: candidate.source,
      };
    } catch {
      continue;
    }
  }

  return {
    appUrl: null,
    appUrlDomain: null,
    appUrlSource: null,
  };
}

export async function getDailyTelemetryDigestSummary(now = new Date()): Promise<DailyTelemetryDigestSummary> {
  const { start, end, activityDate } = getPreviousDayWindow(now);
  const appUrlInfo = resolveDigestAppUrl();

  const [
    [{ value: newSignups }],
    [{ value: activeUsers }],
    [{ value: returningActiveUsers }],
    signupsPreview,
    activeUsersPreview,
    returningActiveUsersPreview,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(user)
      .where(and(gte(user.createdAt, start), lt(user.createdAt, end))),
    db
      .select({ value: count() })
      .from(userDailyActivity)
      .where(eq(userDailyActivity.activityDate, activityDate)),
    db
      .select({ value: count() })
      .from(userDailyActivity)
      .innerJoin(user, eq(userDailyActivity.userId, user.id))
      .where(and(eq(userDailyActivity.activityDate, activityDate), lt(user.createdAt, start))),
    db.query.user.findMany({
      where: and(gte(user.createdAt, start), lt(user.createdAt, end)),
      columns: {
        id: true,
        email: true,
        name: true,
      },
      orderBy: [asc(user.createdAt)],
      limit: MAX_USER_PREVIEW_COUNT,
    }),
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(userDailyActivity)
      .innerJoin(user, eq(userDailyActivity.userId, user.id))
      .where(eq(userDailyActivity.activityDate, activityDate))
      .orderBy(asc(userDailyActivity.firstSeenAt), asc(user.name), asc(user.email))
      .limit(MAX_USER_PREVIEW_COUNT),
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(userDailyActivity)
      .innerJoin(user, eq(userDailyActivity.userId, user.id))
      .where(and(eq(userDailyActivity.activityDate, activityDate), lt(user.createdAt, start)))
      .orderBy(asc(userDailyActivity.firstSeenAt), asc(user.name), asc(user.email))
      .limit(MAX_USER_PREVIEW_COUNT),
  ]);

  return {
    activityDate,
    newSignups: Number(newSignups ?? 0),
    activeUsers: Number(activeUsers ?? 0),
    returningActiveUsers: Number(returningActiveUsers ?? 0),
    signupsPreview: signupsPreview.map((signup) => ({
      id: signup.id,
      email: signup.email,
      name: signup.name,
    })),
    activeUsersPreview: activeUsersPreview.map((preview) => ({
      id: preview.id,
      email: preview.email,
      name: preview.name,
    })),
    returningActiveUsersPreview: returningActiveUsersPreview.map((preview) => ({
      id: preview.id,
      email: preview.email,
      name: preview.name,
    })),
    appUrl: appUrlInfo.appUrl,
    appUrlDomain: appUrlInfo.appUrlDomain,
    appUrlSource: appUrlInfo.appUrlSource,
  };
}

export function buildDailyTelemetryDigestMessage(summary: DailyTelemetryDigestSummary): string {
  const lines = [
    `CmdClaw daily ops digest for ${summary.activityDate}`,
    "",
    `App URL domain: ${summary.appUrlDomain ?? "not configured"}${
      summary.appUrlSource ? ` (${summary.appUrlSource})` : ""
    }`,
    `New signups: ${summary.newSignups}`,
    `Active users: ${summary.activeUsers}`,
    `Returning active users: ${summary.returningActiveUsers}`,
  ];

  if (summary.signupsPreview.length > 0) {
    lines.push("", "New signup preview:");
    for (const signup of summary.signupsPreview) {
      lines.push(`- ${formatUserPreviewLabel(signup)}`);
    }
  }

  if (summary.activeUsersPreview.length > 0) {
    lines.push("", "Active user preview:");
    for (const preview of summary.activeUsersPreview) {
      lines.push(`- ${formatUserPreviewLabel(preview)}`);
    }
  }

  if (summary.returningActiveUsersPreview.length > 0) {
    lines.push("", "Returning active user preview:");
    for (const preview of summary.returningActiveUsersPreview) {
      lines.push(`- ${formatUserPreviewLabel(preview)}`);
    }
  }

  return lines.join("\n");
}

export async function postDailyTelemetryDigest(now = new Date()): Promise<DailyTelemetryDigestSummary> {
  const summary = await getDailyTelemetryDigestSummary(now);
  await postMessageToOpsTelemetryChannel(buildDailyTelemetryDigestMessage(summary));
  return summary;
}

export async function syncDailyTelemetryDigestJob(): Promise<void> {
  const { hour, minute } = parseDigestTime(OPS_DAILY_DIGEST_TIME);
  const queue = getQueue();
  await queue.upsertJobScheduler(
    DAILY_TELEMETRY_DIGEST_SCHEDULER_ID,
    {
      pattern: `${minute} ${hour} * * *`,
      tz: resolveDigestTimezone(),
    },
    {
      name: DAILY_TELEMETRY_DIGEST_JOB_NAME,
      data: {},
    },
  );
}
