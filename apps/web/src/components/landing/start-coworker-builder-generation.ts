import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import type { AttachmentData } from "@/components/prompt-bar";
import { client } from "@/orpc/client";

export type StartCoworkerBuilderGenerationInput = {
  coworkerId: string;
  content: string;
  model: string;
  authSource: ProviderAuthSource | null;
  attachments?: AttachmentData[];
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
};

export async function startCoworkerBuilderGeneration({
  coworkerId,
  content,
  model,
  authSource,
  attachments,
  debugRunDeadlineMs,
  debugApprovalHotWaitMs,
}: StartCoworkerBuilderGenerationInput) {
  const { conversationId } = await client.coworker.getOrCreateBuilderConversation({
    id: coworkerId,
  });

  await client.generation.startGeneration({
    conversationId,
    content,
    model,
    authSource,
    autoApprove: true,
    fileAttachments: attachments,
    ...(debugRunDeadlineMs !== undefined ? { debugRunDeadlineMs } : {}),
    ...(debugApprovalHotWaitMs !== undefined ? { debugApprovalHotWaitMs } : {}),
  });
}
