import { z } from "zod";
import { db } from "@cmdclaw/db/client";
import { conversationSessionSnapshot } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import {
  deleteFromS3,
  downloadFromS3,
  ensureBucket,
  uploadToS3,
} from "../storage/s3-client";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

const SNAPSHOT_CONTENT_TYPE = "application/json";

const opencodeSessionSnapshotSchema = z.object({
  info: z
    .object({
      id: z.string().min(1),
    })
    .passthrough(),
  messages: z.array(z.object({}).passthrough()),
});

export type OpencodeSessionSnapshotPayload = z.infer<typeof opencodeSessionSnapshotSchema>;

type SnapshotSandbox = {
  exec: (
    command: string,
    opts?: {
      timeoutMs?: number;
      env?: Record<string, string>;
      background?: boolean;
      onStderr?: (chunk: string) => void;
    },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFile: (path: string, content: string | ArrayBuffer) => Promise<void>;
};

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildConversationSessionSnapshotStorageKey(conversationId: string): string {
  return `opencode-session-snapshots/${conversationId}/latest.json`;
}

export function buildOpencodeExportCommand(sessionId: string): string {
  return `opencode export ${shellEscape(sessionId)}`;
}

function buildOpencodeImportCommand(filePath: string): string {
  return `opencode import ${shellEscape(filePath)}`;
}

export function extractEmbeddedJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new SyntaxError("OpenCode session snapshot payload is empty");
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall back to extracting the first valid JSON object from mixed CLI output.
  }

  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (char === "\\") {
          isEscaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        depth += 1;
        continue;
      }

      if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, index + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new SyntaxError("OpenCode session snapshot payload does not contain valid JSON");
}

function* extractEmbeddedJsonObjects(raw: string): Generator<unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }

  try {
    yield JSON.parse(trimmed);
    return;
  } catch {
    // Fall back to scanning mixed CLI output for embedded JSON objects.
  }

  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (char === "\\") {
          isEscaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        depth += 1;
        continue;
      }

      if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, index + 1);
          try {
            yield JSON.parse(candidate);
          } catch {
            // Keep scanning after incomplete or non-JSON brace sequences.
          }
          break;
        }
      }
    }
  }
}

export function normalizeOpencodeSessionSnapshotPayload(raw: string): {
  payload: OpencodeSessionSnapshotPayload;
  raw: string;
} {
  let sawJson = false;
  let lastValidationError: z.ZodError | undefined;

  for (const candidate of extractEmbeddedJsonObjects(raw)) {
    sawJson = true;
    const parsed = opencodeSessionSnapshotSchema.safeParse(candidate);
    if (parsed.success) {
      return {
        payload: parsed.data,
        raw: JSON.stringify(parsed.data),
      };
    }
    lastValidationError = parsed.error;
  }

  if (!sawJson) {
    throw new SyntaxError("OpenCode session snapshot payload does not contain valid JSON");
  }

  throw lastValidationError ?? new SyntaxError("OpenCode session snapshot payload is invalid");
}

export function parseOpencodeSessionSnapshotPayload(raw: string): OpencodeSessionSnapshotPayload {
  return normalizeOpencodeSessionSnapshotPayload(raw).payload;
}

async function getConversationSessionSnapshot(conversationId: string) {
  return (
    (await db.query.conversationSessionSnapshot.findFirst({
      where: eq(conversationSessionSnapshot.conversationId, conversationId),
    })) ?? null
  );
}

export async function saveConversationSessionSnapshot(input: {
  conversationId: string;
  sessionId: string;
  sandbox: SnapshotSandbox;
  exportedAt?: Date;
}): Promise<{
  sessionId: string;
  storageKey: string;
  exportedAt: Date;
}> {
  const exportResult = await input.sandbox.exec(buildOpencodeExportCommand(input.sessionId), {
    timeoutMs: 60_000,
  });
  if (exportResult.exitCode !== 0) {
    throw new Error(
      exportResult.stderr || exportResult.stdout || `Failed to export session ${input.sessionId}`,
    );
  }

  const normalizedSnapshot = normalizeOpencodeSessionSnapshotPayload(exportResult.stdout);
  const storageKey = buildConversationSessionSnapshotStorageKey(input.conversationId);
  const exportedAt = input.exportedAt ?? new Date();
  const snapshotBuffer = Buffer.from(normalizedSnapshot.raw, "utf8");

  console.info("[OpenCodeSessionSnapshot] Upload starting", {
    conversationId: input.conversationId,
    requestedSessionId: input.sessionId,
    exportedSessionId: normalizedSnapshot.payload.info.id,
    storageKey,
    snapshotBytes: snapshotBuffer.byteLength,
  });
  await ensureBucket();
  await uploadToS3(storageKey, snapshotBuffer, SNAPSHOT_CONTENT_TYPE);
  console.info("[OpenCodeSessionSnapshot] Upload completed", {
    conversationId: input.conversationId,
    exportedSessionId: normalizedSnapshot.payload.info.id,
    storageKey,
    snapshotBytes: snapshotBuffer.byteLength,
  });

  await db
    .insert(conversationSessionSnapshot)
    .values({
      conversationId: input.conversationId,
      sessionId: normalizedSnapshot.payload.info.id,
      storageKey,
      exportedAt,
    })
    .onConflictDoUpdate({
      target: conversationSessionSnapshot.conversationId,
      set: {
        sessionId: normalizedSnapshot.payload.info.id,
        storageKey,
        exportedAt,
        updatedAt: new Date(),
      },
    });

  return {
    sessionId: normalizedSnapshot.payload.info.id,
    storageKey,
    exportedAt,
  };
}

export async function clearConversationSessionSnapshot(conversationId: string): Promise<void> {
  const existing = await getConversationSessionSnapshot(conversationId);
  if (!existing) {
    return;
  }

  await db
    .delete(conversationSessionSnapshot)
    .where(eq(conversationSessionSnapshot.conversationId, conversationId));

  await deleteFromS3(existing.storageKey);
}

export async function restoreConversationSessionSnapshot(input: {
  conversationId: string;
  sandbox: SnapshotSandbox;
  client: OpencodeClient;
  tempFilePath?: string;
}): Promise<{ sessionId: string } | null> {
  const snapshot = await getConversationSessionSnapshot(input.conversationId);
  if (!snapshot) {
    return null;
  }

  const buffer = await downloadFromS3(snapshot.storageKey);
  const normalizedSnapshot = normalizeOpencodeSessionSnapshotPayload(buffer.toString("utf8"));
  const tempFilePath =
    input.tempFilePath ?? `/tmp/cmdclaw-opencode-session-${input.conversationId}.json`;

  await input.sandbox.writeFile(tempFilePath, normalizedSnapshot.raw);

  const importResult = await input.sandbox.exec(buildOpencodeImportCommand(tempFilePath), {
    timeoutMs: 60_000,
  });
  if (importResult.exitCode !== 0) {
    throw new Error(
      importResult.stderr || importResult.stdout || `Failed to import snapshot for ${snapshot.sessionId}`,
    );
  }

  const restored = await input.client.session.get({ sessionID: normalizedSnapshot.payload.info.id });
  if (restored.error || !restored.data) {
    throw new Error(
      `Imported session ${normalizedSnapshot.payload.info.id} could not be retrieved`,
    );
  }

  return { sessionId: normalizedSnapshot.payload.info.id };
}
