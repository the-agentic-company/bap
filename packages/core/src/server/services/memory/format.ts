import { format, parseISO, isValid } from "date-fns";
import crypto from "node:crypto";
import {
  memoryEntry,
  memoryFile,
  sessionTranscript,
} from "@bap/db/schema";

export type MemoryFileType = "longterm" | "daily";

export interface MemoryWriteInput {
  userId: string;
  type?: MemoryFileType;
  path?: string;
  date?: string;
  title?: string;
  tags?: string[];
  content: string;
}

export interface MemoryGetInput {
  userId: string;
  path: string;
}

export type MemoryFileRow = typeof memoryFile.$inferSelect;
export type MemoryEntryRow = typeof memoryEntry.$inferSelect;
export type SessionTranscriptRow = typeof sessionTranscript.$inferSelect;

export const MEMORY_BASE_PATH = "/app/bap";
export const SESSION_BASE_PATH = "/app/bap/sessions";

export function getMemoryBasePath(): string {
  return MEMORY_BASE_PATH;
}

export function getSessionBasePath(): string {
  return SESSION_BASE_PATH;
}

export function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function formatDateOnly(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

export function formatTimeOnly(value: Date): string {
  return format(value, "HH:mm");
}

export function parseDateInput(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    return null;
  }
  return parsed;
}

export function resolveFileType(input: MemoryWriteInput | MemoryGetInput): {
  type: MemoryFileType;
  date: Date | null;
} | null {
  const path = "path" in input ? input.path : undefined;
  if (path) {
    const normalized = path.trim().replace(/^\//, "");
    if (normalized.toLowerCase() === "memory.md" || normalized === "MEMORY.md") {
      return { type: "longterm", date: null };
    }
    const match = normalized.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/i);
    if (match?.[1]) {
      const parsed = parseDateInput(match[1]);
      if (!parsed) {
        return null;
      }
      return { type: "daily", date: parsed };
    }
  }

  if ("type" in input) {
    const type = input.type || "daily";
    if (type === "longterm") {
      return { type, date: null };
    }
    const parsed = parseDateInput(input.date) || new Date();
    return { type, date: parsed };
  }

  return null;
}

export function getFilePath(file: MemoryFileRow): string {
  if (file.type === "longterm") {
    return "MEMORY.md";
  }
  if (!file.date) {
    return "memory/unknown.md";
  }
  return `memory/${formatDateOnly(file.date)}.md`;
}

export function getTranscriptPath(transcript: SessionTranscriptRow): string {
  return transcript.path;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export function formatEntryMarkdown(
  file: MemoryFileRow,
  entry: MemoryEntryRow,
): string {
  const createdAt = entry.createdAt || new Date();
  const timeLabel = formatTimeOnly(createdAt);
  const title = entry.title?.trim();
  const header =
    file.type === "daily"
      ? `## ${timeLabel}${title ? ` - ${title}` : ""}`
      : `## ${title || format(createdAt, "yyyy-MM-dd HH:mm")}`;

  const tags =
    entry.tags && entry.tags.length > 0
      ? `\n\nTags: ${entry.tags.map((t) => `#${t}`).join(" ")}`
      : "";

  return `${header}\n\n${entry.content.trim()}${tags}`.trim();
}

export function buildEntryEmbeddingText(entry: MemoryEntryRow): string {
  const lines = [];
  if (entry.title) {
    lines.push(`Title: ${entry.title}`);
  }
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`Tags: ${entry.tags.join(", ")}`);
  }
  lines.push(entry.content.trim());
  return lines.filter(Boolean).join("\n");
}

export function formatTranscriptMarkdown(params: {
  title: string;
  metadata: Array<[string, string | number | null | undefined]>;
  body: string;
}): string {
  const metaLines = params.metadata
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `- ${label}: ${value}`);
  const metaBlock = metaLines.length > 0 ? metaLines.join("\n") : "";
  const parts = [
    `# ${params.title}`,
    metaBlock ? `\n${metaBlock}\n` : "",
    params.body.trim(),
  ].filter(Boolean);
  return parts.join("\n\n").trim() + "\n";
}

export function buildMemorySystemPrompt(): string {
  return `
# Memory

You have access to persistent memory tools:
- memory_search: find relevant past notes and decisions
- memory_get: read a specific memory file
- memory_write: store durable facts, preferences, and decisions

Memory files are materialized in ${MEMORY_BASE_PATH}:
- ${MEMORY_BASE_PATH}/MEMORY.md (long-term)
- ${MEMORY_BASE_PATH}/memory/YYYY-MM-DD.md (daily logs)
- ${SESSION_BASE_PATH}/YYYY-MM-DD-HHMMSS-<slug>.md (session transcripts)

Use memory_search before answering questions about past work, preferences, or decisions.
When you learn something durable, write it to memory_write (daily logs for ongoing work, MEMORY.md for long-term facts).
`;
}

export function chunkMarkdown(
  content: string,
  chunking: { tokens: number; overlap: number },
): Array<{ startLine: number; endLine: number; text: string; hash: string }> {
  const lines = content.split("\n");
  if (lines.length === 0) {
    return [];
  }

  const maxChars = Math.max(32, chunking.tokens * 4);
  const overlapChars = Math.max(0, chunking.overlap * 4);
  const chunks: Array<{
    startLine: number;
    endLine: number;
    text: string;
    hash: string;
  }> = [];

  let current: Array<{ line: string; lineNo: number }> = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) {
      return;
    }
    const text = current.map((entry) => entry.line).join("\n");
    chunks.push({
      startLine: first.lineNo,
      endLine: last.lineNo,
      text,
      hash: hashText(text),
    });
  };

  const carryOverlap = () => {
    if (overlapChars <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) {
        continue;
      }
      acc += entry.line.length + 1;
      kept.unshift(entry);
      if (acc >= overlapChars) {
        break;
      }
    }
    current = kept;
    currentChars = kept.reduce((sum, entry) => sum + entry.line.length + 1, 0);
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const nextLen = line.length + 1;

    if (currentChars + nextLen > maxChars && current.length > 0) {
      flush();
      carryOverlap();
    }

    current.push({ line, lineNo });
    currentChars += nextLen;
  });

  flush();
  return chunks;
}
