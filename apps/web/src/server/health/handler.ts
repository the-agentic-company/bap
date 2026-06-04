import { buildRedisOptions } from "@cmdclaw/core/server/redis/connection-options";
import { db } from "@cmdclaw/db/client";
import { sql } from "drizzle-orm";
import IORedis from "ioredis";
import { env } from "@/env";

const redisBaseOptions = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
} as const;

export type HealthChecks = {
  database: boolean;
  redis: boolean;
};

/**
 * Dependencies the health check needs. Injectable so tests can exercise the
 * pure check/response logic without a live Postgres or Redis instance.
 */
export type HealthDeps = {
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<boolean>;
};

const defaultDeps: HealthDeps = {
  pingDatabase: async () => {
    await db.execute(sql`select 1`);
  },
  pingRedis: async () => {
    const redis = new IORedis(buildRedisOptions(env.REDIS_URL, redisBaseOptions));
    try {
      return (await redis.ping()) === "PONG";
    } finally {
      await redis.quit().catch(() => redis.disconnect());
    }
  },
};

/**
 * Framework-neutral health check. Returns a standard `Response` so it can be
 * served from any runtime adapter. Mirrors the legacy `/api/health` JSON shape
 * (`{ ok, checks }`) and the `503` failure status consumed by the Render
 * `healthCheckPath`.
 */
export async function handleHealth(deps: HealthDeps = defaultDeps): Promise<Response> {
  const checks: HealthChecks = {
    database: false,
    redis: false,
  };

  try {
    await deps.pingDatabase();
    checks.database = true;

    checks.redis = await deps.pingRedis();

    return Response.json({ ok: true, checks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return Response.json({ ok: false, checks, error: message }, { status: 503 });
  }
}

export function handleLiveness(): Response {
  return Response.json({ ok: true });
}
