import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { env } from "../../../env";
import { db } from "@bap/db/client";
import { memorySettings } from "@bap/db/schema";
import { getResolvedProviderAuth } from "../../control-plane/subscription-providers";

export const DEFAULT_EMBEDDING_PROVIDER = "openai";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_CHUNK_TOKENS = 400;
export const DEFAULT_CHUNK_OVERLAP = 80;
export const DEFAULT_SEARCH_LIMIT = 8;
export const DEFAULT_SCORE_THRESHOLD = 0.35;

export interface ResolvedMemorySettings {
  provider: string;
  model: string;
  dimensions: number;
  chunkTokens: number;
  chunkOverlap: number;
}

export async function resolveMemorySettings(
  userId: string,
): Promise<ResolvedMemorySettings> {
  const settings = await db.query.memorySettings.findFirst({
    where: eq(memorySettings.userId, userId),
  });

  return {
    provider: settings?.provider || DEFAULT_EMBEDDING_PROVIDER,
    model: settings?.model || DEFAULT_EMBEDDING_MODEL,
    dimensions: settings?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
    chunkTokens: settings?.chunkTokens || DEFAULT_CHUNK_TOKENS,
    chunkOverlap: settings?.chunkOverlap || DEFAULT_CHUNK_OVERLAP,
  };
}

async function getOpenAIApiKey(userId: string): Promise<string | null> {
  const auth = await getResolvedProviderAuth({
    userId,
    provider: "openai",
  });
  return auth?.accessToken ?? env.OPENAI_API_KEY ?? null;
}

export async function embedTexts(
  userId: string,
  texts: string[],
  model: string,
): Promise<number[][] | null> {
  if (texts.length === 0) {
    return [];
  }
  const apiKey = await getOpenAIApiKey(userId);
  if (!apiKey) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}
