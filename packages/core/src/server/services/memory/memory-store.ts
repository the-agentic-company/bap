import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@bap/db/client";
import { memoryChunk, memoryEntry, memoryFile } from "@bap/db/schema";
import {
  buildEntryEmbeddingText,
  chunkMarkdown,
  formatDateOnly,
  formatEntryMarkdown,
  getFilePath,
  hashText,
  resolveFileType,
  type MemoryEntryRow,
  type MemoryFileRow,
  type MemoryFileType,
  type MemoryGetInput,
  type MemoryWriteInput,
} from "./format";
import {
  DEFAULT_SEARCH_LIMIT,
  embedTexts,
  resolveMemorySettings,
} from "./embedding";
import { hybridRank, toVectorLiteral } from "./hybrid-search";
import type { MemorySearchInput, MemorySearchResult } from "./search-types";

async function ensureMemoryFile(params: {
  userId: string;
  type: MemoryFileType;
  date: Date | null;
}): Promise<MemoryFileRow> {
  const existing = await db.query.memoryFile.findFirst({
    where: and(
      eq(memoryFile.userId, params.userId),
      eq(memoryFile.type, params.type),
      params.type === "daily" && params.date ? eq(memoryFile.date, params.date) : sql`TRUE`,
    ),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(memoryFile)
    .values({
      userId: params.userId,
      type: params.type,
      date: params.type === "daily" ? params.date : null,
      title: params.type === "longterm" ? "Long-term Memory" : null,
    })
    .returning();

  return created;
}

export async function writeMemoryEntry(
  input: MemoryWriteInput,
): Promise<MemoryEntryRow> {
  const resolved = resolveFileType(input);
  if (!resolved) {
    throw new Error("Invalid memory path or type");
  }

  const file = await ensureMemoryFile({
    userId: input.userId,
    type: resolved.type,
    date: resolved.date,
  });

  const [entry] = await db
    .insert(memoryEntry)
    .values({
      userId: input.userId,
      fileId: file.id,
      title: input.title,
      tags: input.tags,
      content: input.content.trim(),
    })
    .returning();

  const settings = await resolveMemorySettings(input.userId);
  const chunking = {
    tokens: settings.chunkTokens,
    overlap: settings.chunkOverlap,
  };
  const embeddingText = buildEntryEmbeddingText(entry);
  const chunks = chunkMarkdown(embeddingText, chunking);

  let embeddings: number[][] | null = null;
  if (settings.provider === "openai") {
    embeddings = await embedTexts(
      input.userId,
      chunks.map((c) => c.text),
      settings.model,
    );
  }

  if (chunks.length > 0) {
    await db.insert(memoryChunk).values(
      chunks.map((chunk, idx) => ({
        userId: input.userId,
        fileId: file.id,
        entryId: entry.id,
        content: chunk.text,
        contentHash: chunk.hash,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: embeddings ? embeddings[idx] : null,
        embeddingProvider: embeddings ? settings.provider : null,
        embeddingModel: embeddings ? settings.model : null,
        embeddingDimensions: embeddings ? settings.dimensions : null,
      })),
    );
  }

  const fileSnapshot = await readMemoryFile({
    userId: input.userId,
    path: getFilePath(file),
  });

  await db
    .update(memoryFile)
    .set({
      updatedAt: new Date(),
      hash: fileSnapshot ? hashText(fileSnapshot.text) : null,
    })
    .where(eq(memoryFile.id, file.id));

  return entry;
}

export async function readMemoryFile(
  input: MemoryGetInput,
): Promise<{ path: string; text: string } | null> {
  const resolved = resolveFileType(input);
  if (!resolved) {
    return null;
  }

  const file = await db.query.memoryFile.findFirst({
    where: and(
      eq(memoryFile.userId, input.userId),
      eq(memoryFile.type, resolved.type),
      resolved.type === "daily" && resolved.date ? eq(memoryFile.date, resolved.date) : sql`TRUE`,
    ),
  });

  if (!file) {
    return null;
  }

  const entries = await db.query.memoryEntry.findMany({
    where: eq(memoryEntry.fileId, file.id),
    orderBy: asc(memoryEntry.createdAt),
  });

  const header =
    file.type === "daily"
      ? `# ${file.date ? formatDateOnly(file.date) : "Unknown Date"}`
      : "# Long-term Memory";

  const body = entries.map((entry) => formatEntryMarkdown(file, entry)).join("\n\n");

  return {
    path: getFilePath(file),
    text: [header, body].filter(Boolean).join("\n\n").trim() + "\n",
  };
}

export async function listMemoryFiles(
  userId: string,
): Promise<Array<{ path: string; text: string }>> {
  const files = await db.query.memoryFile.findMany({
    where: eq(memoryFile.userId, userId),
    orderBy: [asc(memoryFile.type), desc(memoryFile.date)],
  });

  const results = await Promise.all(
    files.map((file) => readMemoryFile({ userId, path: getFilePath(file) })),
  );
  return results.filter((entry): entry is { path: string; text: string } => entry !== null);
}

type MemoryChunkRow = {
  id: string;
  fileId: string;
  entryId: string | null;
  content: string;
};

export async function searchMemory(
  input: MemorySearchInput,
): Promise<MemorySearchResult[]> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));
  const settings = await resolveMemorySettings(input.userId);

  const fileFilter: string[] = [];
  let filterRequested = false;
  if (input.type || input.date) {
    filterRequested = true;
    const resolved = resolveFileType({
      userId: input.userId,
      type: input.type,
      date: input.date,
      content: "",
    });
    if (resolved) {
      const file = await db.query.memoryFile.findFirst({
        where: and(
          eq(memoryFile.userId, input.userId),
          eq(memoryFile.type, resolved.type),
          resolved.type === "daily" && resolved.date
            ? eq(memoryFile.date, resolved.date)
            : sql`TRUE`,
        ),
      });
      if (file) {
        fileFilter.push(file.id);
      }
    }
  }
  if (filterRequested && fileFilter.length === 0) {
    return [];
  }

  const fileClause =
    fileFilter.length > 0 ? sql`and ${memoryChunk.fileId} in ${fileFilter}` : sql``;

  let vectorRows: Array<MemoryChunkRow & { distance: number }> = [];

  if (settings.provider === "openai") {
    const queryEmbedding = await embedTexts(input.userId, [input.query], settings.model);
    if (queryEmbedding && queryEmbedding[0]) {
      const distanceExpr = sql.raw(`embedding <=> '${toVectorLiteral(queryEmbedding[0])}'`);

      const vectorResult = await db.execute(sql`
        select
          ${memoryChunk.id} as "id",
          ${memoryChunk.fileId} as "fileId",
          ${memoryChunk.entryId} as "entryId",
          ${memoryChunk.content} as "content",
          ${distanceExpr} as "distance"
        from ${memoryChunk}
        where ${memoryChunk.userId} = ${input.userId}
          and ${memoryChunk.embedding} is not null
          ${fileClause}
        order by ${distanceExpr} asc
        limit ${limit * 2}
      `);

      vectorRows = (vectorResult.rows || []) as typeof vectorRows;
    }
  }

  const textResult = await db.execute(sql`
    select
      ${memoryChunk.id} as "id",
      ${memoryChunk.fileId} as "fileId",
      ${memoryChunk.entryId} as "entryId",
      ${memoryChunk.content} as "content",
      ts_rank_cd(to_tsvector('english', ${memoryChunk.content}), plainto_tsquery('english', ${input.query})) as "rank"
    from ${memoryChunk}
    where ${memoryChunk.userId} = ${input.userId}
      ${fileClause}
      and to_tsvector('english', ${memoryChunk.content}) @@ plainto_tsquery('english', ${input.query})
    order by "rank" desc
    limit ${limit * 2}
  `);

  const textRows = (textResult.rows || []) as Array<MemoryChunkRow & { rank: number }>;

  const locator = new Map<string, { fileId: string; entryId: string | null }>();
  for (const row of [...vectorRows, ...textRows]) {
    locator.set(row.id, { fileId: row.fileId, entryId: row.entryId });
  }

  const scored = hybridRank(vectorRows, textRows, { limit });
  if (scored.length === 0) {
    return [];
  }

  const fileIds = Array.from(
    new Set(scored.map((row) => locator.get(row.id)?.fileId).filter(Boolean)),
  ) as string[];
  const entryIds = Array.from(
    new Set(scored.map((row) => locator.get(row.id)?.entryId).filter(Boolean)),
  ) as string[];

  const files = await db.query.memoryFile.findMany({
    where: inArray(memoryFile.id, fileIds),
  });
  const fileMap = new Map(files.map((file) => [file.id, file]));

  const entries =
    entryIds.length > 0
      ? await db.query.memoryEntry.findMany({
          where: inArray(memoryEntry.id, entryIds),
        })
      : [];
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

  return scored.map((row) => {
    const located = locator.get(row.id);
    const file = located ? fileMap.get(located.fileId) : undefined;
    const entry = located?.entryId ? entryMap.get(located.entryId) : null;
    const snippet = row.content.length > 240 ? `${row.content.slice(0, 240)}...` : row.content;
    return {
      id: row.id,
      fileId: located?.fileId ?? "",
      entryId: located?.entryId ?? null,
      entryTitle: entry?.title ?? null,
      path: file ? getFilePath(file) : "memory/unknown.md",
      score: Number(row.score.toFixed(4)),
      snippet,
      source: "memory",
    };
  });
}
