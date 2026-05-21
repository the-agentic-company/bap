import type {
  ContentPart,
  GenerationExecutionPolicy,
  MessageTiming,
  PendingApproval,
  PendingAuth,
  QueuedMessageAttachment,
} from "@cmdclaw/db/schema";
import type { ProviderAuthSource } from "../../../lib/provider-auth-source";
import type { RuntimePart } from "../../sandbox/core/types";
import type { SandboxBackend } from "../../sandbox/types";
import type { OpenCodeRuntimeToolRef } from "../../runtime/opencode/opencode-event-translator";
import type {
  GenerationCompletionReason,
  RuntimeFailureClassification,
} from "../lifecycle-policy";
import type { RemoteIntegrationSource } from "../../integrations/remote-integrations";
import type { CoworkerBuilderContext } from "../coworker-builder-service";
import type { GenerationInterruptEventPayload } from "../generation-interrupt-service";
import type { IntegrationType } from "../../oauth/config";

export type GenerationTurnKind = "chat" | "coworker";

export type GenerationStatus =
  | "running"
  | "awaiting_approval"
  | "awaiting_auth"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

export type GenerationTerminalStatus = "completed" | "cancelled" | "error";

export type StartedGeneration = {
  generationId: string;
  conversationId: string;
};

export type GenerationEvent =
  | { type: "text"; content: string }
  | { type: "system"; content: string; coworkerId?: string }
  | {
      type: "tool_use";
      toolName: string;
      toolInput: unknown;
      toolUseId?: string;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "tool_result"; toolName: string; result: unknown; toolUseId?: string }
  | { type: "thinking"; content: string; thinkingId: string }
  | ({ type: "interrupt_pending" } & GenerationInterruptEventPayload)
  | ({ type: "interrupt_resolved" } & GenerationInterruptEventPayload)
  | {
      type: "sandbox_file";
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes: number | null;
    }
  | {
      type: "done";
      generationId: string;
      conversationId: string;
      messageId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalCostUsd: number;
      };
      artifacts?: {
        timing?: MessageTiming;
        attachments: Array<{
          id: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        }>;
        sandboxFiles: Array<{
          fileId: string;
          path: string;
          filename: string;
          mimeType: string;
          sizeBytes: number | null;
        }>;
      };
    }
  | { type: "error"; message: string; diagnosticMessage?: string }
  | {
      type: "cancelled";
      generationId: string;
      conversationId: string;
      messageId?: string;
    }
  | {
      type: "status_change";
      status: string;
      metadata?: {
        runtimeId?: string;
        sandboxProvider?: "e2b" | "daytona" | "docker";
        runtimeHarness?: "opencode" | "agent-sdk";
        runtimeProtocolVersion?: "opencode-v2" | "sandbox-agent-v1";
        sandboxId?: string;
        sessionId?: string;
        parkedInterruptId?: string;
        releasedSandboxId?: string;
      };
    };

export type GenerationStreamEvent = GenerationEvent & {
  cursor?: string;
};

export type GenerationStatusView = {
  status: GenerationStatus;
  contentParts: ContentPart[];
  pendingApproval: PendingApproval | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type QueuedConversationTurn = {
  id: string;
  content: string;
  fileAttachments?: QueuedMessageAttachment[];
  selectedPlatformSkillSlugs?: string[];
  status: "queued" | "processing";
  createdAt: Date;
};

export type UserFileAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type StartChatGenerationInput = {
  conversationId?: string;
  content: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  userId: string;
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  resumePausedGenerationId?: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  allowedIntegrations?: IntegrationType[];
  fileAttachments?: UserFileAttachment[];
  selectedPlatformSkillSlugs?: string[];
};

export type StartCoworkerGenerationInput = {
  coworkerId: string;
  coworkerRunId: string;
  content: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  userId: string;
  workspaceId?: string | null;
  autoApprove: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  allowedIntegrations: IntegrationType[];
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  fileAttachments?: UserFileAttachment[];
};

export type GenerationRunMode = "normal_run" | "recovery_reattach";

export type GenerationBackendType = "opencode";

export type RemoteRunDebugPhase =
  | "remote_credentials_fetched"
  | "sandbox_created"
  | "prompt_sent"
  | "session_error";

export type GenerationDebugInfo = {
  originalErrorMessage?: string | null;
  originalErrorName?: string | null;
  originalErrorPhase?: string | null;
  originalErrorAt?: string | null;
  runtimeFailure?: RuntimeFailureClassification | null;
  remoteRun?: {
    targetEnv?: RemoteIntegrationSource["targetEnv"];
    remoteUserId?: string;
    remoteUserEmail?: string | null;
    allowedIntegrations?: string[];
    attachedTokenEnvVarNames?: string[];
    phases?: Partial<Record<RemoteRunDebugPhase, string>>;
    sessionErrorMessage?: string | null;
  } | null;
};

export interface GenerationContext {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  workspaceId?: string | null;
  sandboxId?: string;
  status: GenerationStatus;
  executionPolicy: GenerationExecutionPolicy;
  deadlineAt: Date;
  remainingRunMs: number;
  approvalHotWaitMs: number;
  suspendedAt?: Date | null;
  resumeInterruptId?: string | null;
  lastRuntimeEventAt: Date;
  recoveryAttempts: number;
  completionReason?: GenerationCompletionReason | null;
  debugInfo?: GenerationDebugInfo;
  contentParts: ContentPart[];
  assistantContent: string;
  abortController: AbortController;
  pendingApproval: PendingApproval | null;
  approvalTimeoutId?: ReturnType<typeof setTimeout>;
  approvalParkTimeoutId?: ReturnType<typeof setTimeout>;
  externalInterruptPollIntervalId?: ReturnType<typeof setInterval>;
  approvalResolver?: (decision: "allow" | "deny") => void;
  pendingAuth: PendingAuth | null;
  authTimeoutId?: ReturnType<typeof setTimeout>;
  authResolver?: (result: { success: boolean; userId?: string }) => void;
  currentInterruptId?: string;
  runtimeCallbackToken?: string;
  runtimeId?: string;
  runtimeTurnSeq?: number;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  sessionId?: string;
  errorMessage?: string;
  startedAt: Date;
  lastSaveAt: Date;
  saveDebounceId?: ReturnType<typeof setTimeout>;
  isNewConversation: boolean;
  model: string;
  authSource?: ProviderAuthSource | null;
  userMessageContent: string;
  attachments?: UserFileAttachment[];
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<
    string,
    {
      firstQueuedAtMs: number;
      parts: RuntimePart[];
    }
  >;
  openCodeRuntimeTools: Map<string, OpenCodeRuntimeToolRef>;
  backendType: GenerationBackendType;
  sandboxProviderOverride?: "e2b" | "daytona" | "docker";
  coworkerId?: string;
  coworkerRunId?: string;
  allowedIntegrations?: IntegrationType[];
  autoApprove: boolean;
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  coworkerPrompt?: string;
  coworkerPromptDo?: string;
  coworkerPromptDont?: string;
  triggerPayload?: unknown;
  builderCoworkerContext?: CoworkerBuilderContext | null;
  selectedPlatformSkillSlugs?: string[];
  generationMarkerTime?: number;
  sandbox?: SandboxBackend;
  sentFilePaths?: Set<string>;
  userStagedFilePaths?: Set<string>;
  uploadedSandboxFileIds?: Set<string>;
  agentInitStartedAt?: number;
  agentInitReadyAt?: number;
  agentInitFailedAt?: number;
  agentSandboxReadyAt?: number;
  agentSandboxMode?: "created" | "reused" | "unknown";
  phaseMarks?: Record<string, number>;
  phaseTimeline?: Array<{
    phase: string;
    atMs: number;
    elapsedMs: number;
  }>;
  streamSequence: number;
  streamPublishedCount: number;
  streamDeliveredCount: number;
  streamLastCursor?: string;
  streamFirstVisiblePublishedAt?: number;
  streamTerminalPublishedAt?: number;
  lastCancellationCheckAt?: number;
  isFinalizing?: boolean;
  sandboxSlotLeaseToken?: string;
  sandboxSlotLeaseRenewId?: ReturnType<typeof setInterval>;
  abortForInterruptPark?: boolean;
}
