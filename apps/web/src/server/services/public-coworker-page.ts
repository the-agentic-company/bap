import { downloadFromS3, getPresignedDownloadUrl } from "@bap/core/server/storage/s3-client";
import { db } from "@bap/db/client";
import { conversation, coworker, coworkerRun, generation, message } from "@bap/db/schema";
import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { PersistedConversationMessage } from "@/components/chat/persisted-message-mapper";
import { AGENTIC_APP_FILENAME, AGENTIC_APP_MAX_BYTES } from "@/server/services/agentic-app-html";

type PublicCoworkerRun = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  conversationId: string | null;
};

type PublicSandboxFile = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  downloadUrl: string | null;
};

export type PublicCoworkerPageData = {
  coworker: {
    id: string;
    name: string;
    description: string | null;
    username: string | null;
    sharedAt: string;
  };
  runs: PublicCoworkerRun[];
  selectedRun: PublicCoworkerRun | null;
  messages: PersistedConversationMessage[];
  outputFile: PublicSandboxFile | null;
  outputHtml: string | null;
  definitionJson: string;
};

function serializeDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.toISOString();
}

function isAgenticAppHtmlMimeType(mimeType: string | null): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}

async function toPublicSandboxFile(file: {
  id: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  storageKey: string | null;
}): Promise<PublicSandboxFile> {
  return {
    fileId: file.id,
    path: file.path,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    downloadUrl: file.storageKey ? await getPresignedDownloadUrl(file.storageKey) : null,
  };
}

async function loadPublicOutputHtml(file: {
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
}): Promise<string | null> {
  if (
    file.filename !== AGENTIC_APP_FILENAME ||
    !isAgenticAppHtmlMimeType(file.mimeType) ||
    !file.storageKey ||
    (file.sizeBytes !== null && file.sizeBytes > AGENTIC_APP_MAX_BYTES)
  ) {
    return null;
  }

  const body = await downloadFromS3(file.storageKey);
  if (body.length > AGENTIC_APP_MAX_BYTES) {
    return null;
  }
  return body.toString("utf8");
}

function decodePublicSlug(slug: string): string | null {
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

function findPublicOutputFile(
  messages: Array<{ sandboxFiles?: PublicSandboxFile[] }>,
  fileId: string,
): PublicSandboxFile | null {
  return (
    messages
      .toReversed()
      .flatMap((msg) => (msg.sandboxFiles ?? []).toReversed())
      .find((file) => file.fileId === fileId) ?? null
  );
}

export async function getPublicCoworkerPage(params: {
  slug: string;
  runId?: string;
}): Promise<PublicCoworkerPageData | null> {
  const decodedSlug = decodePublicSlug(params.slug);
  if (!decodedSlug) {
    return null;
  }

  const coworkerRow = await db.query.coworker.findFirst({
    where: and(
      isNotNull(coworker.publishedAt),
      or(eq(coworker.username, decodedSlug), eq(coworker.id, decodedSlug)),
    ),
    columns: {
      id: true,
      name: true,
      description: true,
      username: true,
      publishedAt: true,
      triggerType: true,
      prompt: true,
      model: true,
      autoApprove: true,
      toolAccessMode: true,
      allowedIntegrations: true,
      allowedCustomIntegrations: true,
      allowedSkillSlugs: true,
      schedule: true,
      requiresUserInput: true,
      userInputPrompt: true,
    },
  });

  if (!coworkerRow?.publishedAt) {
    return null;
  }

  // Publication is a portable-copy surface, not live access to source Workspace runs.
  const runRows: Array<typeof coworkerRun.$inferSelect> = [];

  const selectedRunRow =
    (params.runId ? runRows.find((run) => run.id === params.runId) : undefined) ?? runRows[0];
  const selectedConversationId = selectedRunRow?.conversationId
    ? selectedRunRow.conversationId
    : selectedRunRow?.generationId
      ? (
          await db.query.generation.findFirst({
            where: eq(generation.id, selectedRunRow.generationId),
            columns: { conversationId: true },
          })
        )?.conversationId
      : null;

  const conv = selectedConversationId
    ? await db.query.conversation.findFirst({
        where: and(eq(conversation.id, selectedConversationId), isNull(conversation.syntheticKind)),
        with: {
          messages: {
            orderBy: asc(message.createdAt),
            with: {
              attachments: true,
              sandboxFiles: true,
            },
          },
        },
      })
    : null;

  const visibleMessages = (conv?.messages ?? []).filter(
    (msg) => msg.role === "user" || msg.role === "assistant",
  );

  const messages = await Promise.all(
    visibleMessages.map(async (msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      contentParts: msg.contentParts,
      timing: msg.timing,
      createdAt: msg.createdAt,
      attachments: await Promise.all(
        (msg.attachments ?? []).map(async (attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          previewUrl: await getPresignedDownloadUrl(attachment.storageKey),
        })),
      ),
      sandboxFiles: await Promise.all(
        (msg.sandboxFiles ?? []).map((file) => toPublicSandboxFile(file)),
      ),
    })),
  );

  const outputFileRow = visibleMessages
    .toReversed()
    .flatMap((msg) => (msg.sandboxFiles ?? []).toReversed())
    .find((file) => file.filename === AGENTIC_APP_FILENAME);
  const outputFile = outputFileRow ? findPublicOutputFile(messages, outputFileRow.id) : null;
  const outputHtml = outputFileRow ? await loadPublicOutputHtml(outputFileRow) : null;

  const runs = runRows.map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: serializeDate(run.finishedAt),
    conversationId: run.conversationId ?? null,
  }));

  return {
    coworker: {
      id: coworkerRow.id,
      name: coworkerRow.name,
      description: coworkerRow.description,
      username: coworkerRow.username,
      sharedAt: coworkerRow.publishedAt.toISOString(),
    },
    runs,
    selectedRun: selectedRunRow
      ? {
          id: selectedRunRow.id,
          status: selectedRunRow.status,
          startedAt: selectedRunRow.startedAt.toISOString(),
          finishedAt: serializeDate(selectedRunRow.finishedAt),
          conversationId: selectedConversationId ?? null,
        }
      : null,
    messages: messages as PersistedConversationMessage[],
    outputFile,
    outputHtml,
    definitionJson: JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        coworker: {
          name: coworkerRow.name,
          description: coworkerRow.description,
          username: coworkerRow.username,
          status: "off",
          triggerType: coworkerRow.triggerType,
          prompt: coworkerRow.prompt,
          model: coworkerRow.model,
          authSource: null,
          autoApprove: coworkerRow.autoApprove,
          toolAccessMode: coworkerRow.toolAccessMode ?? "all",
          allowedIntegrations: coworkerRow.allowedIntegrations,
          allowedCustomIntegrations: coworkerRow.allowedCustomIntegrations,
          allowedWorkspaceMcpServerIds: [],
          allowedSkillSlugs: coworkerRow.allowedSkillSlugs,
          schedule: coworkerRow.schedule,
          requiresUserInput: coworkerRow.requiresUserInput,
          userInputPrompt: coworkerRow.userInputPrompt,
        },
        documents: [],
        artifacts: [],
      },
      null,
      2,
    ),
  };
}
