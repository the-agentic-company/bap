import { format } from "date-fns";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@bap/db/client";
import {
  conversation,
  conversationRuntime,
  message,
  sessionTranscript,
  sessionTranscriptChunk,
  type ContentPart,
} from "@bap/db/schema";
import { SESSION_BOUNDARY_PREFIX } from "../session-constants";
import { generateConversationTitle } from "../../utils/generate-title";
import {
  chunkMarkdown,
  formatDateOnly,
  formatTranscriptMarkdown,
  getTranscriptPath,
  slugify,
  type MemoryGetInput,
  type SessionTranscriptRow,
} from "./format";
import {
  DEFAULT_SEARCH_LIMIT,
  embedTexts,
  resolveMemorySettings,
} from "./embedding";
import { hybridRank, toVectorLiteral } from "./hybrid-search";
import type { MemorySearchInput, MemorySearchResult } from "./search-types";

export async function readSessionTranscriptByPath(
  input: MemoryGetInput,
): Promise<{ path: string; text: string } | null> {
  const normalized = input.path.trim().replace(/^\//, "");
  if (!normalized.toLowerCase().startsWith("sessions/")) {
    return null;
  }

  const transcript = await db.query.sessionTranscript.findFirst({
    where: and(eq(sessionTranscript.userId, input.userId), eq(sessionTranscript.path, normalized)),
  });

  if (!transcript) {
    return null;
  }

  return {
    path: getTranscriptPath(transcript),
    text: transcript.content,
  };
}

export async function listSessionTranscripts(
  userId: string,
): Promise<Array<{ path: string; text: string }>> {
  const transcripts = await db.query.sessionTranscript.findMany({
    where: eq(sessionTranscript.userId, userId),
    orderBy: desc(sessionTranscript.createdAt),
  });

  return transcripts.map((t) => ({
    path: getTranscriptPath(t),
    text: t.content,
  }));
}

async function writeSessionTranscript(input: {
  userId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  slug?: string | null;
  date?: Date | null;
  source?: string | null;
  messageCount?: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  content: string;
}): Promise<SessionTranscriptRow> {
  const date = input.date ?? new Date();
  const timeLabel = format(date, "HHmmss");
  const safeSlug = input.slug ? slugify(input.slug) : "";
  const slugPart = safeSlug ? `-${safeSlug}` : "-session";
  const path = `sessions/${formatDateOnly(date)}-${timeLabel}${slugPart}.md`;

  const [transcript] = await db
    .insert(sessionTranscript)
    .values({
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      sessionId: input.sessionId ?? null,
      title: input.title ?? null,
      slug: input.slug ? slugify(input.slug) : null,
      path,
      date,
      source: input.source ?? null,
      messageCount: input.messageCount ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      content: input.content.trim(),
    })
    .returning();

  const settings = await resolveMemorySettings(input.userId);
  const chunking = {
    tokens: settings.chunkTokens,
    overlap: settings.chunkOverlap,
  };
  const chunks = chunkMarkdown(transcript.content, chunking);

  let embeddings: number[][] | null = null;
  if (settings.provider === "openai") {
    embeddings = await embedTexts(
      input.userId,
      chunks.map((c) => c.text),
      settings.model,
    );
  }

  if (chunks.length > 0) {
    await db.insert(sessionTranscriptChunk).values(
      chunks.map((chunk, idx) => ({
        userId: input.userId,
        transcriptId: transcript.id,
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

  return transcript;
}

export async function writeSessionTranscriptFromConversation(input: {
  userId: string;
  conversationId: string;
  source?: string;
  messageLimit?: number;
  excludeUserMessages?: string[];
}): Promise<SessionTranscriptRow | null> {
  const convo = await db.query.conversation.findFirst({
    where: and(eq(conversation.id, input.conversationId), eq(conversation.userId, input.userId)),
  });
  if (!convo) {
    return null;
  }
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(conversationRuntime.conversationId, input.conversationId),
    columns: {
      sessionId: true,
    },
  });

  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, input.conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) {
    return null;
  }

  const boundaryIndex = messages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX),
  );

  const sessionMessages = boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : messages;

  const trimmedMessages =
    input.messageLimit && sessionMessages.length > input.messageLimit
      ? sessionMessages.slice(-input.messageLimit)
      : sessionMessages;

  const excluded = new Set((input.excludeUserMessages || []).map((value) => value.trim()));

  const messagesForTranscript = trimmedMessages.filter((m) => {
    if (m.role === "user" && excluded.has(m.content.trim())) {
      return false;
    }
    return m.role === "user" || m.role === "assistant";
  });
  if (messagesForTranscript.length === 0) {
    return null;
  }

  const lastUser = [...messagesForTranscript].toReversed().find((m) => m.role === "user");
  const lastAssistant = [...messagesForTranscript].toReversed().find((m) => m.role === "assistant");
  const title = await generateConversationTitle(
    lastUser?.content ?? "",
    lastAssistant?.content ?? "",
  );

  const lines: string[] = [];
  for (const msg of messagesForTranscript) {
    const time = msg.createdAt ? format(msg.createdAt, "HH:mm") : "";
    if (msg.role === "assistant" && msg.contentParts && msg.contentParts.length > 0) {
      const textParts = msg.contentParts
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");
      lines.push(`**${msg.role} ${time}**\n${textParts || msg.content}`);
    } else {
      lines.push(`**${msg.role} ${time}**\n${msg.content}`);
    }
  }

  const startedAt = messagesForTranscript[0]?.createdAt ?? null;
  const endedAt = messagesForTranscript[messagesForTranscript.length - 1]?.createdAt ?? null;
  const transcriptTitle = title || "Session Transcript";
  const transcriptBody = lines.join("\n\n");
  const content = formatTranscriptMarkdown({
    title: transcriptTitle,
    metadata: [
      ["conversation_id", input.conversationId],
      ["session_id", runtime?.sessionId ?? null],
      ["source", input.source || "session_boundary"],
      ["messages", messagesForTranscript.length],
      ["started_at", startedAt ? startedAt.toISOString() : null],
      ["ended_at", endedAt ? endedAt.toISOString() : null],
    ],
    body: transcriptBody,
  });

  return writeSessionTranscript({
    userId: input.userId,
    conversationId: input.conversationId,
    sessionId: runtime?.sessionId ?? null,
    title: transcriptTitle,
    slug: title || null,
    date: endedAt ?? new Date(),
    source: input.source || "session_boundary",
    messageCount: messagesForTranscript.length,
    startedAt,
    endedAt,
    content,
  });
}

type TranscriptChunkRow = {
  id: string;
  transcriptId: string;
  content: string;
};

export async function searchSessionTranscripts(
  input: MemorySearchInput,
): Promise<MemorySearchResult[]> {
  const settings = await resolveMemorySettings(input.userId);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));

  let vectorRows: Array<TranscriptChunkRow & { distance: number }> = [];

  if (settings.provider === "openai") {
    const queryEmbedding = await embedTexts(input.userId, [input.query], settings.model);
    if (queryEmbedding && queryEmbedding[0]) {
      const distanceExpr = sql.raw(`embedding <=> '${toVectorLiteral(queryEmbedding[0])}'`);

      const vectorResult = await db.execute(sql`
        select
          ${sessionTranscriptChunk.id} as "id",
          ${sessionTranscriptChunk.transcriptId} as "transcriptId",
          ${sessionTranscriptChunk.content} as "content",
          ${distanceExpr} as "distance"
        from ${sessionTranscriptChunk}
        where ${sessionTranscriptChunk.userId} = ${input.userId}
          and ${sessionTranscriptChunk.embedding} is not null
        order by ${distanceExpr} asc
        limit ${limit * 2}
      `);

      vectorRows = (vectorResult.rows || []) as typeof vectorRows;
    }
  }

  const textResult = await db.execute(sql`
    select
      ${sessionTranscriptChunk.id} as "id",
      ${sessionTranscriptChunk.transcriptId} as "transcriptId",
      ${sessionTranscriptChunk.content} as "content",
      ts_rank_cd(to_tsvector('english', ${sessionTranscriptChunk.content}), plainto_tsquery('english', ${input.query})) as "rank"
    from ${sessionTranscriptChunk}
    where ${sessionTranscriptChunk.userId} = ${input.userId}
      and to_tsvector('english', ${sessionTranscriptChunk.content}) @@ plainto_tsquery('english', ${input.query})
    order by "rank" desc
    limit ${limit * 2}
  `);

  const textRows = (textResult.rows || []) as Array<TranscriptChunkRow & { rank: number }>;

  const locator = new Map<string, string>();
  for (const row of [...vectorRows, ...textRows]) {
    locator.set(row.id, row.transcriptId);
  }

  const scored = hybridRank(vectorRows, textRows, { limit });
  if (scored.length === 0) {
    return [];
  }

  const transcriptIds = Array.from(
    new Set(scored.map((row) => locator.get(row.id)).filter(Boolean)),
  ) as string[];
  const transcripts = await db.query.sessionTranscript.findMany({
    where: inArray(sessionTranscript.id, transcriptIds),
  });
  const transcriptMap = new Map(transcripts.map((t) => [t.id, t]));

  return scored.map((row) => {
    const transcriptId = locator.get(row.id) ?? "";
    const transcript = transcriptMap.get(transcriptId);
    const snippet = row.content.length > 240 ? `${row.content.slice(0, 240)}...` : row.content;
    return {
      id: row.id,
      fileId: transcriptId,
      entryId: null,
      entryTitle: transcript?.title ?? null,
      path: transcript ? getTranscriptPath(transcript) : "sessions/unknown.md",
      score: Number(row.score.toFixed(4)),
      snippet,
      source: "session",
    };
  });
}
