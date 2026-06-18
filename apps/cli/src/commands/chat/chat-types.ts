import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";

export type ChatState = {
  authSource?: ProviderAuthSource | null;
  connectedProviderIds?: string[];
  conversationId?: string;
  perfettoTrace: boolean;
  sharedConnectedProviderIds?: string[];
  timing: boolean;
  file: readonly string[];
  message?: string;
  model?: string;
  questionAnswer: readonly string[];
  sandbox?: "e2b" | "daytona" | "docker";
  server?: string;
  autoApprove?: boolean;
  open: boolean;
  chaosApproval: "ask" | "defer";
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  validate: boolean;
  continueAfterMessage?: boolean;
};

export type ChatGenerationTarget =
  | {
      kind: "start";
      content: string;
      conversationId?: string;
      attachments?: { name: string; mimeType: string; dataUrl: string }[];
      debugRunDeadlineMsOverride?: number;
      resumePausedGenerationId?: string;
    }
  | {
      kind: "attach";
      generationId: string;
      suppressReplayRuntimeMetadataUntilDecision?: boolean;
    };

export type ActiveConversationGeneration = {
  generationId: string | null;
  startedAt: string | null;
  errorMessage: string | null;
  status: string | null;
  pauseReason: string | null;
  debugRunDeadlineMs: number | null;
};
