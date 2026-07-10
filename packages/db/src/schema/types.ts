
export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | {
      type: "approval";
      tool_use_id: string;
      tool_name: string;
      tool_input: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
      question_answers?: string[][];
    }
  | {
      type: "coworker_invocation";
      coworker_id: string;
      username: string;
      name: string;
      run_id: string;
      conversation_id: string;
      generation_id: string | null;
      status:
        | "running"
        | "needs_user_input"
        | "awaiting_approval"
        | "awaiting_auth"
        | "paused"
        | "cancelling"
        | "completed"
        | "error"
        | "cancelled";
      attachment_names?: string[];
      message: string;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

export type GenerationFailureKind =
  | "runner_declared_failure"
  | "internal_error"
  | "provider_error"
  | "auth_error"
  | "approval_timeout"
  | "runtime_timeout"
  | "sandbox_error";

export type MessageTiming = {
  sandboxStartupDurationMs?: number;
  sandboxStartupMode?: "created" | "reused" | "unknown";
  generationDurationMs?: number;
  phaseDurationsMs?: {
    // Time spent connecting to a reusable sandbox or creating a new sandbox.
    sandboxConnectOrCreateMs?: number;
    // Time from starting the runtime server inside sandbox to runtime readiness.
    opencodeReadyMs?: number;
    // Time to reuse/create an OpenCode session after sandbox is ready.
    sessionReadyMs?: number;
    // Total agent initialization time (sandbox + runtime + session setup).
    agentInitMs?: number;
    // Time spent in pre-prompt setup before prompt dispatch (skills/memory/instructions prep).
    prePromptSetupMs?: number;
    // Time spent syncing memory files into the sandbox before prompt dispatch.
    prePromptMemorySyncMs?: number;
    // Time spent writing runtime callback/context metadata into the sandbox.
    prePromptRuntimeContextWriteMs?: number;
    // Time spent resolving Workspace MCP Servers before prompt dispatch.
    prePromptWorkspaceMcpResolveMs?: number;
    // Time spent loading enabled skill metadata and custom integration credentials.
    prePromptSkillsAndCredsLoadMs?: number;
    // Time spent reading the reusable sandbox pre-prompt cache.
    prePromptCacheReadMs?: number;
    // Time spent writing custom skills into the sandbox.
    prePromptSkillsWriteMs?: number;
    // Time spent writing generated custom integration CLI files into the sandbox.
    prePromptCustomIntegrationCliWriteMs?: number;
    // Time spent configuring custom integration permissions inside the sandbox.
    prePromptCustomIntegrationPermissionsWriteMs?: number;
    // Time spent writing integration skills into the sandbox.
    prePromptIntegrationSkillsWriteMs?: number;
    // Time spent writing the reusable sandbox pre-prompt cache.
    prePromptCacheWriteMs?: number;
    // Time spent composing the final prompt spec after sandbox preparation.
    prePromptPromptSpecComposeMs?: number;
    // Time spent subscribing to runtime events before prompt dispatch.
    prePromptEventStreamSubscribeMs?: number;
    // Time spent staging coworker documents into the sandbox.
    prePromptCoworkerDocsStageMs?: number;
    // Time spent staging user attachments into the sandbox and prompt parts.
    prePromptAttachmentsStageMs?: number;
    // Time from prompt dispatch to first received generation stream event.
    waitForFirstEventMs?: number;
    // Time from prompt dispatch to first emitted assistant text token.
    promptToFirstTokenMs?: number;
    // Time from generation start to first emitted assistant text token.
    generationToFirstTokenMs?: number;
    // Time from prompt dispatch to first user-visible output (thinking or text).
    promptToFirstVisibleOutputMs?: number;
    // Time from generation start to first user-visible output (thinking or text).
    generationToFirstVisibleOutputMs?: number;
    // Time spent streaming model output after first event until session becomes idle.
    modelStreamMs?: number;
    // Time spent after model output completes (file collection, persistence, cleanup).
    postProcessingMs?: number;
  };
  phaseTimestamps?: Array<{
    phase: string;
    at: string;
    elapsedMs: number;
  }>;
};

export type PendingApproval = {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestedAt: string;
  expiresAt?: string;
  integration: string;
  operation: string;
  command?: string;
  decision?: "allow" | "deny";
  questionAnswers?: string[][];
  opencodeRequestKind?: "permission" | "question";
  opencodeRequestId?: string;
  opencodeDefaultAnswers?: string[][];
};

// Auth state stored in generation
export type PendingAuth = {
  integrations: string[]; // Integration types needed
  connectedIntegrations: string[]; // Already connected during this request
  requestedAt: string;
  expiresAt?: string;
  reason?: string;
};

export type GenerationExecutionPolicy = {
  allowedIntegrations?: string[];
  allowedCustomIntegrations?: string[];
  allowedWorkspaceMcpServerIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: {
    targetEnv: "staging" | "prod";
    remoteUserId: string;
    requestedByUserId?: string;
    requestedByEmail?: string | null;
    remoteUserEmail?: string | null;
  };
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  allowSnapshotRestoreOnRun?: boolean;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  queuedFileAttachments?: QueuedMessageAttachment[];
  queuedUserMessageContent?: string;
};

export type QueuedFileAssetAttachment = {
  fileAssetId: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type QueuedMessageAttachment = QueuedFileAssetAttachment;

export type GenerationInterruptDisplay = {
  title: string;
  integration?: string;
  operation?: string;
  command?: string;
  toolInput?: Record<string, unknown>;
  runtimeTool?: {
    sessionId?: string;
    messageId: string;
    partId: string;
    callId: string;
    toolName: string;
    input: Record<string, unknown>;
  };
  questionSpec?: {
    questions: Array<{
      header: string;
      question: string;
      options: Array<{
        label: string;
        description?: string;
      }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
  };
  authSpec?: {
    integrations: string[];
    reason?: string;
  };
};

export type GenerationInterruptResponsePayload = {
  questionAnswers?: string[][];
  connectedIntegrations?: string[];
  tokens?: Record<string, string>;
  integration?: string;
};
