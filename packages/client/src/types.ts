import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import type { RuntimeAssistantMessage } from "./generation-runtime";

export type BapProfile = {
  serverUrl: string;
  token: string;
};

export type BapUser = {
  id: string;
  email: string;
};

export type ProviderAuthStatus = {
  connected?: Record<string, unknown>;
  shared?: Record<string, unknown>;
};

export type FreeModel = {
  id: string;
  name: string;
};

export type FreeModelsResponse = {
  models: FreeModel[];
};

export type SkillImportInput = {
  mode: "folder";
  files: Array<{
    path: string;
    mimeType?: string;
    contentBase64: string;
  }>;
};

export type SkillImportResult = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
};

export type IntegrationSummary = {
  id: string;
  type: string;
  displayName: string | null;
  enabled: boolean;
  setupRequired?: boolean;
  instanceName?: string | null;
  instanceUrl?: string | null;
  authStatus: string | null;
  authErrorCode: string | null;
  scopes: string[] | null;
  accountLabelId: string | null;
  accountLabel: string | null;
  createdAt: string | Date;
};

export type SkillSummary = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string | null;
  enabled: boolean;
  visibility: "private" | "public";
  isOwnedByCurrentUser?: boolean;
  canEdit?: boolean;
  fileCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SkillDetail = SkillSummary & {
  files: Array<{
    id: string;
    path: string;
    content: string;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  documents: Array<{
    id: string;
    filename: string;
    path: string;
    mimeType: string;
    sizeBytes: number | null;
    description: string | null;
    createdAt: string | Date;
  }>;
};

export type WorkspaceMember = {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  [key: string]: unknown;
};

export type WorkspaceMcpServerAuthType = "none" | "api_key" | "bearer" | "oauth2";

export type WorkspaceMcpServerInput = {
  kind?: "mcp";
  name: string;
  namespace: string;
  endpoint: string;
  specUrl?: string | null;
  transport?: string | null;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  defaultHeaders?: Record<string, string>;
  authType?: WorkspaceMcpServerAuthType;
  authHeaderName?: string | null;
  authQueryParam?: string | null;
  authPrefix?: string | null;
  enabled?: boolean;
};

export type WorkspaceMcpServerSummary = {
  id: string;
  name: string;
  namespace: string;
  endpoint: string;
  kind: string;
  authType: string;
  enabled: boolean;
  [key: string]: unknown;
};

export type GenerationUsage = {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
};

export type StatusChangeMetadata = {
  runtimeId?: string;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  runtimeHarness?: "opencode" | "agent-sdk";
  runtimeProtocolVersion?: "opencode-v2" | "sandbox-agent-v1";
  sandboxId?: string;
  sessionId?: string;
  parkedInterruptId?: string;
  releasedSandboxId?: string;
};

export type SandboxFileData = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type GenerationPendingApprovalData = {
  interruptId: string;
  generationId: string;
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type GenerationApprovalData = {
  interruptId?: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  status: "approved" | "denied";
  questionAnswers?: string[][];
};

export type AuthNeededData = {
  interruptId: string;
  generationId: string;
  conversationId: string;
  integrations: string[];
  reason?: string;
};

export type ThinkingData = {
  content: string;
  thinkingId: string;
};

export type ToolUseData = {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type DoneArtifactsData = {
  timing?: {
    sandboxStartupDurationMs?: number;
    sandboxStartupMode?: "created" | "reused" | "unknown";
    generationDurationMs?: number;
    phaseDurationsMs?: {
      sandboxInitMs?: number;
      sandboxConnectOrCreateMs?: number;
      sandboxCreateMs?: number;
      opencodeReadyMs?: number;
      sessionReadyMs?: number;
      agentInitMs?: number;
      prePromptSetupMs?: number;
      prePromptMemorySyncMs?: number;
      prePromptRuntimeContextWriteMs?: number;
      prePromptWorkspaceMcpResolveMs?: number;
      prePromptSkillsAndCredsLoadMs?: number;
      prePromptCacheReadMs?: number;
      prePromptSkillsWriteMs?: number;
      prePromptCustomIntegrationCliWriteMs?: number;
      prePromptCustomIntegrationPermissionsWriteMs?: number;
      prePromptIntegrationSkillsWriteMs?: number;
      prePromptCacheWriteMs?: number;
      prePromptPromptSpecComposeMs?: number;
      prePromptEventStreamSubscribeMs?: number;
      prePromptCoworkerDocsStageMs?: number;
      prePromptAttachmentsStageMs?: number;
      waitForFirstEventMs?: number;
      promptToFirstTokenMs?: number;
      generationToFirstTokenMs?: number;
      promptToFirstVisibleOutputMs?: number;
      generationToFirstVisibleOutputMs?: number;
      modelStreamMs?: number;
      postProcessingMs?: number;
    };
    phaseTimestamps?: Array<{
      phase: string;
      at: string;
      elapsedMs: number;
    }>;
  };
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles: SandboxFileData[];
};

export type FileAttachmentInput = {
  fileAssetId: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type GenerationStartInput = {
  conversationId?: string;
  content: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  resumePausedGenerationId?: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  selectedPlatformSkillSlugs?: string[];
  fileAttachments?: FileAttachmentInput[];
};

export type GenerationStreamEvent = {
  cursor?: string;
} & (
  | { type: "text"; content: string }
  | { type: "system"; content: string; coworkerId?: string }
  | { type: "thinking"; content: string; thinkingId: string }
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
  | {
      type: "interrupt_pending";
      interruptId: string;
      generationId: string;
      conversationId: string;
      kind: "plugin_write" | "runtime_permission" | "runtime_question" | "auth";
      providerToolUseId: string;
      display: {
        title: string;
        integration?: string;
        operation?: string;
        command?: string;
        toolInput?: Record<string, unknown>;
        authSpec?: {
          integrations: string[];
          reason?: string;
        };
      };
    }
  | {
      type: "interrupt_resolved";
      interruptId: string;
      status: "pending" | "accepted" | "rejected" | "expired" | "cancelled";
      kind: "plugin_write" | "runtime_permission" | "runtime_question" | "auth";
      providerToolUseId: string;
      display: {
        title: string;
        integration?: string;
        operation?: string;
        command?: string;
        toolInput?: Record<string, unknown>;
        authSpec?: {
          integrations: string[];
          reason?: string;
        };
      };
      responsePayload?: {
        questionAnswers?: string[][];
        connectedIntegrations?: string[];
      };
    }
  | {
      type: "done";
      generationId: string;
      conversationId: string;
      messageId: string;
      usage: GenerationUsage;
      artifacts?: DoneArtifactsData;
    }
  | { type: "error"; message: string; diagnosticMessage?: string }
  | { type: "cancelled"; generationId: string; conversationId: string; messageId?: string }
  | { type: "status_change"; status: string; metadata?: StatusChangeMetadata }
  | {
      type: "sandbox_file";
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes: number | null;
    }
);

export type GenerationSubscription = AsyncIterable<GenerationStreamEvent>;

export type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string }
  | null;

export type CoworkerSummary = {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  triggerType: string;
  schedule: CoworkerSchedule;
  lastRunStatus: string | null;
  lastRunAt: string | Date | null;
};

export type CoworkerDetails = {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  triggerType: string;
  prompt: string;
  model: string;
  authSource: ProviderAuthSource | null;
  autoApprove: boolean;
  toolAccessMode: string;
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  schedule: CoworkerSchedule;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
  sharedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  documents: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    description: string | null;
    createdAt: string | Date;
  }>;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string | Date;
    finishedAt: string | Date | null;
    errorMessage: string | null;
    failureKind: string | null;
  }>;
};

export type CoworkerCreateInput = {
  name?: string;
  description?: string | null;
  username?: string | null;
  triggerType: string;
  prompt: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  autoApprove?: boolean;
  toolAccessMode?: string;
  allowedIntegrations?: string[];
  allowedCustomIntegrations?: string[];
  allowedWorkspaceMcpServerIds?: string[];
  allowedSkillSlugs?: string[];
  folderId?: string | null;
  schedule?: CoworkerSchedule;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
};

export type CoworkerUpdateInput = {
  id: string;
  name?: string;
  description?: string | null;
  username?: string | null;
  status?: "on" | "off";
  triggerType?: string;
  prompt?: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  autoApprove?: boolean;
  isPinned?: boolean;
  toolAccessMode?: string;
  allowedIntegrations?: string[];
  allowedCustomIntegrations?: string[];
  allowedWorkspaceMcpServerIds?: string[];
  allowedSkillSlugs?: string[];
  schedule?: CoworkerSchedule;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
};

export type CoworkerCreateResult = {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
};

export type CoworkerDocumentUploadInput = {
  coworkerId: string;
  filename: string;
  mimeType: string;
  content: string;
  description?: string;
};

export type CoworkerDocumentUploadResult = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type CoworkerDocumentUpdateInput = {
  id: string;
  filename?: string;
  mimeType?: string;
  content?: string;
  description?: string | null;
};

export type CoworkerDocumentUpdateResult = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
};

export type CoworkerFolder = {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  parentId: string | null;
  name: string;
  visibility: "private" | "workspace";
  effectiveVisibility?: "private" | "workspace";
  position: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type CoworkerTriggerResult = {
  coworkerId: string;
  runId: string;
  generationId: string | null;
  conversationId: string;
};

export type CoworkerRunEvent = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string | Date;
};

export type CoworkerRun = {
  id: string;
  coworkerId: string;
  coworkerName: string | null;
  coworkerUsername: string | null;
  status: string;
  triggerPayload: unknown;
  generationId: string | null;
  conversationId: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
  errorMessage: string | null;
  failureKind: string | null;
  debugInfo: unknown;
  events: CoworkerRunEvent[];
};

export type CoworkerRunSummary = {
  id: string;
  status: string;
  startedAt: string | Date;
  finishedAt: string | Date | null;
  errorMessage: string | null;
  failureKind: string | null;
};

export type CoworkerRunStatus =
  | "needs_user_input"
  | "running"
  | "awaiting_approval"
  | "awaiting_auth"
  | "paused"
  | "cancelling"
  | "completed"
  | "error"
  | "cancelled";

export type CoworkerWorkspaceRun = CoworkerRunSummary & {
  conversationId: string | null;
  coworkerId: string | null;
  coworkerName: string;
};

export type CoworkerWorkspaceRunsResult = {
  runs: CoworkerWorkspaceRun[];
  nextCursor?: string;
};

export type ConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentParts: unknown[] | null;
  attachments: Array<{
    id?: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
  }>;
  sandboxFiles: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number | null;
  }>;
};

export type ConversationDetails = {
  id: string;
  type: string;
  title: string | null;
  model: string | null;
  authSource: ProviderAuthSource | null;
  autoApprove: boolean;
  messages: ConversationMessage[];
};

export interface BapApiClient {
  user: {
    me(): Promise<BapUser>;
  };
  billing: {
    overview(): Promise<{
      owner: {
        ownerType: "workspace";
        ownerId: string;
        planId: string;
        autumnCustomerId?: string;
      };
      plan?: unknown;
      feature?: unknown;
      recentCharges?: unknown[];
      recentTopUps?: unknown[];
      workspaces: Array<{
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
        role: string;
        billingPlanId: string;
        active: boolean;
      }>;
    }>;
    createWorkspace(input: { name: string }): Promise<{
      id: string;
      name: string;
      billingPlanId: string;
    }>;
    switchWorkspace(input: { workspaceId: string | null }): Promise<{ success: boolean }>;
    inviteMembers(input: {
      workspaceId: string;
      emails: string[];
      role?: "admin" | "member";
    }): Promise<{
      added: string[];
      alreadyMembers: string[];
      notFound: string[];
    }>;
    members(input: { workspaceId: string }): Promise<{
      members: WorkspaceMember[];
      membershipRole: string;
    }>;
    setMemberRole(input: {
      workspaceId: string;
      email: string;
      role: "admin" | "member";
    }): Promise<{ email: string; role: "admin" | "member" }>;
    removeMember(input: { workspaceId: string; email: string }): Promise<{ email: string }>;
  };
  providerAuth: {
    status(): Promise<ProviderAuthStatus>;
    freeModels(): Promise<FreeModelsResponse>;
  };
  generation: {
    startGeneration(input: GenerationStartInput): Promise<{
      generationId: string;
      conversationId: string;
    }>;
    markCurrentCoworkerRunFailed(input: { reason: string; message?: string }): Promise<{
      status: "failed";
      generationId: string;
      conversationId: string;
      coworkerRunId: string;
      active: boolean;
    }>;
    getActiveGeneration(input: { conversationId: string }): Promise<{
      generationId: string | null;
      startedAt: string | null;
      errorMessage: string | null;
      status: string | null;
      pauseReason: string | null;
      debugRunDeadlineMs: number | null;
    }>;
    subscribeGeneration(
      input: { generationId: string; cursor?: string },
      options?: { signal?: AbortSignal },
    ): Promise<GenerationSubscription>;
    submitApproval(input: {
      generationId: string;
      toolUseId: string;
      decision: "approve" | "deny";
      questionAnswers?: string[][];
    }): Promise<{ success: boolean }>;
    submitAuthResult(input: {
      generationId: string;
      integration: string;
      success: boolean;
    }): Promise<{ success: boolean }>;
    cancelGeneration(input: { generationId: string }): Promise<{ success: boolean }>;
    resumeGeneration(input: { generationId: string }): Promise<{ success: boolean }>;
  };
  fileAsset: {
    createUpload(input: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }): Promise<{
      uploadSessionId: string;
      uploadUrl: string;
      fileAssetId: string;
      expiresAt: Date;
    }>;
    completeUpload(input: { uploadSessionId: string }): Promise<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      status: "ready";
    }>;
  };
  integration: {
    list(): Promise<IntegrationSummary[]>;
    getAuthUrl(input: {
      type: string;
      redirectUrl: string;
      mode?: "connect" | "connect_to_label" | "reauth";
      accountLabel?: string;
      connectedAccountId?: string;
    }): Promise<{ authUrl: string }>;
    disconnect(input: { id: string }): Promise<{ success: boolean }>;
  };
  workspaceMcpServer: {
    list(): Promise<{
      workspaceId: string;
      membershipRole: string;
      sources: WorkspaceMcpServerSummary[];
    }>;
    create(input: WorkspaceMcpServerInput): Promise<{ id: string }>;
    update(input: WorkspaceMcpServerInput & { id: string }): Promise<{ success: true }>;
    delete(input: { id: string }): Promise<{ success: true }>;
    startOAuth(input: {
      workspaceMcpServerId: string;
      redirectUrl: string;
    }): Promise<{ authUrl: string }>;
    setCredential(input: {
      workspaceMcpServerId: string;
      secret: string;
      displayName?: string | null;
      enabled?: boolean;
    }): Promise<{ success: true }>;
    disconnectCredential(input: { workspaceMcpServerId: string }): Promise<{ success: true }>;
  };
  skill: {
    import(input: SkillImportInput): Promise<SkillImportResult>;
    list(): Promise<SkillSummary[]>;
    get(input: { id: string }): Promise<SkillDetail>;
    update(input: {
      id: string;
      name?: string;
      displayName?: string;
      description?: string;
      icon?: string | null;
      enabled?: boolean;
    }): Promise<{ success: true }>;
    delete(input: { id: string }): Promise<{ success: true }>;
    share(input: { id: string }): Promise<{ success: true; id: string; visibility: "public" }>;
    unshare(input: { id: string }): Promise<{ success: true; id: string; visibility: "private" }>;
  };
  coworker: {
    list(): Promise<CoworkerSummary[]>;
    get(input: { id: string }): Promise<CoworkerDetails>;
    create(input: CoworkerCreateInput): Promise<CoworkerCreateResult>;
    update(input: CoworkerUpdateInput): Promise<{ success: true }>;
    delete(input: { id: string }): Promise<{ success: boolean }>;
    moveWorkspace(input: {
      coworkerId: string;
      targetWorkspaceId: string;
    }): Promise<{
      id: string;
      workspaceId: string;
      sourceWorkspaceId: string;
      targetWorkspaceId: string;
      triggerType: string;
    }>;
    uploadDocument(input: CoworkerDocumentUploadInput): Promise<CoworkerDocumentUploadResult>;
    updateDocument(input: CoworkerDocumentUpdateInput): Promise<CoworkerDocumentUpdateResult>;
    deleteDocument(input: { id: string }): Promise<{ success: true; filename: string }>;
    getOrCreateBuilderConversation(input: { id: string }): Promise<{ conversationId: string }>;
    trigger(input: {
      id: string;
      payload?: unknown;
      debugRunDeadlineMs?: number;
      trustedUserInput?: string;
      fileAttachments?: FileAttachmentInput[];
    }): Promise<CoworkerTriggerResult>;
    getRun(input: { id: string }): Promise<CoworkerRun>;
    listRuns(input: { coworkerId: string; limit: number }): Promise<CoworkerRunSummary[]>;
    listWorkspaceRuns(input: {
      cursor?: string;
      limit?: number;
      status?: CoworkerRunStatus;
      coworkerId?: string;
    }): Promise<CoworkerWorkspaceRunsResult>;
  };
  coworkerFolder: {
    list(): Promise<CoworkerFolder[]>;
    create(input: {
      name: string;
      parentId?: string | null;
      visibility?: "private" | "workspace";
    }): Promise<CoworkerFolder | null>;
    createPath(input: {
      path: string;
      parentId?: string | null;
      visibility?: "private" | "workspace";
    }): Promise<CoworkerFolder | null>;
    moveCoworker(input: { coworkerId: string; folderId: string | null }): Promise<unknown>;
    moveFolder(input: { folderId: string; parentId: string | null }): Promise<unknown>;
    updateVisibility(input: {
      id: string;
      visibility: "private" | "workspace";
    }): Promise<CoworkerFolder | null>;
    delete(input: { id: string }): Promise<{ success: boolean }>;
  };
  conversation: {
    get(input: { id: string }): Promise<ConversationDetails>;
    downloadSandboxFile(input: { fileId: string }): Promise<{
      url: string;
      filename: string;
      mimeType: string;
      path: string;
      sizeBytes: number | null;
    }>;
  };
}

export interface BapProfileStore {
  getConfigPathForServerUrl(serverUrl: string): string;
  load(serverUrl?: string): BapProfile | null;
  save(config: BapProfile): void;
  clear(serverUrl?: string): void;
}

export type GenerationNeedsAuth = {
  generationId: string;
  conversationId: string;
  integrations: string[];
  reason?: string;
};

export type GenerationNeedsApproval = {
  generationId: string;
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type GenerationCompletedResult = {
  status: "completed";
  generationId: string;
  conversationId: string;
  messageId: string;
  usage?: GenerationUsage;
  artifacts?: DoneArtifactsData;
  assistant: RuntimeAssistantMessage;
};

export type GenerationNeedsAuthResult = {
  status: "needs_auth";
  generationId: string;
  conversationId: string;
  auth: GenerationNeedsAuth;
  assistant: RuntimeAssistantMessage;
};

export type GenerationNeedsApprovalResult = {
  status: "needs_approval";
  generationId: string;
  conversationId: string;
  approval: GenerationNeedsApproval;
  assistant: RuntimeAssistantMessage;
};

export type GenerationFailedResult = {
  status: "failed";
  generationId?: string;
  conversationId?: string;
  error: {
    code: string;
    message: string;
    diagnosticMessage?: string;
    phase: string;
    transportCode?: string;
  };
  assistant: RuntimeAssistantMessage;
};

export type GenerationCancelledResult = {
  status: "cancelled";
  generationId: string;
  conversationId: string;
  messageId?: string;
  assistant: RuntimeAssistantMessage;
};

export type GenerationPausedResult = {
  status: "paused";
  generationId?: string;
  conversationId?: string;
  pauseReason: "run_deadline";
  assistant: RuntimeAssistantMessage;
};

export type GenerationResult =
  | GenerationCompletedResult
  | GenerationNeedsAuthResult
  | GenerationNeedsApprovalResult
  | GenerationPausedResult
  | GenerationFailedResult
  | GenerationCancelledResult;

export interface ChatSessionRunner {
  run(input: GenerationStartInput): Promise<GenerationResult>;
}

export interface CoworkerRunner {
  resolveReference(reference: string): Promise<string>;
  list(): Promise<CoworkerSummary[]>;
  get(reference: string): Promise<CoworkerDetails>;
  create(input: CoworkerCreateInput): Promise<CoworkerCreateResult>;
  run(
    reference: string,
    payload?: unknown,
    options?: { trustedUserInput?: string; debugRunDeadlineMs?: number },
  ): Promise<CoworkerTriggerResult>;
  logs(runId: string): Promise<CoworkerRun>;
}
