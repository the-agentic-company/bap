import IORedis from "ioredis";
import { prefixRedisKey } from "../../../instance";
import { buildRedisOptions } from "../../../redis/connection-options";

const GENERATION_LEASE_TTL_MS = 120_000;

function getLockRedis(): IORedis {
  const globalForLocks = globalThis as typeof globalThis & {
    __cmdclawGenerationLockRedis?: IORedis;
  };
  if (!globalForLocks.__cmdclawGenerationLockRedis) {
    globalForLocks.__cmdclawGenerationLockRedis = new IORedis(
      buildRedisOptions(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }),
    );
  }
  return globalForLocks.__cmdclawGenerationLockRedis;
}

export class GenerationLeaseStore {
  async acquire(generationId: string): Promise<string | null> {
    if (process.env.NODE_ENV === "test") {
      return `local-${generationId}`;
    }
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for durable generation lease locking.");
    }
    const token = crypto.randomUUID();
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const result = await getLockRedis().set(leaseKey, token, "PX", GENERATION_LEASE_TTL_MS, "NX");
    return result === "OK" ? token : null;
  }

  async renew(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await getLockRedis().get(leaseKey);
    if (owner !== token) {
      return;
    }
    await getLockRedis().pexpire(leaseKey, GENERATION_LEASE_TTL_MS);
  }

  async release(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await getLockRedis().get(leaseKey);
    if (owner === token) {
      await getLockRedis().del(leaseKey);
    }
  }

  async isHeld(generationId: string): Promise<boolean> {
    if (process.env.NODE_ENV === "test") {
      return false;
    }
    if (!process.env.REDIS_URL) {
      return false;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await getLockRedis().get(leaseKey);
    return !!owner;
  }
}
