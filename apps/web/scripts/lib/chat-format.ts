import type { RouterClient } from "@orpc/server";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve, extname } from "node:path";
import type { StatusChangeMetadata } from "@/lib/generation-stream";
import type { AppRouter } from "@/server/orpc";

export function formatToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatClockTime(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

export function formatStatusMetadata(metadata: StatusChangeMetadata | undefined): string | null {
  if (!metadata) {
    return null;
  }

  const parts = [
    metadata.sandboxProvider ? `provider=${metadata.sandboxProvider}` : null,
    metadata.runtimeHarness ? `harness=${metadata.runtimeHarness}` : null,
    metadata.runtimeProtocolVersion ? `protocol=${metadata.runtimeProtocolVersion}` : null,
    metadata.sandboxId ? `sandbox_id=${metadata.sandboxId}` : null,
    metadata.sessionId ? `session_id=${metadata.sessionId}` : null,
  ].filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(" ") : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

export function fileToAttachment(filePath: string): {
  name: string;
  mimeType: string;
  dataUrl: string;
} {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const data = readFileSync(resolved);
  const base64 = data.toString("base64");
  return {
    name: basename(resolved),
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export async function validatePersistedAssistantMessage(
  client: RouterClient<AppRouter>,
  conversationId: string,
  messageId: string,
  expected: { content: string; parts: Array<{ type: string }> },
): Promise<void> {
  const conv = await client.conversation.get({ id: conversationId });
  const savedMessage = conv.messages.find((m) => m.id === messageId);

  if (!savedMessage) {
    throw new Error(
      `Validation failed: assistant message ${messageId} was not saved in conversation ${conversationId}`,
    );
  }
  if (savedMessage.role !== "assistant") {
    throw new Error(
      `Validation failed: message ${messageId} saved with role ${savedMessage.role}, expected assistant`,
    );
  }

  const persistedParts = Array.isArray(savedMessage.contentParts) ? savedMessage.contentParts : [];
  if (expected.parts.length > 0 && persistedParts.length === 0) {
    throw new Error(
      "Validation failed: stream produced activity/text but saved message has no contentParts",
    );
  }

  const normalizedStream = normalizeText(expected.content);
  if (normalizedStream.length === 0) {
    return;
  }

  const normalizedPersisted = normalizeText(savedMessage.content ?? "");
  if (!normalizedPersisted.includes(normalizedStream)) {
    throw new Error(
      "Validation failed: streamed assistant text does not match saved message content",
    );
  }
}
