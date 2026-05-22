import { clientObservationSchema } from "@cmdclaw/core/lib/client-observation";
import { emitClientObservation } from "@cmdclaw/core/server/utils/observability";
import { buildRedisOptions } from "@cmdclaw/core/server/redis/connection-options";
import { db } from "@cmdclaw/db/client";
import { conversation, generation } from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import IORedis from "ioredis";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireActiveWorkspaceAccess } from "@/server/orpc/workspace-access";

export const runtime = "nodejs";

const clientObservationsRequestSchema = z.object({
  observations: z.array(clientObservationSchema).min(1).max(20),
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 120;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const LOW_VALUE_SUCCESS_SAMPLE_RATE = 0.25;

const redisState = globalThis as typeof globalThis & {
  __cmdclawClientObservationRedis?: IORedis;
};

function getClientObservationRedis(): IORedis {
  redisState.__cmdclawClientObservationRedis ??= new IORedis(
    buildRedisOptions(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    }),
  );
  return redisState.__cmdclawClientObservationRedis;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

async function isRateLimited(key: string, eventCount: number): Promise<boolean> {
  const redis = getClientObservationRedis();
  const redisKey = `client_observation_rate:${key}`;
  const result = await redis.multi().incrby(redisKey, eventCount).pttl(redisKey).exec();
  const count = Array.isArray(result?.[0]) ? Number(result?.[0]?.[1]) : Number.NaN;
  const ttlMs = Array.isArray(result?.[1]) ? Number(result?.[1]?.[1]) : Number.NaN;
  if (Number.isFinite(ttlMs) && ttlMs < 0) {
    await redis.pexpire(redisKey, RATE_LIMIT_WINDOW_MS);
  }
  return Number.isFinite(count) && count > RATE_LIMIT_MAX_EVENTS;
}

async function reserveObservationEventId(eventId: string): Promise<boolean> {
  const redis = getClientObservationRedis();
  const result = await redis.set(
    `client_observation_event:${eventId}`,
    "1",
    "PX",
    DEDUPE_WINDOW_MS,
    "NX",
  );
  return result === "OK";
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shouldRetainObservation(observation: z.infer<typeof clientObservationSchema>): boolean {
  if (process.env.NODE_ENV === "test") {
    return true;
  }
  if (
    observation.eventType === "generation.stream.error" ||
    observation.eventType === "generation.visible_error" ||
    observation.eventType === "generation.stream.reconnected" ||
    observation.eventType === "generation.stream.done" ||
    observation.closeReason === "error" ||
    observation.visibleErrorCode
  ) {
    return true;
  }
  const bucket = stableHash(observation.eventId) / 0xffffffff;
  return bucket < LOW_VALUE_SUCCESS_SAMPLE_RATE;
}

async function verifyConversationAccess(args: {
  conversationId: string;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const row = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.id, args.conversationId),
      eq(conversation.userId, args.userId),
      eq(conversation.workspaceId, args.workspaceId),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

async function verifyGenerationAccess(args: {
  generationId: string;
  conversationId?: string;
  userId: string;
  workspaceId: string;
}): Promise<{ ok: boolean; conversationId?: string; traceId?: string | null }> {
  const row = await db.query.generation.findFirst({
    where: eq(generation.id, args.generationId),
    columns: {
      id: true,
      conversationId: true,
      traceId: true,
    },
    with: {
      conversation: {
        columns: {
          userId: true,
          workspaceId: true,
        },
      },
    },
  });

  if (
    !row ||
    row.conversation.userId !== args.userId ||
    row.conversation.workspaceId !== args.workspaceId ||
    (args.conversationId && row.conversationId !== args.conversationId)
  ) {
    return { ok: false };
  }

  return { ok: true, conversationId: row.conversationId, traceId: row.traceId };
}

export async function POST(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = clientObservationsRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "invalid_observation" }, { status: 400 });
  }

  const access = await requireActiveWorkspaceAccess(sessionData.user.id);
  const ip = getClientIp(request);
  const sessionId = sessionData.session?.id ?? "unknown-session";
  const rateLimitKey = `${sessionData.user.id}:${sessionId}:${ip}`;
  let rateLimited = false;
  try {
    rateLimited = await isRateLimited(rateLimitKey, parsed.data.observations.length);
  } catch {
    rateLimited = false;
  }
  if (rateLimited) {
    return Response.json({ ok: true, rateLimited: true });
  }

  const verifiedObservations = await Promise.all(
    parsed.data.observations.map(async (observation) => {
      let resolvedConversationId = observation.conversationId;
      let resolvedTraceId = observation.traceId;
      if (observation.generationId) {
        const generationAccess = await verifyGenerationAccess({
          generationId: observation.generationId,
          conversationId: observation.conversationId,
          userId: sessionData.user.id,
          workspaceId: access.workspace.id,
        });
        if (!generationAccess.ok) {
          return { ok: false as const };
        }
        resolvedConversationId = generationAccess.conversationId ?? resolvedConversationId;
        resolvedTraceId = observation.traceId ?? generationAccess.traceId ?? undefined;
      } else if (observation.conversationId) {
        const ok = await verifyConversationAccess({
          conversationId: observation.conversationId,
          userId: sessionData.user.id,
          workspaceId: access.workspace.id,
        });
        if (!ok) {
          return { ok: false as const };
        }
      }
      return { ok: true as const, observation, resolvedConversationId, resolvedTraceId };
    }),
  );

  if (verifiedObservations.some((result) => !result.ok)) {
    return Response.json({ error: "resource_not_found" }, { status: 404 });
  }

  const retainedObservations = verifiedObservations.flatMap((verified) => {
    if (!verified.ok) {
      return [];
    }
    return shouldRetainObservation(verified.observation) ? [verified] : [];
  });

  const reservedEventIds = await Promise.all(
    retainedObservations.map(async ({ observation }) => {
      try {
        return await reserveObservationEventId(observation.eventId);
      } catch {
        return true;
      }
    }),
  );

  for (const [index, verified] of retainedObservations.entries()) {
    if (!reservedEventIds[index]) {
      continue;
    }
    const { observation, resolvedConversationId, resolvedTraceId } = verified;

    emitClientObservation({
      eventId: observation.eventId,
      eventType: observation.eventType,
      timestamp: observation.occurredAt ? new Date(observation.occurredAt) : undefined,
      context: {
        source: "browser",
        traceId: resolvedTraceId,
        generationId: observation.generationId,
        conversationId: resolvedConversationId,
        userId: sessionData.user.id,
        sessionId,
      },
      attributes: {
        "cmdclaw.client_observation.type": observation.eventType,
        "cmdclaw.client.event_id": observation.eventId,
        "cmdclaw.user.id": sessionData.user.id,
        "cmdclaw.workspace.id": access.workspace.id,
        "cmdclaw.generation.id": observation.generationId,
        "cmdclaw.conversation.id": resolvedConversationId,
        "cmdclaw.trace.id": resolvedTraceId,
        "cmdclaw.client.stream_attempt": observation.streamAttempt,
        "cmdclaw.client.elapsed_ms": observation.elapsedMs,
        "cmdclaw.client.visible_error_code": observation.visibleErrorCode,
        "cmdclaw.client.close_reason": observation.closeReason,
        "cmdclaw.client.page_visibility": observation.pageVisibility,
        "cmdclaw.client.online": observation.online,
      },
    });
  }

  return Response.json({ ok: true });
}
