import IORedis from "ioredis";
import type { GenerationEvent } from "../services/generation/types";
import { prefixRedisKey } from "../instance";
import { buildRedisOptions } from "./connection-options";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

const GEN_STREAM_MAXLEN = Number.parseInt(process.env.GEN_STREAM_MAXLEN ?? "2000", 10);
const GEN_STREAM_TTL_SECONDS = Number.parseInt(process.env.GEN_STREAM_TTL_SECONDS ?? "21600", 10);

const STREAM_READ_BLOCK_MS = Number.parseInt(process.env.GEN_STREAM_READ_BLOCK_MS ?? "1500", 10);
const STREAM_READ_COUNT = Number.parseInt(process.env.GEN_STREAM_READ_COUNT ?? "100", 10);
const GEN_STREAM_PREFIX = "gen:stream:";

export type GenerationStreamEnvelope = {
  generationId: string;
  conversationId: string;
  sequence: number;
  eventType: GenerationEvent["type"];
  payload: GenerationEvent;
  createdAtMs: number;
};

export type GenerationStreamReadResult = {
  cursor: string;
  envelope: GenerationStreamEnvelope;
};

type RedisStreamItem = [id: string, fields: string[]];
type RedisStreamResponse = Array<[stream: string, entries: RedisStreamItem[]]>;

function streamKey(generationId: string): string {
  return prefixRedisKey(`${GEN_STREAM_PREFIX}${generationId}`);
}

function getRedisClient(): IORedis {
  const globalState = globalThis as typeof globalThis & {
    __cmdclawGenerationEventBusRedis?: IORedis;
  };
  if (!globalState.__cmdclawGenerationEventBusRedis) {
    globalState.__cmdclawGenerationEventBusRedis = new IORedis(
      buildRedisOptions(REDIS_URL, REDIS_OPTIONS),
    );
  }
  return globalState.__cmdclawGenerationEventBusRedis;
}

function parseEnvelope(raw: string): GenerationStreamEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as GenerationStreamEnvelope;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.generationId !== "string" ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.sequence !== "number" ||
      typeof parsed.eventType !== "string" ||
      typeof parsed.createdAtMs !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function publishGenerationStreamEvent(
  generationId: string,
  envelope: GenerationStreamEnvelope,
): Promise<string> {
  const redis = getRedisClient();
  const key = streamKey(generationId);
  const cursor = await redis.xadd(
    key,
    "MAXLEN",
    "~",
    Math.max(200, GEN_STREAM_MAXLEN),
    "*",
    "envelope",
    JSON.stringify(envelope),
  );
  if (!cursor) {
    throw new Error(`Redis xadd returned empty cursor for generation ${generationId}`);
  }
  await redis.expire(key, Math.max(300, GEN_STREAM_TTL_SECONDS));
  return cursor;
}

export async function readGenerationStreamAfter(params: {
  generationId: string;
  cursor: string;
  blockMs?: number;
  count?: number;
}): Promise<GenerationStreamReadResult[]> {
  const redis = getRedisClient();
  const key = streamKey(params.generationId);
  const blockMs = Math.max(0, params.blockMs ?? STREAM_READ_BLOCK_MS);
  const count = Math.max(1, params.count ?? STREAM_READ_COUNT);
  const raw = (await redis.xread(
    "COUNT",
    count,
    "BLOCK",
    blockMs,
    "STREAMS",
    key,
    params.cursor,
  )) as RedisStreamResponse | null;

  if (!raw || raw.length === 0) {
    return [];
  }

  const [, entries] = raw[0] ?? [];
  if (!entries || entries.length === 0) {
    return [];
  }

  const events: GenerationStreamReadResult[] = [];
  for (const entry of entries) {
    const [id, fields] = entry;
    if (!fields || fields.length < 2) {
      continue;
    }
    const envelopeIndex = fields.findIndex((field) => field === "envelope");
    if (envelopeIndex < 0 || envelopeIndex + 1 >= fields.length) {
      continue;
    }
    const envelopeRaw = fields[envelopeIndex + 1];
    const envelope = parseEnvelope(envelopeRaw);
    if (!envelope) {
      continue;
    }
    events.push({ cursor: id, envelope });
  }

  return events;
}

export async function getLatestGenerationStreamCursor(
  generationId: string,
): Promise<string | null> {
  const redis = getRedisClient();
  const key = streamKey(generationId);
  const raw = (await redis.xrevrange(key, "+", "-", "COUNT", 1)) as RedisStreamItem[];
  const first = raw[0];
  return first?.[0] ?? null;
}

export async function getLatestGenerationStreamEnvelope(
  generationId: string,
): Promise<{ cursor: string; envelope: GenerationStreamEnvelope } | null> {
  const redis = getRedisClient();
  const key = streamKey(generationId);
  const raw = (await redis.xrevrange(key, "+", "-", "COUNT", 1)) as RedisStreamItem[];
  const first = raw[0];
  if (!first) {
    return null;
  }
  const [cursor, fields] = first;
  const envelopeIndex = fields.findIndex((field) => field === "envelope");
  if (envelopeIndex < 0 || envelopeIndex + 1 >= fields.length) {
    return null;
  }
  const envelope = parseEnvelope(fields[envelopeIndex + 1]);
  if (!envelope) {
    return null;
  }
  return { cursor, envelope };
}

export async function generationStreamExists(generationId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = streamKey(generationId);
  const exists = await redis.exists(key);
  return exists === 1;
}
