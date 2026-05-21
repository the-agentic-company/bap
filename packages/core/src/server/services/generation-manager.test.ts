import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateReturningMock,
  updateSetMock,
  deleteReturningMock,
  insertReturningMock,
  insertValuesMock,
  conversationRuntimeFindFirstMock,
  generationFindFirstMock,
  generationFindManyMock,
  messageFindFirstMock,
  conversationFindFirstMock,
  conversationQueuedMessageFindFirstMock,
  conversationQueuedMessageFindManyMock,
  coworkerRunFindFirstMock,
  coworkerFindFirstMock,
  userFindFirstMock,
  providerAuthFindFirstMock,
  sharedProviderAuthFindFirstMock,
  queueAddMock,
  dbMock,
} = vi.hoisted(() => {
  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));
  const conversationRuntimeFindFirstMock = vi.fn();
  const generationFindFirstMock = vi.fn();
  const generationFindManyMock = vi.fn();
  const messageFindFirstMock = vi.fn();
  const conversationFindFirstMock = vi.fn();
  const conversationQueuedMessageFindFirstMock = vi.fn();
  const conversationQueuedMessageFindManyMock = vi.fn();
  const coworkerRunFindFirstMock = vi.fn();
  const coworkerFindFirstMock = vi.fn();
  const userFindFirstMock = vi.fn();
  const providerAuthFindFirstMock = vi.fn();
  const sharedProviderAuthFindFirstMock = vi.fn();
  const queueAddMock = vi.fn();

  const dbMock = {
    query: {
      conversationRuntime: { findFirst: conversationRuntimeFindFirstMock },
      generation: {
        findFirst: generationFindFirstMock,
        findMany: generationFindManyMock,
      },
      message: { findFirst: messageFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
      conversationQueuedMessage: {
        findFirst: conversationQueuedMessageFindFirstMock,
        findMany: conversationQueuedMessageFindManyMock,
      },
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
      coworker: { findFirst: coworkerFindFirstMock },
      user: { findFirst: userFindFirstMock },
      providerAuth: {
        findFirst: providerAuthFindFirstMock,
        findMany: vi.fn(() => []),
      },
      sharedProviderAuth: { findFirst: sharedProviderAuthFindFirstMock },
      skill: { findMany: vi.fn(() => []) },
      customIntegrationCredential: { findMany: vi.fn(() => []) },
    },
    delete: deleteMock,
    update: updateMock,
    insert: insertMock,
  };

  return {
    updateReturningMock,
    updateSetMock,
    deleteReturningMock,
    insertReturningMock,
    insertValuesMock,
    conversationRuntimeFindFirstMock,
    generationFindFirstMock,
    generationFindManyMock,
    messageFindFirstMock,
    conversationFindFirstMock,
    conversationQueuedMessageFindFirstMock,
    conversationQueuedMessageFindManyMock,
    coworkerRunFindFirstMock,
    coworkerFindFirstMock,
    userFindFirstMock,
    providerAuthFindFirstMock,
    sharedProviderAuthFindFirstMock,
    queueAddMock,
    dbMock,
  };
});

const {
  publishGenerationStreamEventMock,
  readGenerationStreamAfterMock,
  generationStreamExistsMock,
  getLatestGenerationStreamCursorMock,
  getLatestGenerationStreamEnvelopeMock,
} = vi.hoisted(() => ({
  publishGenerationStreamEventMock: vi.fn(async () => "1-1"),
  readGenerationStreamAfterMock: vi.fn(async () => []),
  generationStreamExistsMock: vi.fn(async () => false),
  getLatestGenerationStreamCursorMock: vi.fn(async () => null),
  getLatestGenerationStreamEnvelopeMock: vi.fn(async () => null),
}));

const { isStatelessServerlessRuntimeMock } = vi.hoisted(() => ({
  isStatelessServerlessRuntimeMock: vi.fn(() => false),
}));

const { composeOpencodePromptSpecMock } = vi.hoisted(() => ({
  composeOpencodePromptSpecMock: vi.fn(),
}));

const {
  saveConversationSessionSnapshotMock,
  clearConversationSessionSnapshotMock,
} = vi.hoisted(() => ({
  saveConversationSessionSnapshotMock: vi.fn(),
  clearConversationSessionSnapshotMock: vi.fn(),
}));

const {
  sandboxSlotAcquireMock,
  sandboxSlotRenewMock,
  sandboxSlotReleaseMock,
  sandboxSlotClearPendingMock,
} = vi.hoisted(() => ({
  sandboxSlotAcquireMock: vi.fn(async () => ({
    granted: true as const,
    token: "slot-token",
    activeCount: 1,
    requestAtMs: Date.now(),
  })),
  sandboxSlotRenewMock: vi.fn(async () => true),
  sandboxSlotReleaseMock: vi.fn(async () => undefined),
  sandboxSlotClearPendingMock: vi.fn(async () => undefined),
}));

const {
  interruptStore,
  createInterruptMock,
  getInterruptMock,
  getPendingInterruptForGenerationMock,
  listPendingInterruptsForGenerationMock,
  findPendingInterruptByToolUseIdMock,
  findInterruptByProviderRequestIdMock,
  findPendingAuthInterruptByIntegrationMock,
  refreshInterruptExpiryMock,
  resolveInterruptMock,
  expireInterruptMock,
  markInterruptAppliedMock,
  cancelInterruptsForGenerationMock,
  projectInterruptEventMock,
} = vi.hoisted(() => {
  const interruptStore = new Map<string, any>();

  const projectInterruptEventMock = vi.fn((interrupt: any) => ({
    interruptId: interrupt.id,
    generationId: interrupt.generationId,
    conversationId: interrupt.conversationId,
    kind: interrupt.kind,
    status: interrupt.status,
    providerToolUseId: interrupt.providerToolUseId,
    display: interrupt.display,
    responsePayload: interrupt.responsePayload,
  }));

  const createInterruptMock = vi.fn(async (input: any) => {
    const interrupt = {
      id: `interrupt-${input.providerToolUseId ?? input.kind}`,
      generationId: input.generationId,
      conversationId: input.conversationId,
      kind: input.kind,
      status: "pending",
      display: input.display,
      provider: input.provider,
      providerRequestId: input.providerRequestId ?? null,
      providerToolUseId: input.providerToolUseId,
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: input.expiresAt ?? null,
      resolvedAt: null,
      requestedByUserId: input.requestedByUserId ?? null,
      resolvedByUserId: null,
    };
    interruptStore.set(interrupt.id, interrupt);
    return interrupt;
  });

  const getInterruptMock = vi.fn(
    async (interruptId: string) => interruptStore.get(interruptId) ?? null,
  );

  const getPendingInterruptForGenerationMock = vi.fn(
    async (generationId: string) => {
      const pending = [...interruptStore.values()].find(
        (interrupt) =>
          interrupt.generationId === generationId &&
          interrupt.status === "pending",
      );
      return pending ?? null;
    },
  );

  const listPendingInterruptsForGenerationMock = vi.fn(
    async (generationId: string) =>
      [...interruptStore.values()].filter(
        (interrupt) =>
          interrupt.generationId === generationId &&
          interrupt.status === "pending",
      ),
  );

  const findPendingInterruptByToolUseIdMock = vi.fn(async (params: any) => {
    const interrupt = [...interruptStore.values()].find(
      (entry) =>
        entry.generationId === params.generationId &&
        entry.providerToolUseId === params.providerToolUseId &&
        entry.status === "pending",
    );
    return interrupt ?? null;
  });

  const findInterruptByProviderRequestIdMock = vi.fn(async (params: any) => {
    const interrupt = [...interruptStore.values()].find(
      (entry) =>
        entry.generationId === params.generationId &&
        entry.providerRequestId === params.providerRequestId,
    );
    return interrupt ?? null;
  });

  const findPendingAuthInterruptByIntegrationMock = vi.fn(
    async (params: any) => {
      const interrupt = [...interruptStore.values()].find(
        (entry) =>
          entry.generationId === params.generationId &&
          entry.kind === "auth" &&
          entry.status === "pending" &&
          entry.display.authSpec?.integrations?.includes(params.integration),
      );
      return interrupt ?? null;
    },
  );

  const resolveInterruptMock = vi.fn(async (params: any) => {
    const existing = interruptStore.get(params.interruptId);
    if (!existing) {
      return null;
    }
    const resolved = {
      ...existing,
      status: params.status,
      responsePayload: params.responsePayload,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      resolvedByUserId: params.resolvedByUserId ?? null,
    };
    interruptStore.set(resolved.id, resolved);
    return resolved;
  });

  const refreshInterruptExpiryMock = vi.fn(
    async (interruptId: string, expiresAt: Date) => {
      const existing = interruptStore.get(interruptId);
      if (!existing) {
        return null;
      }
      const refreshed = { ...existing, expiresAt };
      interruptStore.set(refreshed.id, refreshed);
      return refreshed;
    },
  );

  const expireInterruptMock = vi.fn(async (interruptId: string) =>
    resolveInterruptMock({ interruptId, status: "expired" }),
  );
  const markInterruptAppliedMock = vi.fn(async (interruptId: string) => {
    const existing = interruptStore.get(interruptId);
    if (!existing) {
      return null;
    }
    const applied = {
      ...existing,
      appliedAt: new Date("2026-03-11T15:02:00.000Z"),
    };
    interruptStore.set(applied.id, applied);
    return applied;
  });

  const cancelInterruptsForGenerationMock = vi.fn(
    async (generationId: string) => {
      for (const interrupt of interruptStore.values()) {
        if (
          interrupt.generationId === generationId &&
          interrupt.status === "pending"
        ) {
          interrupt.status = "cancelled";
          interrupt.resolvedAt = new Date("2026-03-11T15:01:00.000Z");
        }
      }
    },
  );

  return {
    interruptStore,
    createInterruptMock,
    getInterruptMock,
    getPendingInterruptForGenerationMock,
    listPendingInterruptsForGenerationMock,
    findPendingInterruptByToolUseIdMock,
    findInterruptByProviderRequestIdMock,
    findPendingAuthInterruptByIntegrationMock,
    refreshInterruptExpiryMock,
    resolveInterruptMock,
    expireInterruptMock,
    markInterruptAppliedMock,
    cancelInterruptsForGenerationMock,
    projectInterruptEventMock,
  };
});

const { ensureBucketMock, uploadToS3Mock } = vi.hoisted(() => ({
  ensureBucketMock: vi.fn(),
  uploadToS3Mock: vi.fn(),
}));

const {
  bindGenerationToRuntimeMock,
  getRuntimeForConversationMock,
  getRuntimeMock,
  updateRuntimeSessionMock,
  clearActiveGenerationMock,
  markRuntimeDeadMock,
  suspendRuntimeMock,
} = vi.hoisted(() => ({
  bindGenerationToRuntimeMock: vi.fn(),
  getRuntimeForConversationMock: vi.fn(),
  getRuntimeMock: vi.fn(),
  updateRuntimeSessionMock: vi.fn(),
  clearActiveGenerationMock: vi.fn(),
  markRuntimeDeadMock: vi.fn(),
  suspendRuntimeMock: vi.fn(),
}));

const {
  getOrCreateConversationRuntimeMock,
  getOrCreateConversationSandboxMock,
} = vi.hoisted(() => {
  const runtimeMock = vi.fn();
  return {
    getOrCreateConversationRuntimeMock: runtimeMock,
    getOrCreateConversationSandboxMock: vi.fn(async (...args: unknown[]) => {
      const runtime = await runtimeMock(...args);
      return {
        sandbox: runtime.sandbox,
        metadata: runtime.metadata,
        completeAgentInit: async () => ({
          harnessClient: runtime.harnessClient,
          session: runtime.session,
          sessionSource: runtime.sessionSource,
        }),
      };
    }),
  };
});

vi.mock("../../env", () => ({
  env: {},
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("../utils/encryption", () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("../prompts/opencode-runtime-prompt", () => ({
  composeOpencodePromptSpec: composeOpencodePromptSpecMock,
}));

vi.mock("../sandbox/core/orchestrator", () => ({
  getOrCreateConversationRuntime: getOrCreateConversationRuntimeMock,
  getOrCreateConversationSandbox: getOrCreateConversationSandboxMock,
}));

vi.mock("../sandbox/prep/skills-prep", () => ({
  writeSkillsToSandbox: vi.fn(),
  getSkillsSystemPrompt: vi.fn(() => ""),
  writeResolvedIntegrationSkillsToSandbox: vi.fn(),
  getIntegrationSkillsSystemPrompt: vi.fn(() => ""),
}));

vi.mock("../sandbox/prep/coworker-documents-prep", () => ({
  writeCoworkerDocumentsToSandbox: vi.fn(() => []),
}));

vi.mock("../integrations/cli-env", () => ({
  getCliEnvForUser: vi.fn(),
  getCliInstructions: vi.fn(() => ""),
  getCliInstructionsWithCustom: vi.fn(() => ""),
  getEnabledIntegrationTypes: vi.fn(() => []),
  filterCliEnvToAllowedIntegrations: vi.fn(
    (cliEnv: Record<string, string>) => ({ ...cliEnv }),
  ),
}));

vi.mock("../utils/generate-title", () => ({
  generateConversationTitle: vi.fn(),
}));

vi.mock("../sandbox/factory", () => ({
  getPreferredCloudSandboxProvider: vi.fn(() => "e2b"),
}));

vi.mock("../ai/permission-checker", () => ({
  parseBashCommand: vi.fn(() => null),
}));

vi.mock("../sandbox/prep/memory-prep", () => ({
  buildMemorySystemPrompt: vi.fn(() => ""),
  readMemoryFile: vi.fn(),
  searchMemoryWithSessions: vi.fn(() => []),
  syncMemoryFilesToSandbox: vi.fn(),
  writeMemoryEntry: vi.fn(),
  writeSessionTranscriptFromConversation: vi.fn(),
}));

vi.mock("../sandbox/prep/executor-prep", () => ({
  prepareExecutorInSandbox: vi.fn(() => null),
}));

vi.mock("./sandbox-file-service", () => ({
  uploadSandboxFile: vi.fn(),
  collectNewSandboxFiles: vi.fn(() => []),
}));

vi.mock("./workspace-skill-service", () => ({
  listAccessibleEnabledSkillMetadataForUser: vi.fn(() => []),
}));

vi.mock("../storage/s3-client", () => ({
  ensureBucket: ensureBucketMock,
  uploadToS3: uploadToS3Mock,
}));

vi.mock("./opencode-session-snapshot-service", () => ({
  saveConversationSessionSnapshot: saveConversationSessionSnapshotMock,
  clearConversationSessionSnapshot: clearConversationSessionSnapshotMock,
}));

vi.mock("./integration-skill-service", () => ({
  createCommunityIntegrationSkill: vi.fn(),
  resolvePreferredCommunitySkillsForUser: vi.fn(() => []),
}));

vi.mock("../utils/observability", () => ({
  createTraceId: vi.fn(() => "trace-1"),
  logServerEvent: vi.fn(),
}));

vi.mock("../queues", () => ({
  buildQueueJobId: (parts: Array<string | number | null | undefined>) =>
    parts
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join("-"),
  CHAT_GENERATION_JOB_NAME: "generation:chat-run",
  COWORKER_GENERATION_JOB_NAME: "generation:coworker-run",
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME:
    "conversation:queued-message-process",
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME: "generation:approval-timeout",
  GENERATION_AUTH_TIMEOUT_JOB_NAME: "generation:auth-timeout",
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME: "generation:preparing-stuck-check",
  getQueue: () => ({
    add: queueAddMock,
  }),
}));

vi.mock("../utils/runtime-platform", () => ({
  isStatelessServerlessRuntime: isStatelessServerlessRuntimeMock,
}));

vi.mock("./generation-interrupt-service", () => ({
  generationInterruptService: {
    createInterrupt: createInterruptMock,
    getInterrupt: getInterruptMock,
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
    listPendingInterruptsForGeneration: listPendingInterruptsForGenerationMock,
    findPendingInterruptByToolUseId: findPendingInterruptByToolUseIdMock,
    findInterruptByProviderRequestId: findInterruptByProviderRequestIdMock,
    findPendingAuthInterruptByIntegration:
      findPendingAuthInterruptByIntegrationMock,
    refreshInterruptExpiry: refreshInterruptExpiryMock,
    resolveInterrupt: resolveInterruptMock,
    expireInterrupt: expireInterruptMock,
    markInterruptApplied: markInterruptAppliedMock,
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
    projectInterruptEvent: projectInterruptEventMock,
  },
}));

vi.mock("./conversation-runtime-service", () => ({
  conversationRuntimeService: {
    bindGenerationToRuntime: bindGenerationToRuntimeMock,
    getRuntimeForConversation: getRuntimeForConversationMock,
    getRuntime: getRuntimeMock,
    updateRuntimeSession: updateRuntimeSessionMock,
    clearActiveGeneration: clearActiveGenerationMock,
    markRuntimeDead: markRuntimeDeadMock,
    suspendRuntime: suspendRuntimeMock,
    authorizeRuntimeTurn: vi.fn(),
  },
}));

vi.mock("./sandbox-slot-manager", () => ({
  getSandboxSlotManager: () => ({
    acquireLease: sandboxSlotAcquireMock,
    renewLease: sandboxSlotRenewMock,
    releaseLease: sandboxSlotReleaseMock,
    clearPendingRequest: sandboxSlotClearPendingMock,
    hasActiveLease: vi.fn(async () => false),
  }),
}));

vi.mock("../redis/generation-event-bus", () => ({
  publishGenerationStreamEvent: publishGenerationStreamEventMock,
  readGenerationStreamAfter: readGenerationStreamAfterMock,
  generationStreamExists: generationStreamExistsMock,
  getLatestGenerationStreamCursor: getLatestGenerationStreamCursorMock,
  getLatestGenerationStreamEnvelope: getLatestGenerationStreamEnvelopeMock,
}));

import { env } from "../../env";
import {
  getCliEnvForUser,
  getCliInstructionsWithCustom,
  getEnabledIntegrationTypes,
} from "../integrations/cli-env";
import {
  CMDCLAW_CHAT_AGENT_ID,
  CMDCLAW_COWORKER_BUILDER_AGENT_ID,
  CMDCLAW_COWORKER_RUNNER_AGENT_ID,
} from "../prompts/opencode-agent-ids";
import { composeOpencodePromptSpec } from "../prompts/opencode-runtime-prompt";
import { getOrCreateConversationRuntime } from "../sandbox/core/orchestrator";
import { getPreferredCloudSandboxProvider } from "../sandbox/factory";
import { writeCoworkerDocumentsToSandbox } from "../sandbox/prep/coworker-documents-prep";
import {
  syncMemoryFilesToSandbox,
  buildMemorySystemPrompt,
} from "../sandbox/prep/memory-prep";
import { prepareExecutorInSandbox } from "../sandbox/prep/executor-prep";
import {
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox,
  getIntegrationSkillsSystemPrompt,
} from "../sandbox/prep/skills-prep";
import { logServerEvent } from "../utils/observability";
import {
  classifyRuntimeFailure,
  generationLifecyclePolicy,
} from "./lifecycle-policy";
import {
  handleRuntimeActionableEvent as handleOpenCodeRuntimeActionableEvent,
  sendRuntimeApprovalDecision,
} from "../runtime/runtime-driver";
import { listAccessibleEnabledSkillMetadataForUser } from "./workspace-skill-service";
import {
  buildDefaultQuestionAnswers,
  buildQuestionCommand,
  extractRuntimeExportState,
  generationManager,
} from "./generation-manager";
import {
  uploadSandboxFile,
  collectNewSandboxFiles,
} from "./sandbox-file-service";

type GenerationCtx = {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  status: string;
  contentParts: unknown[];
  assistantContent: string;
  abortController: AbortController;
  pendingApproval: unknown;
  pendingAuth: {
    integrations?: string[];
    connectedIntegrations?: string[];
    requestedAt?: string;
    [key: string]: unknown;
  } | null;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  startedAt: Date;
  lastSaveAt: Date;
  isNewConversation: boolean;
  model: string;
  userMessageContent: string;
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<string, unknown>;
  backendType: string;
  autoApprove: boolean;
  uploadedSandboxFileIds?: Set<string>;
  [key: string]: unknown;
};

type GenerationManagerTestHarness = {
  activeGenerations: Map<string, GenerationCtx>;
  finishGeneration: (ctx: GenerationCtx, status: string) => Promise<void>;
  runGeneration: (ctx: GenerationCtx) => Promise<void>;
  runRecoveryReattach: (ctx: GenerationCtx) => Promise<void>;
  resolveRuntimeFailure: (
    ctx: GenerationCtx,
    client?: unknown,
  ) => Promise<string>;
  handleSessionReset: (ctx: GenerationCtx) => Promise<void>;
  runOpenCodeGeneration: (ctx: GenerationCtx) => Promise<void>;
  handleRuntimeActionableEvent: (...args: unknown[]) => Promise<unknown>;
  importIntegrationSkillDraftsFromSandbox: (
    ...args: unknown[]
  ) => Promise<void>;
  waitForAuth: (...args: unknown[]) => Promise<{ success: boolean }>;
  waitForApproval: (...args: unknown[]) => Promise<string>;
};

function asTestManager(): GenerationManagerTestHarness {
  return generationManager as unknown as GenerationManagerTestHarness;
}

function createCtx(overrides: Partial<GenerationCtx> = {}): GenerationCtx {
  const ctx: GenerationCtx = {
    id: "gen-1",
    traceId: "trace-1",
    conversationId: "conv-1",
    userId: "user-1",
    status: "running",
    executionPolicy: { allowSnapshotRestoreOnRun: true },
    deadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    remainingRunMs: 15 * 60 * 1000,
    approvalHotWaitMs: 60_000,
    suspendedAt: null,
    resumeInterruptId: null,
    lastRuntimeEventAt: new Date(),
    recoveryAttempts: 0,
    completionReason: null,
    contentParts: [],
    assistantContent: "",
    abortController: new AbortController(),
    pendingApproval: null,
    pendingAuth: null,
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
    startedAt: new Date(),
    lastSaveAt: new Date(),
    isNewConversation: false,
    model: "openai/gpt-4",
    userMessageContent: "hello",
    runtimeId: "runtime-1",
    runtimeTurnSeq: 1,
    assistantMessageIds: new Set(),
    messageRoles: new Map(),
    pendingMessageParts: new Map(),
    backendType: "opencode",
    autoApprove: false,
    ...overrides,
  };
  return ctx;
}

function deriveInterruptFromCtx(ctx: GenerationCtx): any | null {
  if (ctx.status === "awaiting_approval" && ctx.pendingApproval) {
    const pendingApproval = ctx.pendingApproval as {
      toolUseId: string;
      toolName?: string;
      toolInput?: Record<string, unknown>;
      integration?: string;
      operation?: string;
      command?: string;
      requestedAt?: string;
      expiresAt?: string;
    };
    return {
      id: `interrupt-${pendingApproval.toolUseId}`,
      generationId: ctx.id,
      runtimeId: ctx.runtimeId ?? "runtime-1",
      conversationId: ctx.conversationId,
      turnSeq: ctx.runtimeTurnSeq ?? 1,
      kind:
        pendingApproval.operation === "question" ||
        pendingApproval.operation === "permission"
          ? pendingApproval.operation === "question"
            ? "runtime_question"
            : "runtime_permission"
          : "plugin_write",
      status: "pending",
      display: {
        title: pendingApproval.toolName ?? "Bash",
        integration: pendingApproval.integration ?? "cmdclaw",
        operation: pendingApproval.operation ?? "unknown",
        command: pendingApproval.command,
        toolInput: pendingApproval.toolInput ?? {},
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: pendingApproval.toolUseId,
      responsePayload: undefined,
      requestedAt: new Date(
        pendingApproval.requestedAt ?? "2026-03-11T15:00:00.000Z",
      ),
      expiresAt: pendingApproval.expiresAt
        ? new Date(pendingApproval.expiresAt)
        : null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    };
  }

  if (ctx.status === "awaiting_auth" && ctx.pendingAuth) {
    const pendingAuth = ctx.pendingAuth;
    return {
      id: `interrupt-auth-${ctx.id}`,
      generationId: ctx.id,
      runtimeId: ctx.runtimeId ?? "runtime-1",
      conversationId: ctx.conversationId,
      turnSeq: ctx.runtimeTurnSeq ?? 1,
      kind: "auth",
      status: "pending",
      display: {
        title: "Auth Required",
        authSpec: {
          integrations: pendingAuth.integrations ?? [],
          connectedIntegrations: pendingAuth.connectedIntegrations ?? [],
        },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: `auth-${ctx.id}`,
      responsePayload: {
        connectedIntegrations: pendingAuth.connectedIntegrations ?? [],
      },
      requestedAt: new Date(
        String(pendingAuth.requestedAt ?? "2026-03-11T15:00:00.000Z"),
      ),
      expiresAt: pendingAuth.expiresAt
        ? new Date(String(pendingAuth.expiresAt))
        : null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    };
  }

  return null;
}

function createConversationRuntimeMock(params: {
  promptMock: ReturnType<typeof vi.fn>;
  subscribeMock: ReturnType<typeof vi.fn>;
  messagesMock?: ReturnType<typeof vi.fn>;
  statusMock?: ReturnType<typeof vi.fn>;
  getSessionMock?: ReturnType<typeof vi.fn>;
  readFile?: ReturnType<typeof vi.fn>;
  writeFile?: ReturnType<typeof vi.fn>;
  ensureDir?: ReturnType<typeof vi.fn>;
  exec?: ReturnType<typeof vi.fn>;
  sessionSource?: "live_session" | "restored_snapshot" | "created_session";
}) {
  return {
    harnessClient: {
      subscribe: params.subscribeMock,
      prompt: params.promptMock,
      abort: vi.fn().mockResolvedValue({ data: null, error: null }),
      messages:
        params.messagesMock ??
        vi.fn().mockResolvedValue({ data: [], error: null }),
      status: params.statusMock,
      getSession:
        params.getSessionMock ??
        vi.fn().mockResolvedValue({ data: null, error: null }),
      createSession: vi
        .fn()
        .mockResolvedValue({ data: { id: "session-1" }, error: null }),
      updatePart: vi.fn().mockResolvedValue({ data: null, error: null }),
      replyPermission: vi.fn().mockResolvedValue(undefined),
      replyQuestion: vi.fn().mockResolvedValue(undefined),
      rejectQuestion: vi.fn().mockResolvedValue(undefined),
    },
    session: { id: "session-1" },
    sessionSource: params.sessionSource ?? "created_session",
    sandbox: {
      provider: "e2b" as const,
      sandboxId: "sandbox-1",
      writeFile: params.writeFile ?? vi.fn().mockResolvedValue(undefined),
      readFile:
        params.readFile ?? vi.fn().mockRejectedValue(new Error("no cache")),
      ensureDir: params.ensureDir ?? vi.fn().mockResolvedValue(undefined),
      exec:
        params.exec ??
        vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    },
    metadata: {
      sandboxProvider: "e2b" as const,
      runtimeHarness: "opencode" as const,
      runtimeProtocolVersion: "opencode-v2" as const,
    },
  };
}

function syncInterruptStateMocks(
  interrupt: {
    kind: "plugin_write" | "runtime_permission" | "runtime_question" | "auth";
    status: string;
  } | null,
): void {
  const generationStatus =
    !interrupt || interrupt.status !== "pending"
      ? "running"
      : interrupt.kind === "auth"
        ? "awaiting_auth"
        : "awaiting_approval";
  const conversationStatus =
    !interrupt || interrupt.status !== "pending"
      ? "generating"
      : interrupt.kind === "auth"
        ? "awaiting_auth"
        : "awaiting_approval";

  updateSetMock({
    status: generationStatus,
    pendingApproval: null,
    pendingAuth: null,
  });
  updateSetMock({
    generationStatus: conversationStatus,
  });
}

async function collectEvents(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function* asAsyncIterable<T>(items: T[]) {
  for (const item of items) {
    yield item;
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createExecutorPreparationMock(input?: {
  instructions?: string;
  oauthCacheHits?: number;
  sessionMcpServers?: Array<{
    type: "stdio";
    name: string;
    command: string;
    args: string[];
    env: Array<{ name: string; value: string }>;
  }>;
  finalize?: () => Promise<{
    oauthCacheHits: number;
    oauthRefreshFailures: Array<{
      sourceId: string;
      name: string;
      namespace: string;
      reason: string;
      error: string;
    }>;
    oauthSourceStatuses: Array<{
      sourceId: string;
      name: string;
      namespace: string;
      status: string;
      reason?: string;
      toolCount: number | null;
      error?: string;
    }>;
  }>;
}) {
  return {
    revisionHash: "rev-1",
    sourceCount: 1,
    baseUrl: "http://127.0.0.1:8788",
    homeDirectory: "/tmp/cmdclaw-executor/default",
    instructions: input?.instructions ?? "executor prompt",
    sessionMcpServers: input?.sessionMcpServers ?? [],
    finalize:
      input?.finalize ??
      (() =>
        Promise.resolve({
          oauthCacheHits: input?.oauthCacheHits ?? 0,
          oauthRefreshFailures: [],
          oauthSourceStatuses: [],
        })),
  };
}

describe("generationManager transitions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-anthropic-key",
      configurable: true,
    });
    userFindFirstMock.mockResolvedValue({
      role: "admin",
      activeWorkspaceId: null,
      timezone: null,
    });
    vi.mocked(composeOpencodePromptSpec).mockReset();
    vi.mocked(composeOpencodePromptSpec).mockImplementation((input) => {
      const agentId =
        input.kind === "coworker_runner"
          ? CMDCLAW_COWORKER_RUNNER_AGENT_ID
          : input.kind === "coworker_builder"
            ? CMDCLAW_COWORKER_BUILDER_AGENT_ID
            : CMDCLAW_CHAT_AGENT_ID;
      return {
        agentId,
        systemPrompt: `mock system prompt for ${input.kind}`,
        sections: [
          { key: "mock", content: `mock system prompt for ${input.kind}` },
        ],
      };
    });
    saveConversationSessionSnapshotMock.mockReset();
    saveConversationSessionSnapshotMock.mockResolvedValue(undefined);
    clearConversationSessionSnapshotMock.mockReset();
    clearConversationSessionSnapshotMock.mockResolvedValue(undefined);
    interruptStore.clear();
    createInterruptMock.mockImplementation(async (input: any) => {
      const interrupt = {
        id: `interrupt-${input.providerToolUseId ?? input.kind}`,
        generationId: input.generationId,
        runtimeId: input.runtimeId ?? "runtime-1",
        conversationId: input.conversationId,
        turnSeq: input.turnSeq ?? 1,
        kind: input.kind,
        status: "pending",
        display: input.display,
        provider: input.provider,
        providerRequestId: input.providerRequestId ?? null,
        providerToolUseId: input.providerToolUseId,
        responsePayload: undefined,
        requestedAt: new Date("2026-03-11T15:00:00.000Z"),
        expiresAt: input.expiresAt ?? null,
        resolvedAt: null,
        requestedByUserId: input.requestedByUserId ?? null,
        resolvedByUserId: null,
      };
      interruptStore.set(interrupt.id, interrupt);
      syncInterruptStateMocks(interrupt);

      const activeCtx = asTestManager().activeGenerations.get(
        input.generationId,
      );
      if (activeCtx) {
        activeCtx.currentInterruptId = interrupt.id;
        activeCtx.status =
          input.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
        if (input.kind === "auth") {
          activeCtx.pendingAuth = {
            integrations: input.display.authSpec?.integrations ?? [],
            connectedIntegrations:
              input.display.authSpec?.connectedIntegrations ?? [],
            requestedAt: interrupt.requestedAt.toISOString(),
            expiresAt: interrupt.expiresAt?.toISOString(),
          };
        } else {
          activeCtx.pendingApproval = {
            toolUseId: input.providerToolUseId,
            toolName: input.display.title,
            toolInput: input.display.toolInput ?? {},
            integration: input.display.integration ?? "cmdclaw",
            operation: input.display.operation ?? "unknown",
            command: input.display.command,
            requestedAt: interrupt.requestedAt.toISOString(),
            expiresAt: interrupt.expiresAt?.toISOString(),
          };
        }
      }

      return interrupt;
    });
    getInterruptMock.mockImplementation(
      async (interruptId: string) => interruptStore.get(interruptId) ?? null,
    );
    getPendingInterruptForGenerationMock.mockImplementation(
      async (generationId: string) => {
        const stored = [...interruptStore.values()].find(
          (interrupt) =>
            interrupt.generationId === generationId &&
            interrupt.status === "pending",
        );
        if (stored) {
          return stored;
        }
        const activeCtx = asTestManager().activeGenerations.get(generationId);
        return activeCtx ? deriveInterruptFromCtx(activeCtx) : null;
      },
    );
    listPendingInterruptsForGenerationMock.mockImplementation(
      async (generationId: string) => {
        const stored = [...interruptStore.values()].filter(
          (interrupt) =>
            interrupt.generationId === generationId &&
            interrupt.status === "pending",
        );
        if (stored.length > 0) {
          return stored;
        }
        const activeCtx = asTestManager().activeGenerations.get(generationId);
        const derived = activeCtx ? deriveInterruptFromCtx(activeCtx) : null;
        return derived ? [derived] : [];
      },
    );
    findPendingInterruptByToolUseIdMock.mockImplementation(
      async (params: any) => {
        const stored = [...interruptStore.values()].find(
          (entry) =>
            entry.generationId === params.generationId &&
            entry.providerToolUseId === params.providerToolUseId &&
            entry.status === "pending",
        );
        if (stored) {
          return stored;
        }
        const activeCtx = asTestManager().activeGenerations.get(
          params.generationId,
        );
        const derived = activeCtx ? deriveInterruptFromCtx(activeCtx) : null;
        return derived?.providerToolUseId === params.providerToolUseId
          ? derived
          : null;
      },
    );
    findInterruptByProviderRequestIdMock.mockImplementation(
      async (params: any) => {
        return (
          [...interruptStore.values()].find(
            (entry) =>
              entry.generationId === params.generationId &&
              entry.providerRequestId === params.providerRequestId,
          ) ?? null
        );
      },
    );
    findPendingAuthInterruptByIntegrationMock.mockImplementation(
      async (params: any) => {
        const stored = [...interruptStore.values()].find(
          (entry) =>
            entry.generationId === params.generationId &&
            entry.kind === "auth" &&
            entry.status === "pending" &&
            entry.display.authSpec?.integrations?.includes(params.integration),
        );
        if (stored) {
          return stored;
        }
        const activeCtx = asTestManager().activeGenerations.get(
          params.generationId,
        );
        const derived = activeCtx ? deriveInterruptFromCtx(activeCtx) : null;
        return derived?.kind === "auth" &&
          derived.display.authSpec?.integrations?.includes(params.integration)
          ? derived
          : null;
      },
    );
    resolveInterruptMock.mockImplementation(async (params: any) => {
      const derivedMatch = [...asTestManager().activeGenerations.values()]
        .map((ctx) => deriveInterruptFromCtx(ctx))
        .find((entry) => entry?.id === params.interruptId);
      const existing =
        interruptStore.get(params.interruptId) ??
        derivedMatch ??
        [...interruptStore.values()].find(
          (entry) => entry.id === params.interruptId,
        ) ??
        null;
      if (!existing) {
        return null;
      }
      const resolved = {
        ...existing,
        status: params.status,
        responsePayload: params.responsePayload,
        resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
        resolvedByUserId: params.resolvedByUserId ?? null,
      };
      interruptStore.set(resolved.id, resolved);

      const activeCtx = asTestManager().activeGenerations.get(
        resolved.generationId,
      );
      const derivedInterrupt = activeCtx
        ? deriveInterruptFromCtx(activeCtx)
        : null;
      if (
        activeCtx &&
        (activeCtx.currentInterruptId === resolved.id ||
          derivedInterrupt?.id === resolved.id)
      ) {
        activeCtx.currentInterruptId = undefined;
        activeCtx.pendingApproval = null;
        activeCtx.pendingAuth = null;
      }
      const nextPending =
        [...interruptStore.values()].find(
          (entry) =>
            entry.generationId === resolved.generationId &&
            entry.status === "pending",
        ) ?? null;
      syncInterruptStateMocks(nextPending);

      return resolved;
    });
    expireInterruptMock.mockImplementation(async (interruptId: string) =>
      resolveInterruptMock({ interruptId, status: "expired" }),
    );
    cancelInterruptsForGenerationMock.mockImplementation(
      async (generationId: string) => {
        for (const interrupt of interruptStore.values()) {
          if (
            interrupt.generationId === generationId &&
            interrupt.status === "pending"
          ) {
            interrupt.status = "cancelled";
            interrupt.resolvedAt = new Date("2026-03-11T15:01:00.000Z");
          }
        }
        const activeCtx = asTestManager().activeGenerations.get(generationId);
        if (activeCtx) {
          activeCtx.currentInterruptId = undefined;
          activeCtx.pendingApproval = null;
          activeCtx.pendingAuth = null;
        }
        syncInterruptStateMocks(null);
      },
    );
    projectInterruptEventMock.mockImplementation((interrupt: any) => ({
      interruptId: interrupt.id,
      generationId: interrupt.generationId,
      runtimeId: interrupt.runtimeId ?? "runtime-1",
      conversationId: interrupt.conversationId,
      turnSeq: interrupt.turnSeq ?? 1,
      kind: interrupt.kind,
      status: interrupt.status,
      providerToolUseId: interrupt.providerToolUseId,
      display: interrupt.display,
      responsePayload: interrupt.responsePayload,
    }));
    updateReturningMock.mockReset();
    updateReturningMock.mockResolvedValue([]);
    conversationRuntimeFindFirstMock.mockReset();
    conversationRuntimeFindFirstMock.mockResolvedValue(null);
    insertValuesMock.mockReset();
    insertReturningMock.mockReset();
    bindGenerationToRuntimeMock.mockReset();
    bindGenerationToRuntimeMock.mockResolvedValue({
      runtimeId: "runtime-1",
      callbackToken: "runtime-token",
      turnSeq: 1,
    });
    getRuntimeForConversationMock.mockReset();
    getRuntimeForConversationMock.mockResolvedValue({
      id: "runtime-1",
      conversationId: "conv-1",
      callbackToken: "runtime-token",
      sandboxProvider: null,
      runtimeHarness: null,
      runtimeProtocolVersion: null,
      sandboxId: null,
      sessionId: null,
      status: "active",
      activeGenerationId: "gen-1",
      activeTurnSeq: 1,
      lastBoundAt: null,
      createdAt: new Date("2026-03-11T15:00:00.000Z"),
      updatedAt: new Date("2026-03-11T15:00:00.000Z"),
    });
    getRuntimeMock.mockReset();
    getRuntimeMock.mockImplementation(async (runtimeId?: string) =>
      runtimeId
        ? {
            id: runtimeId,
            conversationId: "conv-1",
            callbackToken: "runtime-token",
            sandboxProvider: null,
            runtimeHarness: null,
            runtimeProtocolVersion: null,
            sandboxId: null,
            sessionId: null,
            status: "active",
            activeGenerationId: "gen-1",
            activeTurnSeq: 1,
            lastBoundAt: null,
            createdAt: new Date("2026-03-11T15:00:00.000Z"),
            updatedAt: new Date("2026-03-11T15:00:00.000Z"),
          }
        : null,
    );
    updateRuntimeSessionMock.mockReset();
    updateRuntimeSessionMock.mockResolvedValue(undefined);
    clearActiveGenerationMock.mockReset();
    clearActiveGenerationMock.mockResolvedValue(undefined);
    markRuntimeDeadMock.mockReset();
    markRuntimeDeadMock.mockResolvedValue(undefined);
    suspendRuntimeMock.mockReset();
    suspendRuntimeMock.mockResolvedValue(undefined);
    insertValuesMock.mockImplementation(() => ({
      returning: insertReturningMock,
    }));
    insertReturningMock.mockResolvedValue([]);
    generationFindFirstMock.mockResolvedValue(null);
    generationFindManyMock.mockResolvedValue([]);
    messageFindFirstMock.mockResolvedValue(null);
    conversationFindFirstMock.mockResolvedValue(null);
    publishGenerationStreamEventMock.mockReset();
    publishGenerationStreamEventMock.mockResolvedValue("1-1");
    readGenerationStreamAfterMock.mockReset();
    readGenerationStreamAfterMock.mockResolvedValue([]);
    generationStreamExistsMock.mockReset();
    generationStreamExistsMock.mockResolvedValue(false);
    getLatestGenerationStreamCursorMock.mockReset();
    getLatestGenerationStreamCursorMock.mockResolvedValue(null);
    getLatestGenerationStreamEnvelopeMock.mockReset();
    getLatestGenerationStreamEnvelopeMock.mockResolvedValue(null);
    conversationQueuedMessageFindManyMock.mockResolvedValue([]);
    coworkerRunFindFirstMock.mockResolvedValue(null);
    coworkerFindFirstMock.mockResolvedValue(null);
    providerAuthFindFirstMock.mockResolvedValue(null);
    sharedProviderAuthFindFirstMock.mockResolvedValue({
      id: "shared-auth-anthropic",
    });
    vi.mocked(getPreferredCloudSandboxProvider).mockReturnValue("e2b");
    isStatelessServerlessRuntimeMock.mockReturnValue(false);
    ensureBucketMock.mockReset();
    ensureBucketMock.mockResolvedValue(undefined);
    uploadToS3Mock.mockReset();
    uploadToS3Mock.mockResolvedValue(undefined);
    queueAddMock.mockReset();
    sandboxSlotAcquireMock.mockReset();
    sandboxSlotAcquireMock.mockResolvedValue({
      granted: true,
      token: "slot-token",
      activeCount: 1,
      requestAtMs: Date.now(),
    });
    sandboxSlotRenewMock.mockReset();
    sandboxSlotRenewMock.mockResolvedValue(true);
    sandboxSlotReleaseMock.mockReset();
    sandboxSlotReleaseMock.mockResolvedValue(undefined);
    sandboxSlotClearPendingMock.mockReset();
    sandboxSlotClearPendingMock.mockResolvedValue(undefined);
    refreshInterruptExpiryMock.mockClear();
    delete process.env.KUMA_PUSH_URL;

    const mgr = asTestManager();
    mgr.activeGenerations.clear();
  });

  it("formats cmdclaw question approvals from the questions payload", () => {
    const request = {
      id: "que-1",
      sessionID: "ses-1",
      questions: [
        {
          header: "Goal",
          question: "What do you want me to ask you about?",
          options: [
            { label: "Project task (Recommended)" },
            { label: "Preferences" },
          ],
        },
        {
          header: "Format",
          question: "How should I phrase it?",
          options: [{ label: "Direct" }],
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-1",
      },
    };

    expect(buildQuestionCommand(request)).toBe(
      "Question: What do you want me to ask you about? [Project task (Recommended) | Preferences] (+1 more)",
    );
    expect(buildDefaultQuestionAnswers(request)).toEqual([
      ["Project task (Recommended)"],
      ["Direct"],
    ]);
  });

  it("classifies exported runtime states for terminal, waiting, and recoverable flows", () => {
    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [{ type: "step-finish", reason: "complete" }],
          },
        ],
      }),
    ).toBe("terminal_completed");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [{ type: "step-finish", reason: "error" }],
          },
        ],
      }),
    ).toBe("terminal_failed");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              { type: "tool", tool: "question", state: { status: "running" } },
              { type: "step-finish", reason: "stop" },
            ],
          },
        ],
      }),
    ).toBe("waiting_approval");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "auth",
                state: {
                  status: "running",
                  input: { integrations: ["slack"] },
                },
              },
              { type: "step-finish", reason: "stop" },
            ],
          },
        ],
      }),
    ).toBe("waiting_auth");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              { type: "tool", tool: "bash", state: { status: "pending" } },
            ],
          },
        ],
      }),
    ).toBe("non_terminal");
  });

  it("cancels generation by aborting active context and setting cancel_requested", async () => {
    const ctx = createCtx();
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      status: "running",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    const result = await generationManager.cancelGeneration(ctx.id, ctx.userId);

    expect(result).toBe(true);
    expect(ctx.abortController.signal.aborted).toBe(true);
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it("submits approval, stores an approval content part, and emits interrupt resolution", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: { command: "slack send" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
      },
    });
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    const result = await generationManager.submitApproval(
      ctx.id,
      "tool-1",
      "approve",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(ctx.pendingApproval).toBeNull();

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentParts: [
          expect.objectContaining({
            type: "approval",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            tool_input: { command: "slack send" },
            integration: "slack",
            operation: "send",
            status: "approved",
          }),
        ],
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        pendingApproval: null,
        pendingAuth: null,
      }),
    );
    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        resolvedByUserId: ctx.userId,
      }),
    );

    const publishedPayloads = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    )
      .map((call) => call[1] as { payload?: unknown } | undefined)
      .filter((entry): entry is { payload?: unknown } => !!entry)
      .map((entry) => entry.payload);

    expect(publishedPayloads).toContainEqual(
      expect.objectContaining({
        type: "interrupt_resolved",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        kind: "plugin_write",
        status: "accepted",
        providerToolUseId: "tool-1",
      }),
    );
  });

  it("accepts a detached approval and enqueues the same generation as a suspended resume", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      status: "awaiting_approval",
      contentParts: null,
      remainingRunMs: 222_000,
      conversation: {
        id: "conv-detached-approval",
        userId: "user-1",
      },
    });
    interruptStore.set("interrupt-detached-approval", {
      id: "interrupt-detached-approval",
      generationId: "gen-detached-approval",
      runtimeId: "runtime-1",
      conversationId: "conv-detached-approval",
      turnSeq: 1,
      kind: "runtime_permission",
      status: "pending",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        command: "external_directory",
        toolInput: { permission: "external_directory" },
      },
      provider: "opencode",
      providerRequestId: "permission-request-1",
      providerToolUseId: "tool-detached-approval",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });

    const result = await generationManager.submitApproval(
      "gen-detached-approval",
      "tool-detached-approval",
      "approve",
      "user-1",
    );

    expect(result).toBe(true);
    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-detached-approval",
        status: "accepted",
        resolvedByUserId: "user-1",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        resumeInterruptId: "interrupt-detached-approval",
        deadlineAt: expect.any(Date),
        suspendedAt: null,
        isPaused: false,
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: expect.any(Date),
      }),
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-detached-approval", runMode: "normal_run" },
      expect.objectContaining({
        jobId: expect.stringContaining(
          "resume-interrupt-interrupt-detached-approval",
        ),
      }),
    );
  });

  it("enqueues durable interrupt resume even when runtime metadata still looks active", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-hot-runtime-approval",
      conversationId: "conv-hot-runtime-approval",
      status: "running",
      runtimeId: "runtime-hot-approval",
      sandboxId: "sandbox-hot-approval",
      contentParts: null,
      remainingRunMs: 180_000,
      conversation: {
        id: "conv-hot-runtime-approval",
        userId: "user-1",
      },
    });
    getRuntimeMock.mockResolvedValueOnce({
      id: "runtime-hot-approval",
      conversationId: "conv-hot-runtime-approval",
      callbackToken: "runtime-token",
      sandboxProvider: "e2b",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
      sandboxId: "sandbox-hot-approval",
      sessionId: "session-hot-approval",
      status: "active",
      activeGenerationId: "gen-hot-runtime-approval",
      activeTurnSeq: 1,
      lastBoundAt: new Date("2026-03-11T15:00:00.000Z"),
      createdAt: new Date("2026-03-11T15:00:00.000Z"),
      updatedAt: new Date("2026-03-11T15:00:00.000Z"),
    });
    interruptStore.set("interrupt-hot-runtime-approval", {
      id: "interrupt-hot-runtime-approval",
      generationId: "gen-hot-runtime-approval",
      runtimeId: "runtime-hot-approval",
      conversationId: "conv-hot-runtime-approval",
      turnSeq: 1,
      kind: "runtime_question",
      status: "pending",
      display: {
        title: "Question",
        integration: "cmdclaw",
        operation: "question",
        command: "Choose one",
        toolInput: {
          questions: [{ header: "Pick", question: "Choose one", options: [] }],
        },
      },
      provider: "opencode",
      providerRequestId: "question-request-hot-runtime",
      providerToolUseId: "tool-hot-runtime-approval",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });

    const result = await generationManager.submitApproval(
      "gen-hot-runtime-approval",
      "tool-hot-runtime-approval",
      "approve",
      "user-1",
      [["Work project"]],
    );

    expect(result).toBe(true);
    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-hot-runtime-approval",
        status: "accepted",
        responsePayload: { questionAnswers: [["Work project"]] },
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        resumeInterruptId: "interrupt-hot-runtime-approval",
        deadlineAt: expect.any(Date),
        suspendedAt: null,
        isPaused: false,
        pendingApproval: null,
        pendingAuth: null,
      }),
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-hot-runtime-approval", runMode: "normal_run" },
      expect.objectContaining({
        jobId: expect.stringContaining(
          "resume-interrupt-interrupt-hot-runtime-approval",
        ),
      }),
    );
  });

  it("submits question approval and persists decision for worker reconciliation", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-1",
        toolName: "Question",
        toolInput: { id: "question-request-1" },
        requestedAt: new Date().toISOString(),
        integration: "cmdclaw",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "question-1",
      "approve",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentParts: [
          expect.objectContaining({
            type: "approval",
            tool_use_id: "question-1",
            tool_name: "Question",
            tool_input: { id: "question-request-1" },
            integration: "cmdclaw",
            operation: "question",
            command: "Choose one",
            status: "approved",
          }),
        ],
      }),
    );
  });

  it("submits question answers selected in the frontend", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-3",
        toolName: "Question",
        toolInput: { id: "question-request-3" },
        requestedAt: new Date().toISOString(),
        integration: "cmdclaw",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "question-3",
      "approve",
      ctx.userId,
      [["  Coding/Development  "]],
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentParts: [
          expect.objectContaining({
            type: "approval",
            tool_use_id: "question-3",
            question_answers: [["Coding/Development"]],
            status: "approved",
          }),
        ],
      }),
    );
  });

  it("submits denied question approval and persists deny decision", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-2",
        toolName: "Question",
        toolInput: { id: "question-request-2" },
        requestedAt: new Date().toISOString(),
        integration: "cmdclaw",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "question-2",
      "deny",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentParts: [
          expect.objectContaining({
            type: "approval",
            tool_use_id: "question-2",
            status: "denied",
          }),
        ],
      }),
    );
  });

  it("submits permission approval and persists decision for worker reconciliation", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "permission-1",
        toolName: "Bash",
        toolInput: { command: "slack send" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
        command: "slack send",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "permission-1",
      "approve",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentParts: [
          expect.objectContaining({
            type: "approval",
            tool_use_id: "permission-1",
            tool_name: "Bash",
            status: "approved",
          }),
        ],
      }),
    );
  });

  it("auto-approves OpenCode permission asks when conversation auto-approve is enabled", async () => {
    const permissionReplyMock = vi
      .fn()
      .mockResolvedValue({ data: true, error: undefined });
    const result = await handleOpenCodeRuntimeActionableEvent({
      autoApprove: true,
      client: {
        permission: {
          reply: permissionReplyMock,
        },
        question: {
          reply: vi.fn(),
          reject: vi.fn(),
        },
      },
      event: {
        type: "permission.asked",
        properties: {
          id: "permission-request-auto-approve",
          permission: "external_directory",
          patterns: ["/tmp/non-allowlisted-path"],
        },
      },
    });

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-request-auto-approve",
      reply: "always",
    });
    expect(result).toEqual({ type: "permission", action: "auto_approved" });
  });

  it("auto-approves allowlisted external directories (/tmp and /app)", async () => {
    const permissionReplyMock = vi
      .fn()
      .mockResolvedValue({ data: true, error: undefined });
    const result = await handleOpenCodeRuntimeActionableEvent({
      autoApprove: false,
      client: {
        permission: {
          reply: permissionReplyMock,
        },
        question: {
          reply: vi.fn(),
          reject: vi.fn(),
        },
      },
      event: {
        type: "permission.asked",
        properties: {
          id: "permission-request-allowlisted-paths",
          permission: "external_directory",
          patterns: ["/tmp/hello.txt", "/app/output/report.txt"],
        },
      },
    });

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-request-allowlisted-paths",
      reply: "always",
    });
    expect(result).toEqual({ type: "permission", action: "auto_approved" });
  });

  it("does not auto-answer OpenCode questions when autoApprove is enabled", async () => {
    const questionReplyMock = vi
      .fn()
      .mockResolvedValue({ data: true, error: undefined });
    const client = {
      permission: {
        reply: vi.fn(),
      },
      question: {
        reply: questionReplyMock,
        reject: vi.fn(),
      },
    };
    const request = {
      id: "question-request-manual",
      sessionID: "session-1",
      questions: [
        {
          header: "Destination",
          question: "Where should this run?",
          options: [{ label: "Slack" }],
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-1",
      },
    };

    const result = await handleOpenCodeRuntimeActionableEvent({
      autoApprove: true,
      client,
      event: {
        type: "question.asked",
        properties: request,
      },
    });

    expect(questionReplyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: "question",
      action: "queue",
      request,
      defaultAnswers: buildDefaultQuestionAnswers(request),
      toolUseId: "call-1",
      pendingApproval: {
        integration: "cmdclaw",
        operation: "question",
        toolUseId: "call-1",
      },
    });
  });

  it("queues OpenCode questions with manager progress state", async () => {
    const questionReplyMock = vi
      .fn()
      .mockResolvedValue({ data: true, error: undefined });
    const questionRejectMock = vi
      .fn()
      .mockResolvedValue({ data: true, error: undefined });
    const ctx = createCtx({
      autoApprove: true,
      runtimeId: "runtime-question",
      runtimeTurnSeq: 3,
      opencodeClient: {
        question: {
          reply: questionReplyMock,
          reject: questionRejectMock,
        },
      },
    });
    const mgr = asTestManager();
    const decisionFlow = (mgr as any).decisionFlow;
    const requestApprovalSpy = vi.spyOn(
      decisionFlow,
      "requestRuntimeApproval",
    );
    vi.spyOn(decisionFlow, "waitForRuntimeApprovalDecision").mockResolvedValue(
      {
        decision: "deny",
      },
    );
    const request = {
      id: "question-request-manual",
      sessionID: "session-1",
      questions: [
        {
          header: "Destination",
          question: "Where should this run?",
          options: [{ label: "Slack" }],
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-1",
      },
    };

    await mgr.handleRuntimeActionableEvent(
      ctx,
      {
        question: {
          reply: questionReplyMock,
          reject: questionRejectMock,
        },
      },
      {
        type: "question.asked",
        properties: request,
      },
    );

    expect(questionReplyMock).not.toHaveBeenCalled();
    expect(questionRejectMock).toHaveBeenCalledWith({
      requestID: "question-request-manual",
    });
    expect(ctx.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
          id: "call-1",
          name: "question",
          integration: "cmdclaw",
          operation: "question",
        }),
      ]),
    );
    expect(requestApprovalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx,
        runtimeRequest: {
          kind: "question",
          request,
          defaultAnswers: buildDefaultQuestionAnswers(request),
        },
        pendingApproval: expect.objectContaining({
          integration: "cmdclaw",
          operation: "question",
        }),
      }),
    );
  });

  it("parks an ignored OpenCode approval by snapshotting and tearing down after the hot wait", async () => {
    vi.useFakeTimers();
    const teardownMock = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-durable-approval",
      conversationId: "conv-durable-approval",
      runtimeId: "runtime-durable",
      runtimeTurnSeq: 7,
      sessionId: "session-durable",
      sandboxId: "sandbox-durable",
      sandbox: {
        execute: vi
          .fn()
          .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown: teardownMock,
      },
      deadlineAt: new Date(Date.now() + 123_456),
      remainingRunMs: 15 * 60 * 1000,
      approvalHotWaitMs: 1_000,
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    const queuedApproval = expect(
      mgr.handleRuntimeActionableEvent(
        ctx,
        {
          permission: {
            reply: vi.fn(),
          },
          question: {
            reply: vi.fn(),
            reject: vi.fn(),
          },
        },
        {
          type: "permission.asked",
          properties: {
            id: "permission-request-1",
            permission: "external_directory",
            patterns: ["/workspace/outside"],
          },
        },
      ),
    ).rejects.toThrow("Generation suspended for approval interrupt");
    await vi.advanceTimersByTimeAsync(1_250);
    await queuedApproval;
    vi.useRealTimers();

    expect(createInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: "permission-request-1",
        expiresAt: expect.any(Date),
      }),
    );
    expect(saveConversationSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: ctx.conversationId,
        sessionId: "session-durable",
      }),
    );
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-durable");
    expect(mgr.activeGenerations.has(ctx.id)).toBe(false);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_approval",
        suspendedAt: expect.any(Date),
      }),
    );
  });

  it("finalizes an explicitly expired approval timeout job into terminal error", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      currentInterruptId: "interrupt-stale-approval",
    });
    coworkerRunFindFirstMock.mockResolvedValue({ id: "wf-run-1" });
    interruptStore.set("interrupt-stale-approval", {
      id: "interrupt-stale-approval",
      generationId: ctx.id,
      runtimeId: "runtime-1",
      conversationId: ctx.conversationId,
      turnSeq: 1,
      kind: "plugin_write",
      status: "pending",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send -t hi",
        toolInput: { command: "slack send" },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "plugin-stale",
      responsePayload: undefined,
      requestedAt: new Date(0),
      expiresAt: new Date(1),
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockImplementation(async (input?: unknown) => {
      const request = input as
        | { with?: { conversation?: boolean } }
        | undefined;
      if (request?.with?.conversation) {
        return {
          id: ctx.id,
          conversationId: ctx.conversationId,
          runtimeId: "runtime-1",
          status: "awaiting_approval",
          conversation: {
            id: ctx.conversationId,
            userId: ctx.userId,
            autoApprove: false,
          },
        };
      }
      return {
        id: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: "runtime-1",
        status: "awaiting_approval",
        conversation: {
          id: ctx.conversationId,
          userId: ctx.userId,
        },
      };
    });

    await generationManager.processGenerationTimeout(ctx.id, "approval");
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
    expect(ctx.completionReason).toBe("approval_timeout");
    expect(ctx.errorMessage).toBe(
      "Approval request expired before the run could continue.",
    );
  });

  it("accepts an auth interrupt and resumes persisted generation state", async () => {
    const ctx = createCtx({
      status: "awaiting_auth",
      pendingAuth: {
        integrations: ["slack"],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: "runtime-1",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const first = await generationManager.submitAuthResult(
      ctx.id,
      "slack",
      true,
      ctx.userId,
    );
    expect(first).toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        pendingAuth: null,
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: "generating",
      }),
    );
    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        responsePayload: {
          connectedIntegrations: ["slack"],
          integration: "slack",
        },
      }),
    );
  });

  it("accepts a detached auth result and enqueues the same generation as a suspended resume", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-auth",
      conversationId: "conv-detached-auth",
      status: "awaiting_auth",
      contentParts: null,
      remainingRunMs: 333_000,
      conversation: {
        id: "conv-detached-auth",
        userId: "user-1",
      },
    });
    interruptStore.set("interrupt-detached-auth", {
      id: "interrupt-detached-auth",
      generationId: "gen-detached-auth",
      runtimeId: "runtime-1",
      conversationId: "conv-detached-auth",
      turnSeq: 1,
      kind: "auth",
      status: "pending",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["notion"] },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "auth-detached-notion",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });

    const result = await generationManager.submitAuthResult(
      "gen-detached-auth",
      "notion",
      true,
      "user-1",
    );

    expect(result).toBe(true);
    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-detached-auth",
        status: "accepted",
        responsePayload: {
          connectedIntegrations: ["notion"],
          integration: "notion",
        },
        resolvedByUserId: "user-1",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeInterruptId: "interrupt-detached-auth",
        deadlineAt: expect.any(Date),
        suspendedAt: null,
      }),
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-detached-auth", runMode: "normal_run" },
      expect.objectContaining({
        jobId: expect.stringContaining(
          "resume-interrupt-interrupt-detached-auth",
        ),
      }),
    );
  });

  it("resumeGeneration re-enqueues chat work instead of running inline", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-resume",
      status: "paused",
      conversationId: "conv-resume",
      conversation: {
        id: "conv-resume",
        userId: "user-1",
        autoApprove: false,
      },
      executionPolicy: {
        autoApprove: false,
      },
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce(null);

    const resumed = await generationManager.resumeGeneration(
      "gen-resume",
      "user-1",
    );

    expect(resumed).toBe(true);
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-resume", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(asTestManager().activeGenerations.has("gen-resume")).toBe(false);
  });

  it("finalizes an explicitly expired auth timeout job into terminal error", async () => {
    const ctx = createCtx({
      status: "awaiting_auth",
      currentInterruptId: "interrupt-auth-stale",
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    interruptStore.set("interrupt-auth-stale", {
      id: "interrupt-auth-stale",
      generationId: ctx.id,
      runtimeId: "runtime-1",
      conversationId: ctx.conversationId,
      turnSeq: 1,
      kind: "auth",
      status: "pending",
      display: {
        title: "Auth Required",
        authSpec: { integrations: ["slack"] },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "auth-stale",
      responsePayload: undefined,
      requestedAt: new Date(0),
      expiresAt: new Date(1),
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });
    generationFindFirstMock.mockImplementation(async () => ({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: "runtime-1",
      status: "awaiting_auth",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
      cancelRequestedAt: null,
    }));

    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    await generationManager.processGenerationTimeout(ctx.id, "auth");
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
    expect(ctx.completionReason).toBe("auth_timeout");
    expect(ctx.errorMessage).toBe(
      "Authentication request expired before the run could continue.",
    );
  });

  it("starts a new generation and enqueues background run", async () => {
    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-new",
          userId: "user-1",
          model: "anthropic/claude-opus-4-1",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-new" }]);

    const result = await generationManager.startGeneration({
      content: "Write a status update",
      userId: "user-1",
    });

    expect(result).toEqual({
      generationId: "gen-new",
      conversationId: "conv-new",
    });
    expect(queueAddMock).toHaveBeenNthCalledWith(
      1,
      "generation:preparing-stuck-check",
      { generationId: "gen-new" },
      expect.objectContaining({
        delay: generationLifecyclePolicy.bootstrapTimeoutMs,
        jobId: "generation:preparing-stuck-check-gen-new",
        removeOnComplete: true,
        removeOnFail: 500,
      }),
    );
    expect(queueAddMock).toHaveBeenNthCalledWith(
      2,
      "generation:chat-run",
      { generationId: "gen-new", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(asTestManager().activeGenerations.has("gen-new")).toBe(false);
  });

  it("persists a debug run deadline override when starting chat generation", async () => {
    const startedAtMs = Date.now();
    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-debug-deadline",
          userId: "user-1",
          model: "anthropic/claude-opus-4-1",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-debug-deadline" }]);

    await generationManager.startGeneration({
      content: "Run until the debug deadline",
      userId: "user-1",
      debugRunDeadlineMs: 60_000,
    });

    const generationInsert = insertValuesMock.mock.calls[2]?.[0] as {
      deadlineAt?: Date;
      remainingRunMs?: number;
      executionPolicy?: { debugRunDeadlineMs?: number };
    };
    expect(generationInsert.remainingRunMs).toBe(60_000);
    expect(generationInsert.executionPolicy?.debugRunDeadlineMs).toBe(60_000);
    expect(generationInsert.deadlineAt).toBeInstanceOf(Date);
    const deadlineDeltaMs =
      generationInsert.deadlineAt!.getTime() - startedAtMs;
    expect(deadlineDeltaMs).toBeGreaterThanOrEqual(60_000);
    expect(deadlineDeltaMs).toBeLessThan(61_000);
  });

  it("rejects invalid debug run deadline overrides", async () => {
    await expect(
      generationManager.startGeneration({
        content: "hello",
        userId: "user-1",
        debugRunDeadlineMs: 999,
      }),
    ).rejects.toThrow("debugRunDeadlineMs must be an integer");

    await expect(
      generationManager.startGeneration({
        content: "hello",
        userId: "user-1",
        debugRunDeadlineMs: 16 * 60 * 1000,
      }),
    ).rejects.toThrow("debugRunDeadlineMs must be an integer");
  });

  it("does not persist per-run autoApprove onto an existing conversation", async () => {
    generationFindFirstMock.mockResolvedValueOnce(null);
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-existing",
      userId: "user-1",
      model: "anthropic/claude-opus-4-1",
      autoApprove: true,
      type: "chat",
    });
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-existing" }]);

    const result = await generationManager.startGeneration({
      conversationId: "conv-existing",
      content: "hello",
      userId: "user-1",
      autoApprove: false,
    });

    expect(result).toEqual({
      generationId: "gen-existing",
      conversationId: "conv-existing",
    });
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-existing", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(updateSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprove: false,
      }),
    );
  });

  it("fills coworker metadata from the first builder user message before the prompt patch lands", async () => {
    const updatedAt = new Date("2026-03-12T10:00:00.000Z");
    const refreshedUpdatedAt = new Date("2026-03-12T10:00:01.000Z");

    generationFindFirstMock.mockResolvedValueOnce(null);
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-builder",
      userId: "user-1",
      model: "anthropic/claude-opus-4-1",
      autoApprove: false,
      type: "coworker",
    });
    coworkerFindFirstMock
      .mockResolvedValueOnce({
        id: "cw-1",
        prompt: "",
        model: "anthropic/claude-opus-4-1",
        toolAccessMode: "all",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["slack"],
        updatedAt,
      })
      .mockResolvedValueOnce({
        id: "cw-1",
        name: "",
        description: null,
        username: null,
        prompt: "",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: false,
        promptDo: null,
        promptDont: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "cw-1",
        prompt: "",
        model: "anthropic/claude-opus-4-1",
        toolAccessMode: "all",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["slack"],
        updatedAt: refreshedUpdatedAt,
      });
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-coworker-builder" }]);

    await generationManager.startGeneration({
      conversationId: "conv-coworker-builder",
      content: "Follow up with new inbound leads after every sales call.",
      userId: "user-1",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-coworker-builder", runMode: "normal_run" },
      expect.any(Object),
    );
    const metadataUpdateCall = updateSetMock.mock.calls.find(
      ([values]) =>
        typeof values?.name === "string" &&
        typeof values?.description === "string",
    )?.[0] as
      | { name: string; description: string; username?: string }
      | undefined;

    expect(metadataUpdateCall).toMatchObject({
      name: "Follow up with new inbound leads after every sales call",
      description: "Follow up with new inbound leads after every sales call.",
    });
    expect(metadataUpdateCall?.username).toMatch(
      /^follow-up-with-new-inbound-leads-after-every-sales-call/,
    );
  });

  it("returns an empty queued-message list when conversation no longer exists", async () => {
    conversationFindFirstMock.mockResolvedValue(null);

    const result = await generationManager.listConversationQueuedMessages(
      "conv-missing",
      "user-1",
    );

    expect(result).toEqual([]);
    expect(conversationQueuedMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("enqueues queued messages for coworker conversations", async () => {
    dbMock.delete.mockClear();
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-builder",
      userId: "user-1",
      type: "coworker",
    });
    insertReturningMock.mockResolvedValueOnce([{ id: "queue-coworker-1" }]);

    const result = await generationManager.enqueueConversationMessage({
      conversationId: "conv-coworker-builder",
      userId: "user-1",
      content: "Steer the builder toward CRM follow-up.",
    });

    expect(result).toEqual({ queuedMessageId: "queue-coworker-1" });
    expect(dbMock.delete).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith(
      "conversation:queued-message-process",
      { conversationId: "conv-coworker-builder" },
      expect.any(Object),
    );
  });

  it("lists queued messages for coworker conversations", async () => {
    const createdAt = new Date("2026-03-12T10:00:00.000Z");
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-run",
      userId: "user-1",
      type: "coworker",
    });
    conversationQueuedMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "queue-coworker-1",
        content: "Steer the runner toward the latest customer reply.",
        fileAttachments: undefined,
        selectedPlatformSkillSlugs: ["gmail"],
        status: "queued",
        createdAt,
      },
    ]);

    const result = await generationManager.listConversationQueuedMessages(
      "conv-coworker-run",
      "user-1",
    );

    expect(result).toEqual([
      {
        id: "queue-coworker-1",
        content: "Steer the runner toward the latest customer reply.",
        fileAttachments: undefined,
        selectedPlatformSkillSlugs: ["gmail"],
        status: "queued",
        createdAt,
      },
    ]);
  });

  it("updates queued messages without changing their queue position", async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: "queue-coworker-1" }]);

    const result = await generationManager.updateConversationQueuedMessage({
      queuedMessageId: "queue-coworker-1",
      conversationId: "conv-coworker-run",
      userId: "user-1",
      content: "Steer the runner toward the latest customer reply.",
      selectedPlatformSkillSlugs: ["gmail"],
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      content: "Steer the runner toward the latest customer reply.",
      fileAttachments: null,
      selectedPlatformSkillSlugs: ["gmail"],
    });
  });

  it("processes queued messages for coworker conversations once idle", async () => {
    const startGenerationSpy = vi
      .spyOn(generationManager, "startGeneration")
      .mockResolvedValue({
        generationId: "gen-next",
        conversationId: "conv-coworker-run",
      });

    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-run",
      type: "coworker",
    });
    generationFindFirstMock.mockResolvedValueOnce(null);
    conversationQueuedMessageFindFirstMock.mockResolvedValueOnce({
      id: "queue-coworker-1",
    });
    updateReturningMock.mockResolvedValueOnce([
      {
        id: "queue-coworker-1",
        userId: "user-1",
        content: "Steer the runner toward the urgent issue first.",
        fileAttachments: null,
        selectedPlatformSkillSlugs: ["fill-pdf"],
      },
    ]);

    await generationManager.processConversationQueuedMessages(
      "conv-coworker-run",
    );

    expect(startGenerationSpy).toHaveBeenCalledWith({
      conversationId: "conv-coworker-run",
      userId: "user-1",
      content: "Steer the runner toward the urgent issue first.",
      fileAttachments: undefined,
      selectedPlatformSkillSlugs: ["fill-pdf"],
    });
  });

  it("forces opencode backend for OpenAI subscription models even when Daytona is preferred", async () => {
    vi.mocked(getPreferredCloudSandboxProvider).mockReturnValue("daytona");

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-openai",
          userId: "user-1",
          model: "openai/gpt-5.4",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-openai" }]);

    sharedProviderAuthFindFirstMock.mockResolvedValue({
      id: "shared-auth-openai",
    });

    await generationManager.startGeneration({
      content: "hi",
      userId: "user-1",
      model: "openai/gpt-5.4",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-openai", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(asTestManager().activeGenerations.has("gen-openai")).toBe(false);
  });

  it("enqueues run and preparing-stuck check jobs for every new chat generation", async () => {
    const pdfAttachment = {
      name: "questionnaire.pdf",
      mimeType: "application/pdf",
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
    };

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-new",
          userId: "user-1",
          model: "anthropic/claude-opus-4-1",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-new" }]);

    await generationManager.startGeneration({
      content: "hi",
      userId: "user-1",
      fileAttachments: [pdfAttachment],
    });

    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenNthCalledWith(
      1,
      "generation:preparing-stuck-check",
      { generationId: "gen-new" },
      expect.objectContaining({
        delay: generationLifecyclePolicy.bootstrapTimeoutMs,
        jobId: "generation:preparing-stuck-check-gen-new",
        removeOnComplete: true,
        removeOnFail: 500,
      }),
    );
    expect(queueAddMock).toHaveBeenNthCalledWith(
      2,
      "generation:chat-run",
      { generationId: "gen-new", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineAt: expect.any(Date),
        lastRuntimeEventAt: expect.any(Date),
        recoveryAttempts: 0,
        completionReason: null,
        executionPolicy: expect.objectContaining({
          queuedFileAttachments: [pdfAttachment],
        }),
      }),
    );
  });

  it("self-heals queued generations that never leave their pristine running state", async () => {
    const mgr = asTestManager();
    const runQueuedGenerationSpy = vi
      .spyOn(mgr as never, "runQueuedGeneration")
      .mockResolvedValue(undefined);

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-self-heal",
      conversationId: "conv-self-heal",
      status: "running",
      messageId: null,
      sandboxId: null,
      runtimeHarness: null,
      runtimeProtocolVersion: null,
      completedAt: null,
    });
    generationStreamExistsMock.mockResolvedValueOnce(false);

    await (mgr as any).generationRunQueue.runQueuedGenerationSelfHealIfStalled({
      generationId: "gen-self-heal",
      runMode: "normal_run",
    });

    expect(runQueuedGenerationSpy).toHaveBeenCalledWith(
      "gen-self-heal",
      "normal_run",
    );
  });

  it("skips queued generation self-heal when another process already holds the lease", async () => {
    const mgr = asTestManager();
    const runQueuedGenerationSpy = vi
      .spyOn(mgr as never, "runQueuedGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(
      (mgr as any).generationRunQueue as never,
      "isGenerationLeaseHeld",
    ).mockResolvedValueOnce(true);

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-self-heal",
      conversationId: "conv-self-heal",
      status: "running",
      messageId: null,
      sandboxId: null,
      runtimeHarness: null,
      runtimeProtocolVersion: null,
      completedAt: null,
    });

    await (mgr as any).generationRunQueue.runQueuedGenerationSelfHealIfStalled({
      generationId: "gen-self-heal",
      runMode: "normal_run",
    });

    expect(runQueuedGenerationSpy).not.toHaveBeenCalled();
  });

  it("schedules queued generation self-heal after the queue grace period", async () => {
    vi.useFakeTimers();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const expectedDelayMs =
      1_000 +
      Number.parseInt(process.env.GEN_QUEUE_SELF_HEAL_DELAY_MS ?? "5000", 10);

    try {
      const mgr = asTestManager();
      const selfHealSpy = vi
        .spyOn(
          (mgr as any).generationRunQueue as never,
          "runQueuedGenerationSelfHealIfStalled",
        )
        .mockResolvedValue(undefined);

      (mgr as any).generationRunQueue.scheduleQueuedGenerationSelfHeal(
        "gen-timer",
        "normal_run",
        1_000,
      );

      await vi.advanceTimersByTimeAsync(expectedDelayMs - 1);
      expect(selfHealSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(selfHealSpy).toHaveBeenCalledWith({
        generationId: "gen-timer",
        runMode: "normal_run",
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      vi.useRealTimers();
    }
  });
  it("rehydrates queued file attachments into generation context", async () => {
    const mgr = asTestManager();
    const runSpy = vi
      .spyOn((mgr as any).turnRunner, "runGeneration")
      .mockResolvedValue(undefined);
    const queuedAttachment = {
      name: "questionnaire.pdf",
      mimeType: "application/pdf",
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
    };

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-queued",
      status: "running",
      conversationId: "conv-queued",
      conversation: {
        id: "conv-queued",
        userId: "user-1",
        autoApprove: false,
        model: "anthropic/claude-sonnet-4-6",
      },
      contentParts: [],
      pendingApproval: null,
      pendingAuth: null,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: new Date(),
      executionPolicy: {
        autoApprove: false,
        queuedFileAttachments: [queuedAttachment],
      },
    });
    messageFindFirstMock.mockResolvedValueOnce({
      content: "fill this pdf",
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce(null);

    await generationManager.runQueuedGeneration("gen-queued");

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [queuedAttachment],
      }),
      "normal_run",
      "local-gen-queued",
    );
  });

  it("rehydrates coworker ids for queued coworker generations", async () => {
    const mgr = asTestManager();
    const runSpy = vi
      .spyOn((mgr as any).turnRunner, "runGeneration")
      .mockResolvedValue(undefined);

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-coworker-queued",
      status: "running",
      conversationId: "conv-coworker-queued",
      conversation: {
        id: "conv-coworker-queued",
        userId: "user-1",
        autoApprove: false,
        model: "anthropic/claude-sonnet-4-6",
        type: "coworker",
      },
      contentParts: [],
      pendingApproval: null,
      pendingAuth: null,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: new Date(),
      executionPolicy: {
        autoApprove: false,
      },
    });
    messageFindFirstMock.mockResolvedValueOnce({
      content: "run the coworker",
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce({
      id: "wf-run-1",
      coworkerId: "wf-1",
      triggerPayload: null,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: "wf-1",
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      allowedSkillSlugs: [],
      prompt: "prompt",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      promptDo: null,
      promptDont: null,
      autoApprove: false,
      updatedAt: new Date("2026-03-11T15:00:00.000Z"),
    });

    await generationManager.runQueuedGeneration("gen-coworker-queued");

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        coworkerRunId: "wf-run-1",
      }),
      "normal_run",
      "local-gen-coworker-queued",
    );
  });

  it("skips queued generation rehydration when the runtime has been rebound to another generation", async () => {
    const mgr = asTestManager();
    const runSpy = vi
      .spyOn((mgr as any).turnRunner, "runGeneration")
      .mockResolvedValue(undefined);

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-stale",
      status: "running",
      conversationId: "conv-queued",
      runtimeId: "runtime-1",
      conversation: {
        id: "conv-queued",
        userId: "user-1",
        autoApprove: false,
        model: "anthropic/claude-sonnet-4-6",
      },
      contentParts: [],
      pendingApproval: null,
      pendingAuth: null,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: new Date(),
      executionPolicy: {
        autoApprove: false,
      },
    });
    getRuntimeMock.mockResolvedValueOnce({
      id: "runtime-1",
      conversationId: "conv-queued",
      callbackToken: "runtime-token",
      sandboxProvider: null,
      runtimeHarness: null,
      runtimeProtocolVersion: null,
      sandboxId: null,
      sessionId: null,
      status: "active",
      activeGenerationId: "gen-other",
      activeTurnSeq: 2,
      lastBoundAt: null,
      createdAt: new Date("2026-03-11T15:00:00.000Z"),
      updatedAt: new Date("2026-03-11T15:00:00.000Z"),
    });

    await generationManager.runQueuedGeneration("gen-stale");

    expect(runSpy).not.toHaveBeenCalled();
    expect(mgr.activeGenerations.has("gen-stale")).toBe(false);
  });

  it("reports stuck preparing generations and pushes to kuma", async () => {
    process.env.KUMA_PUSH_URL = "https://kuma.example/push/abc";
    const mgr = asTestManager();
    mgr.activeGenerations.set("gen-stuck", createCtx({ id: "gen-stuck" }));
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-stuck",
      status: "running",
      sandboxId: null,
      completedAt: null,
      startedAt: new Date(Date.now() - 6 * 60 * 1000),
      conversation: {
        id: "conv-stuck",
        userId: "user-1",
        type: "chat",
      },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await generationManager.processPreparingStuckCheck("gen-stuck");

    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "GENERATION_PREPARING_STUCK_DETECTED",
      expect.objectContaining({
        generationId: "gen-stuck",
        conversationId: "conv-stuck",
        userId: "user-1",
      }),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain("status=down");
    expect(calledUrl).toContain("conversation%3Dconv-stuck");
    expect(calledUrl).toContain("user%3Duser-1");
  });

  it("finalizes detached preparing generations as bootstrap timeouts", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-stuck",
      status: "running",
      sandboxId: null,
      runtimeId: "runtime-1",
      completedAt: null,
      startedAt: new Date(Date.now() - 6 * 60 * 1000),
      conversationId: "conv-detached-stuck",
      conversation: {
        id: "conv-detached-stuck",
        userId: "user-1",
        type: "coworker",
      },
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce({ id: "wf-run-1" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await generationManager.processPreparingStuckCheck("gen-detached-stuck");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        completionReason: "bootstrap_timeout",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects startGeneration when an active generation already exists in DB", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-existing",
      status: "running",
    });

    await expect(
      generationManager.startGeneration({
        conversationId: "conv-existing",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Generation already in progress for this conversation");
  });

  it("allows attach resume when the active generation is paused for a run deadline and the new turn is continue", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-paused-deadline",
      status: "paused",
      completionReason: "run_deadline",
    });
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-deadline",
      userId: "user-1",
      model: "anthropic/claude-opus-4-1",
      authSource: "shared",
      autoApprove: false,
      type: "chat",
    });
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-continue" }])
      .mockResolvedValueOnce([{ id: "gen-resumed" }]);

    const result = await generationManager.startGeneration({
      conversationId: "conv-deadline",
      content: "continue",
      userId: "user-1",
    });

    expect(result).toEqual({
      generationId: "gen-resumed",
      conversationId: "conv-deadline",
    });
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-resumed", runMode: "normal_run" },
      expect.any(Object),
    );
  });

  it("rejects startGeneration when conversation belongs to another user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-1",
      userId: "other-user",
      model: "anthropic/claude-sonnet-4-6",
      autoApprove: false,
    });

    await expect(
      generationManager.startGeneration({
        conversationId: "conv-1",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Access denied");
  });

  it("rejects startGeneration when an OpenAI model is selected without ChatGPT connection", async () => {
    sharedProviderAuthFindFirstMock.mockResolvedValueOnce(null);

    insertReturningMock.mockResolvedValueOnce([
      {
        id: "conv-new",
        userId: "user-1",
        model: "openai/gpt-5.4",
        autoApprove: false,
        type: "chat",
      },
    ]);

    await expect(
      generationManager.startGeneration({
        content: "hello",
        userId: "user-1",
        model: "openai/gpt-5.4",
      }),
    ).rejects.toThrow(
      "This ChatGPT model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    );
  });

  it("rejects startGeneration when a Gemini model is selected without shared Gemini connection", async () => {
    sharedProviderAuthFindFirstMock.mockResolvedValueOnce(null);

    insertReturningMock.mockResolvedValueOnce([
      {
        id: "conv-new",
        userId: "user-1",
        model: "google/gemini-3.1-pro-preview",
        autoApprove: false,
        type: "chat",
      },
    ]);

    await expect(
      generationManager.startGeneration({
        content: "hello",
        userId: "user-1",
        model: "google/gemini-3.1-pro-preview",
      }),
    ).rejects.toThrow(
      "This Gemini model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    );
  });

  it("uses shared auth when explicitly requested for a dual-source provider", async () => {
    providerAuthFindFirstMock.mockRejectedValue(
      new Error("Token refresh failed: refresh token already used"),
    );
    sharedProviderAuthFindFirstMock.mockResolvedValue({
      id: "shared-auth-openai",
    });

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-openai-shared",
          userId: "user-1",
          model: "openai/gpt-5.4",
          authSource: "shared",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-openai-shared" }]);

    await generationManager.startGeneration({
      content: "hello",
      userId: "user-1",
      model: "openai/gpt-5.4",
      authSource: "shared",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-openai-shared", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(providerAuthFindFirstMock).not.toHaveBeenCalled();
    expect(sharedProviderAuthFindFirstMock).toHaveBeenCalled();
  });

  it("starts generation when a shared Gemini model is connected", async () => {
    sharedProviderAuthFindFirstMock.mockResolvedValue({
      id: "shared-auth-google",
    });

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-google-shared",
          userId: "user-1",
          model: "google/gemini-3.1-pro-preview",
          authSource: "shared",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-google-shared" }]);

    await generationManager.startGeneration({
      content: "hello",
      userId: "user-1",
      model: "google/gemini-3.1-pro-preview",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-google-shared", runMode: "normal_run" },
      expect.any(Object),
    );
  });

  it("rejects unsupported auth sources for shared-only providers", async () => {
    await expect(
      generationManager.startGeneration({
        content: "hello",
        userId: "user-1",
        model: "anthropic/claude-sonnet-4-6",
        authSource: "user",
      }),
    ).rejects.toThrow(
      'Model provider "anthropic" does not support auth source "user".',
    );
  });

  it("starts coworker generation and keeps coworker context fields", async () => {
    providerAuthFindFirstMock.mockResolvedValue({ id: "auth-openai" });

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-coworker",
          userId: "user-1",
          model: "anthropic/claude-opus-4-1",
          autoApprove: true,
          type: "coworker",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-coworker-user" }])
      .mockResolvedValueOnce([{ id: "gen-coworker" }]);

    const result = await generationManager.startCoworkerGeneration({
      coworkerId: "wf-1",
      coworkerRunId: "wf-run-1",
      content: "Create a weekly report",
      userId: "user-1",
      autoApprove: true,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: ["custom-slug"],
      model: "anthropic/claude-opus-4-1",
    });

    expect(result).toEqual({
      generationId: "gen-coworker",
      conversationId: "conv-coworker",
    });
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:coworker-run",
      { generationId: "gen-coworker", runMode: "normal_run" },
      expect.any(Object),
    );
    expect(asTestManager().activeGenerations.has("gen-coworker")).toBe(false);
  });

  it("rejects inaccessible saved coworker models before generation starts", async () => {
    sharedProviderAuthFindFirstMock.mockResolvedValueOnce(null);

    await expect(
      generationManager.startCoworkerGeneration({
        coworkerId: "wf-1",
        coworkerRunId: "wf-run-1",
        content: "Create a weekly report",
        userId: "user-1",
        autoApprove: true,
        allowedIntegrations: ["github"],
        model: "openai/gpt-5.4",
      }),
    ).rejects.toThrow(
      "This ChatGPT model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    );
  });

  it("returns status from database when context is active", async () => {
    const ctx = createCtx({
      contentParts: [{ type: "text", text: "hello" }],
      usage: { inputTokens: 3, outputTokens: 5, totalCostUsd: 0 },
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: {},
        requestedAt: new Date().toISOString(),
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      status: "running",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: { toolUseId: "tool-db" },
      inputTokens: 6,
      outputTokens: 8,
    });

    const status = await generationManager.getGenerationStatus(ctx.id);

    expect(status).toEqual({
      status: "running",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: null,
      usage: { inputTokens: 6, outputTokens: 8 },
    });
  });

  it("returns status from database when context is not active", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: { toolUseId: "tool-db" },
      inputTokens: 9,
      outputTokens: 11,
    });

    const status = await generationManager.getGenerationStatus("gen-db");

    expect(status).toEqual({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: null,
      usage: { inputTokens: 9, outputTokens: 11 },
    });
  });

  it("subscribes from DB terminal state and replays terminal events", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-db",
      conversationId: "conv-db",
      status: "completed",
      messageId: "msg-final",
      inputTokens: 7,
      outputTokens: 13,
      errorMessage: null,
      conversation: {
        userId: "user-1",
      },
      contentParts: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
          integration: "slack",
          operation: "send",
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
        { type: "thinking", id: "think-1", content: "..." },
      ],
    });

    const events = await collectEvents(
      generationManager.subscribeToGeneration("gen-db", "user-1"),
    );

    expect(events).toEqual([
      { type: "text", content: "hi" },
      {
        type: "tool_use",
        toolName: "bash",
        toolInput: { command: "echo hi" },
        toolUseId: "tool-1",
        integration: "slack",
        operation: "send",
      },
      {
        type: "tool_result",
        toolName: "bash",
        result: "ok",
        toolUseId: "tool-1",
      },
      { type: "thinking", content: "...", thinkingId: "think-1" },
      { type: "status_change", status: "completed" },
      {
        type: "done",
        generationId: "gen-db",
        conversationId: "conv-db",
        messageId: "msg-final",
        usage: { inputTokens: 7, outputTokens: 13, totalCostUsd: 0 },
      },
    ]);
  });

  it("subscribes from active context and replays pending approval/auth state", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      contentParts: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "ls" },
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
      ],
      pendingApproval: {
        toolUseId: "tool-pending",
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/x" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
        command: "rm -rf /tmp/x",
      },
      pendingAuth: null,
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        pendingAuth: null,
      })
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        pendingAuth: null,
      })
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "cancelled",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: null,
        pendingAuth: null,
      });

    const eventsPromise = collectEvents(
      generationManager.subscribeToGeneration(ctx.id, ctx.userId),
    );
    await vi.advanceTimersByTimeAsync(500);
    const events = await eventsPromise;

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text", content: "hi" },
        {
          type: "tool_use",
          toolName: "bash",
          toolInput: { command: "ls" },
          toolUseId: "tool-1",
        },
        {
          type: "tool_result",
          toolName: "bash",
          result: "ok",
          toolUseId: "tool-1",
        },
        { type: "status_change", status: "awaiting_approval" },
        {
          type: "interrupt_pending",
          interruptId: "interrupt-tool-pending",
          generationId: "gen-1",
          runtimeId: "runtime-1",
          conversationId: "conv-1",
          turnSeq: 1,
          kind: "plugin_write",
          status: "pending",
          providerToolUseId: "tool-pending",
          display: {
            title: "Bash",
            toolInput: { command: "rm -rf /tmp/x" },
            integration: "slack",
            operation: "send",
            command: "rm -rf /tmp/x",
          },
          responsePayload: undefined,
        },
        {
          type: "status_change",
          status: "cancelled",
        },
        {
          type: "cancelled",
          generationId: "gen-1",
          conversationId: "conv-1",
          messageId: undefined,
        },
      ]),
    );
  });

  it("dispatches runGeneration to session reset and opencode backend", async () => {
    const mgr = asTestManager();
    const resetSpy = vi
      .spyOn(mgr, "handleSessionReset")
      .mockResolvedValue(undefined);
    const opencodeSpy = vi
      .spyOn(mgr, "runOpenCodeGeneration")
      .mockResolvedValue(undefined);

    await mgr.runGeneration(
      createCtx({ userMessageContent: " /new ", backendType: "opencode" }),
    );
    await mgr.runGeneration(
      createCtx({ userMessageContent: "hello", backendType: "opencode" }),
    );

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(opencodeSpy).toHaveBeenCalledTimes(1);
  });

  it("finishes completed generation, emits done, and cleans up in-memory state", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-1" }]);

    const ctx = createCtx({
      assistantContent: "Final answer",
      contentParts: [{ type: "text", text: "Final answer" }],
      sessionId: "session-1",
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    await mgr.finishGeneration(ctx, "completed");

    expect(ctx.status).toBe("completed");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: "complete",
        usageInputTokens: expect.anything(),
        usageOutputTokens: expect.anything(),
        usageTotalTokens: expect.anything(),
        usageAssistantMessageCount: expect.anything(),
      }),
    );
    expect(publishGenerationStreamEventMock).toHaveBeenCalled();
    expect(mgr.activeGenerations.has(ctx.id)).toBe(false);
  });

  it("auto-collects only sandbox files mentioned in final answer text", async () => {
    insertReturningMock.mockResolvedValueOnce([
      { id: "msg-assistant-files-1" },
    ]);
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([
      {
        path: "/app/QUESTIONNAIRE_RCP_rempli.pdf",
        content: Buffer.from("pdf"),
      },
      { path: "/app/rcp_payload.json", content: Buffer.from("{}") },
    ]);
    vi.mocked(uploadSandboxFile).mockResolvedValue({
      id: "sandbox-file-mentioned",
      filename: "QUESTIONNAIRE_RCP_rempli.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      path: "/app/QUESTIONNAIRE_RCP_rempli.pdf",
      storageKey: "k/QUESTIONNAIRE_RCP_rempli.pdf",
    });

    const ctx = createCtx({
      assistantContent:
        "Questionnaire rempli avec les informations personnelles fournies et télécharge ici : `QUESTIONNAIRE_RCP_rempli.pdf`.",
      contentParts: [
        {
          type: "text",
          text: "Questionnaire rempli avec les informations personnelles fournies et télécharge ici : `QUESTIONNAIRE_RCP_rempli.pdf`.",
        },
      ],
      generationMarkerTime: Date.now() - 1_000,
      sandbox: {} as unknown,
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    await mgr.finishGeneration(ctx, "completed");

    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/app/QUESTIONNAIRE_RCP_rempli.pdf",
      }),
    );
    expect(ctx.uploadedSandboxFileIds?.has("sandbox-file-mentioned")).toBe(
      true,
    );
  });

  it("does not auto-collect sandbox files when none are mentioned in final answer text", async () => {
    insertReturningMock.mockResolvedValueOnce([
      { id: "msg-assistant-files-2" },
    ]);
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([
      {
        path: "/app/questionnaire-rcp-pdf.template.json",
        content: Buffer.from("{}"),
      },
    ]);

    const ctx = createCtx({
      assistantContent: "Traitement terminé.",
      contentParts: [{ type: "text", text: "Traitement terminé." }],
      generationMarkerTime: Date.now() - 1_000,
      sandbox: {} as unknown,
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    await mgr.finishGeneration(ctx, "completed");

    expect(vi.mocked(uploadSandboxFile)).not.toHaveBeenCalled();
    expect(ctx.uploadedSandboxFileIds?.size).toBe(0);
  });

  it("finishes cancelled generation with interruption marker and emits cancelled", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-2" }]);

    const ctx = createCtx({
      assistantContent: "",
      contentParts: [{ type: "text", text: "partial" }],
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    await mgr.finishGeneration(ctx, "cancelled");

    expect(ctx.status).toBe("cancelled");
    expect(
      ctx.contentParts.some(
        (p: unknown) =>
          !!p &&
          typeof p === "object" &&
          (p as { type?: unknown }).type === "system" &&
          (p as { content?: unknown }).content === "Interrupted by user",
      ),
    ).toBe(true);
    expect(publishGenerationStreamEventMock).toHaveBeenCalled();
  });

  it("publishes the captured original error as an error-stream diagnostic", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-error-1" }]);

    const ctx = createCtx({
      errorMessage: "The sandbox stopped while this run was still active.",
      debugInfo: {
        originalErrorMessage: "SandboxError: 403: blocked: team is blocked",
      },
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    await mgr.finishGeneration(ctx, "error");

    const publishedPayloads = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    )
      .map(([, envelope]) => (envelope as { payload?: unknown }).payload)
      .filter(Boolean);

    expect(publishedPayloads).toContainEqual(
      expect.objectContaining({
        type: "error",
        message:
          "The sandbox stopped while this run was still active.\nUnderlying error: SandboxError: 403: blocked: team is blocked",
        diagnosticMessage: "SandboxError: 403: blocked: team is blocked",
      }),
    );
  });

  it("handles submitApproval guard paths (missing context, access denied, mismatched toolUseId)", async () => {
    const missing = await generationManager.submitApproval(
      "missing",
      "tool-1",
      "approve",
      "user-1",
    );
    expect(missing).toBe(false);

    const deniedCtx = createCtx({
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: {},
        requestedAt: new Date().toISOString(),
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set("gen-denied", deniedCtx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-denied",
      conversationId: deniedCtx.conversationId,
      pendingApproval: deniedCtx.pendingApproval,
      conversation: {
        id: deniedCtx.conversationId,
        userId: deniedCtx.userId,
      },
    });

    await expect(
      generationManager.submitApproval(
        "gen-denied",
        "tool-1",
        "approve",
        "other-user",
      ),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-denied",
      conversationId: deniedCtx.conversationId,
      pendingApproval: deniedCtx.pendingApproval,
      conversation: {
        id: deniedCtx.conversationId,
        userId: deniedCtx.userId,
      },
    });
    const mismatch = await generationManager.submitApproval(
      "gen-denied",
      "tool-does-not-match",
      "approve",
      deniedCtx.userId,
    );
    expect(mismatch).toBe(false);
  });

  it("handles submitAuthResult guard paths and cancellation path", async () => {
    const missing = await generationManager.submitAuthResult(
      "missing",
      "slack",
      true,
      "user-1",
    );
    expect(missing).toBe(false);

    const mgr = asTestManager();
    const ctx = createCtx({ pendingAuth: null });
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingAuth: null,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    await expect(
      generationManager.submitAuthResult(ctx.id, "slack", true, "other-user"),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingAuth: null,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });
    const noPending = await generationManager.submitAuthResult(
      ctx.id,
      "slack",
      true,
      ctx.userId,
    );
    expect(noPending).toBe(false);

    const ctxWithPendingAuth = createCtx({
      id: "gen-auth-fail",
      status: "awaiting_auth",
      pendingAuth: {
        integrations: ["slack"],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
      },
    });
    mgr.activeGenerations.set(ctxWithPendingAuth.id, ctxWithPendingAuth);
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctxWithPendingAuth.id,
      conversationId: ctxWithPendingAuth.conversationId,
      conversation: {
        id: ctxWithPendingAuth.conversationId,
        userId: ctxWithPendingAuth.userId,
      },
    });

    const cancelled = await generationManager.submitAuthResult(
      ctxWithPendingAuth.id,
      "slack",
      false,
      ctxWithPendingAuth.userId,
    );
    expect(cancelled).toBe(true);
    expect(finishSpy).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        completedAt: expect.any(Date),
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: "idle",
      }),
    );
  });

  it("returns immediate fallback values for waitForApproval/waitForAuth guard paths", async () => {
    await expect(
      generationManager.waitForApproval("missing", {
        toolInput: {},
        integration: "slack",
        operation: "send",
        command: "slack send",
      }),
    ).resolves.toBe("deny");

    await expect(
      generationManager.waitForAuth("missing", {
        integration: "slack",
      }),
    ).resolves.toEqual({ success: false });

    const ctx = createCtx({ autoApprove: true });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: "runtime-1",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: true,
      },
    });

    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: {},
        integration: "github",
        operation: "create-issue",
        command: "github create-issue --title bug",
      }),
    ).resolves.toBe("allow");
  });

  it("auto-approves write requests when autoApprove is enabled", async () => {
    const ctx = createCtx({ autoApprove: true });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: "runtime-1",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: true,
      },
    });

    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toBe("allow");
    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: {},
        integration: "github",
        operation: "create-issue",
        command: "github create-issue --title bug",
      }),
    ).resolves.toBe("allow");
    expect(updateSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.anything(),
      }),
    );
  });

  it("broadcasts pending approval for plugin write requests to live subscribers", async () => {
    const ctx = createCtx();
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: "runtime-1",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: false,
      },
    });

    const result = await generationManager.requestPluginApproval(ctx.id, {
      toolInput: { command: "slack send -c C123 -t hi" },
      integration: "slack",
      operation: "send",
      command: "slack send -c C123 -t hi",
    });

    expect(result.decision).toBe("pending");
    expect(result.toolUseId).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
    expect(ctx.status).toBe("awaiting_approval");
    expect(ctx.pendingApproval).toEqual(
      expect.objectContaining({
        toolUseId: result.toolUseId,
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_approval",
        pendingApproval: null,
        pendingAuth: null,
      }),
    );

    const publishedPayloads = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    )
      .map((call) => call[1] as { payload?: unknown } | undefined)
      .filter((entry): entry is { payload?: unknown } => !!entry)
      .map((entry) => entry.payload);

    expect(publishedPayloads).toContainEqual({
      type: "interrupt_pending",
      interruptId: `interrupt-${result.toolUseId}`,
      generationId: ctx.id,
      runtimeId: "runtime-1",
      conversationId: ctx.conversationId,
      turnSeq: 1,
      kind: "plugin_write",
      status: "pending",
      providerToolUseId: result.toolUseId,
      display: {
        title: "Bash",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      },
      responsePayload: undefined,
    });
  });

  it("reuses plugin write approvals by providerRequestId", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-idempotent-plugin",
      conversationId: "conv-idempotent-plugin",
      runtimeId: "runtime-1",
      conversation: {
        id: "conv-idempotent-plugin",
        userId: "user-1",
        autoApprove: false,
      },
    });

    const first = await generationManager.requestPluginApproval(
      "gen-idempotent-plugin",
      {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      },
    );
    const duplicatePending = await generationManager.requestPluginApproval(
      "gen-idempotent-plugin",
      {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      },
    );

    expect(duplicatePending).toEqual(first);

    await resolveInterruptMock({
      interruptId: first.interruptId,
      status: "accepted",
    });

    const duplicateAccepted = await generationManager.requestPluginApproval(
      "gen-idempotent-plugin",
      {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      },
    );

    expect(duplicateAccepted).toEqual({ decision: "allow" });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith(first.interruptId);
  });

  it("parks a pending plugin write approval after the approval hot wait", async () => {
    vi.useFakeTimers();
    const teardownMock = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-plugin-park",
      conversationId: "conv-plugin-park",
      runtimeId: "runtime-plugin-park",
      runtimeTurnSeq: 3,
      sessionId: "session-plugin-park",
      sandboxId: "sandbox-plugin-park",
      approvalHotWaitMs: 1_000,
      sandbox: {
        execute: vi
          .fn()
          .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown: teardownMock,
      },
    });
    asTestManager().activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: ctx.runtimeId,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: false,
      },
    });

    const result = await generationManager.requestPluginApproval(ctx.id, {
      providerRequestId: "provider-plugin-park",
      toolInput: { command: "slack send -c C123 -t hi" },
      integration: "slack",
      operation: "send",
      command: "slack send -c C123 -t hi",
    });

    expect(result.decision).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_250);
    vi.useRealTimers();

    expect(saveConversationSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: ctx.conversationId,
        sessionId: "session-plugin-park",
      }),
    );
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-plugin-park");
    expect(asTestManager().activeGenerations.has(ctx.id)).toBe(false);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_approval",
        sandboxId: null,
      }),
    );

    const publishedPayloads = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    ).map((call) => (call[1] as { payload?: unknown } | undefined)?.payload);
    expect(publishedPayloads).toContainEqual(
      expect.objectContaining({
        type: "status_change",
        status: "approval_parked",
        metadata: expect.objectContaining({
          parkedInterruptId: result.interruptId,
          releasedSandboxId: "sandbox-plugin-park",
        }),
      }),
    );
  });

  it("parks a pending plugin write approval even if the park snapshot export hangs", async () => {
    vi.useFakeTimers();
    const teardownMock = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-plugin-park-timeout",
      conversationId: "conv-plugin-park-timeout",
      runtimeId: "runtime-plugin-park-timeout",
      runtimeTurnSeq: 3,
      sessionId: "session-plugin-park-timeout",
      sandboxId: "sandbox-plugin-park-timeout",
      approvalHotWaitMs: 1_000,
      sandbox: {
        execute: vi
          .fn()
          .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown: teardownMock,
      },
    });
    asTestManager().activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      runtimeId: ctx.runtimeId,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: false,
      },
    });
    saveConversationSessionSnapshotMock.mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const result = await generationManager.requestPluginApproval(ctx.id, {
      providerRequestId: "provider-plugin-park-timeout",
      toolInput: { command: "slack send -c C123 -t hi" },
      integration: "slack",
      operation: "send",
      command: "slack send -c C123 -t hi",
    });

    expect(result.decision).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_250 + 15_000);
    vi.useRealTimers();

    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith(
      "runtime-plugin-park-timeout",
    );
    expect(asTestManager().activeGenerations.has(ctx.id)).toBe(false);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_approval",
        sandboxId: null,
        suspendedAt: expect.any(Date),
      }),
    );
  });

  it("publishes pending approval to the generation stream without an active in-memory context", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-detached",
      conversationId: "conv-detached",
      runtimeId: "runtime-1",
      conversation: {
        id: "conv-detached",
        userId: "user-1",
        autoApprove: false,
      },
    });
    getLatestGenerationStreamEnvelopeMock.mockResolvedValue({
      cursor: "1-1",
      envelope: {
        generationId: "gen-detached",
        conversationId: "conv-detached",
        sequence: 7,
        eventType: "tool_use",
        payload: {
          type: "tool_use",
          toolName: "bash",
          toolInput: { command: "slack channels" },
        },
        createdAtMs: Date.now() - 1000,
      },
    });

    const result = await generationManager.requestPluginApproval(
      "gen-detached",
      {
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      },
    );

    expect(result.decision).toBe("pending");
    expect(publishGenerationStreamEventMock).toHaveBeenCalledWith(
      "gen-detached",
      expect.objectContaining({
        generationId: "gen-detached",
        conversationId: "conv-detached",
        sequence: 8,
        eventType: "interrupt_pending",
        payload: {
          type: "interrupt_pending",
          interruptId: `interrupt-${result.toolUseId}`,
          generationId: "gen-detached",
          runtimeId: "runtime-1",
          conversationId: "conv-detached",
          turnSeq: 1,
          kind: "plugin_write",
          status: "pending",
          providerToolUseId: result.toolUseId,
          display: {
            title: "Bash",
            toolInput: { command: "slack send -c C123 -t hi" },
            integration: "slack",
            operation: "send",
            command: "slack send -c C123 -t hi",
          },
          responsePayload: undefined,
        },
      }),
    );
  });

  it("runs OpenCode generation happy path and completes", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({
      GITHUB_ACCESS_TOKEN: "gh-token",
      SLACK_ACCESS_TOKEN: "slack-token",
    });
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([
      "github",
      "slack",
    ]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue(
      "cli instructions",
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue(["base-skill"]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("skills prompt");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([
      "github",
    ]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue(
      "integration skills prompt",
    );
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("memory prompt");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([
      { path: "/app/out/report.txt", content: Buffer.from("report") },
    ]);
    vi.mocked(uploadSandboxFile).mockResolvedValue({
      id: "sandbox-file-1",
      filename: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
      path: "/app/out/report.txt",
      storageKey: "k/report.txt",
    });

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-opencode",
      title: "Conversation",
      opencodeSessionId: "session-existing",
    });
    userFindFirstMock.mockResolvedValue({
      timezone: "Europe/Dublin",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const messagesMock = vi.fn().mockResolvedValue({
      data: [
        { info: { role: "assistant", tokens: { input: 123, output: 456 } } },
        { info: { role: "user" } },
      ],
      error: null,
    });
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        messagesMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode",
      conversationId: "conv-opencode",
      backendType: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      allowedIntegrations: ["github"],
      userMessageContent: "Process these files",
      assistantContent: "The generated file is report.txt.",
      attachments: [
        {
          name: "image.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
        {
          name: "notes.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
        },
      ],
      uploadedSandboxFileIds: new Set(),
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(vi.mocked(getOrCreateConversationRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationEnvs: expect.objectContaining({
          ALLOWED_INTEGRATIONS: "github",
          CMDCLAW_USER_TIMEZONE: "Europe/Dublin",
        }),
      }),
      expect.objectContaining({
        allowSnapshotRestore: true,
      }),
    );
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "chat",
        cliInstructions: "cli instructions",
        skillsInstructions: "skills prompt",
        integrationSkillsInstructions: "integration skills prompt",
        memoryInstructions: "memory prompt",
        userTimezone: "Europe/Dublin",
      }),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    const promptArg = promptMock.mock.calls[0]?.[0] as {
      agent?: string;
      system?: string;
      parts?: Array<{
        type: string;
        text?: string;
        mime?: string;
        filename?: string;
      }>;
    };
    expect(promptArg.agent).toBe(CMDCLAW_CHAT_AGENT_ID);
    expect(promptArg.system).toBe("mock system prompt for chat");
    expect(promptArg.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/home/user/uploads/image.png"),
        }),
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/home/user/uploads/notes.txt"),
        }),
        expect.objectContaining({
          type: "file",
          mime: "image/png",
          filename: "image.png",
        }),
      ]),
    );
    expect(vi.mocked(collectNewSandboxFiles)).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.arrayContaining([
        "/home/user/uploads/image.png",
        "/home/user/uploads/notes.txt",
      ]),
    );
    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalled();
    expect(ctx.usage).toMatchObject({
      inputTokens: 123,
      outputTokens: 456,
    });
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    expect(ctx.uploadedSandboxFileIds?.has("sandbox-file-1")).toBe(true);
  });

  it("syncs curated runtime env into the sandbox before prompting", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({
      GMAIL_ACCESS_TOKEN: "gmail-token",
    });
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["google_gmail"]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({
      timezone: "Europe/Dublin",
    });

    const execMock = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
        exec: execMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    await mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-runtime-env-sync",
        conversationId: "conv-opencode-runtime-env-sync",
        model: "anthropic/claude-sonnet-4-6",
        allowedIntegrations: ["google_gmail"],
      }),
    );

    const runtimeEnvWrite = execMock.mock.calls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("/app/.cmdclaw/runtime-env.json"),
    )?.[0] as string | undefined;
    expect(runtimeEnvWrite).toBeTruthy();
    expect(runtimeEnvWrite).toContain("/app/.cmdclaw/runtime-env.sh");
    expect(runtimeEnvWrite).toContain("chmod 600");
  });

  it("starts executor prepare and skills loading in parallel before awaiting either", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    const loadedSkillsDeferred =
      createDeferred<Array<{ name: string; updatedAt: Date }>>();
    const customCredsDeferred = createDeferred<any[]>();
    const executorDeferred = createDeferred<ReturnType<
      typeof createExecutorPreparationMock
    > | null>();

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockReturnValue(
      loadedSkillsDeferred.promise as Promise<
        Array<{ name: string; updatedAt: Date }>
      >,
    );
    dbMock.query.customIntegrationCredential.findMany.mockReturnValue(
      customCredsDeferred.promise,
    );
    vi.mocked(prepareExecutorInSandbox).mockReturnValue(
      executorDeferred.promise as Promise<ReturnType<
        typeof createExecutorPreparationMock
      > | null>,
    );

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-parallel-prep",
        conversationId: "conv-opencode-parallel-prep",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    await vi.waitFor(() => {
      expect(vi.mocked(prepareExecutorInSandbox)).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(listAccessibleEnabledSkillMetadataForUser),
      ).toHaveBeenCalledTimes(1);
      expect(
        dbMock.query.customIntegrationCredential.findMany,
      ).toHaveBeenCalledTimes(1);
    });
    expect(promptMock).not.toHaveBeenCalled();

    loadedSkillsDeferred.resolve([]);
    customCredsDeferred.resolve([]);
    executorDeferred.resolve(createExecutorPreparationMock());

    await runPromise;
    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it("starts writing skills before executor prep finishes on a cache miss", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    const executorDeferred = createDeferred<ReturnType<
      typeof createExecutorPreparationMock
    > | null>();
    const writeSkillsStarted = createDeferred<void>();
    const writeIntegrationSkillsStarted = createDeferred<void>();

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["github"]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockReturnValue(
      executorDeferred.promise as Promise<ReturnType<
        typeof createExecutorPreparationMock
      > | null>,
    );
    vi.mocked(writeSkillsToSandbox).mockImplementation(async () => {
      writeSkillsStarted.resolve();
      return [];
    });
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockImplementation(
      async () => {
        writeIntegrationSkillsStarted.resolve();
        return [];
      },
    );
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-skill-write-overlap",
        conversationId: "conv-opencode-skill-write-overlap",
        model: "anthropic/claude-sonnet-4-6",
        allowedIntegrations: ["github"],
      }),
    );

    await writeSkillsStarted.promise;
    await writeIntegrationSkillsStarted.promise;

    expect(promptMock).not.toHaveBeenCalled();
    executorDeferred.resolve(createExecutorPreparationMock());

    await runPromise;
    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it("waits for executor oauth reconcile before registering executor MCP session", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    const finalizeDeferred = createDeferred<{
      oauthCacheHits: number;
      oauthRefreshFailures: [];
      oauthSourceStatuses: [];
    }>();
    let finalizeStarted = false;

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock({
        sessionMcpServers: [
          {
            type: "stdio",
            name: "executor",
            command: "executor",
            args: ["mcp"],
            env: [],
          },
        ],
        finalize: () => {
          finalizeStarted = true;
          return finalizeDeferred.promise;
        },
      }),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-executor-oauth-overlap",
        conversationId: "conv-opencode-executor-oauth-overlap",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    await vi.waitFor(() => {
      expect(finalizeStarted).toBe(true);
    });
    expect(promptMock).not.toHaveBeenCalled();

    finalizeDeferred.resolve({
      oauthCacheHits: 0,
      oauthRefreshFailures: [],
      oauthSourceStatuses: [],
    });
    await runPromise;

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(finishSpy).toHaveBeenCalledWith(expect.anything(), "completed");
  });

  it("prompts with executor source health when a selected executor source is unavailable", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock({
        sessionMcpServers: [
          {
            type: "stdio",
            name: "executor",
            command: "executor",
            args: ["mcp"],
            env: [],
          },
        ],
        finalize: () =>
          Promise.resolve({
            oauthCacheHits: 0,
            oauthRefreshFailures: [
              {
                sourceId: "source-1",
                name: "Linear",
                namespace: "linear-mcp",
                reason: "zero_tools",
                error: "The source refreshed successfully but exposed 0 tools.",
              },
            ],
            oauthSourceStatuses: [
              {
                sourceId: "source-1",
                name: "Linear",
                namespace: "linear-mcp",
                status: "unavailable",
                reason: "zero_tools",
                toolCount: 0,
                error: "The source refreshed successfully but exposed 0 tools.",
              },
            ],
          }),
      }),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-selected-executor-source-unavailable",
      conversationId: "conv-opencode-selected-executor-source-unavailable",
      model: "anthropic/claude-sonnet-4-6",
      allowedExecutorSourceIds: ["source-1"],
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        executorInstructions: expect.stringContaining(
          "Executor source health after refresh",
        ),
      }),
    );
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        executorInstructions: expect.stringContaining(
          "The next action must be an `executor_execute` tool call",
        ),
      }),
    );
    expect(ctx.errorMessage).toBeUndefined();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("prompts with executor tool-loop failure instructions when the user asks for an unavailable executor source by name", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock({
        sessionMcpServers: [
          {
            type: "stdio",
            name: "executor",
            command: "executor",
            args: ["mcp"],
            env: [],
          },
        ],
        finalize: () =>
          Promise.resolve({
            oauthCacheHits: 0,
            oauthRefreshFailures: [
              {
                sourceId: "source-1",
                name: "linear-mcp",
                namespace: "linear-mcp",
                reason: "zero_tools",
                error: "The source refreshed successfully but exposed 0 tools.",
              },
            ],
            oauthSourceStatuses: [
              {
                sourceId: "source-1",
                name: "linear-mcp",
                namespace: "linear-mcp",
                status: "unavailable",
                reason: "zero_tools",
                toolCount: 0,
                error: "The source refreshed successfully but exposed 0 tools.",
              },
            ],
          }),
      }),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-requested-executor-source-unavailable",
      conversationId: "conv-opencode-requested-executor-source-unavailable",
      model: "anthropic/claude-sonnet-4-6",
      userMessageContent: "what's my latest issue on linear",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        executorInstructions: expect.stringContaining(
          "linear-mcp (linear-mcp): unavailable",
        ),
      }),
    );
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        executorInstructions: expect.stringContaining(
          "Do not use `bash` executor CLI commands",
        ),
      }),
    );
    expect(ctx.errorMessage).toBeUndefined();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("fails the generation when executor prompt-ready bootstrap fails", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockRejectedValue(
      new Error("Executor status check failed"),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-executor-bootstrap-failure",
      conversationId: "conv-opencode-executor-bootstrap-failure",
      model: "anthropic/claude-sonnet-4-6",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(promptMock).not.toHaveBeenCalled();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
  });

  it.skip("treats late executor oauth reconcile failures as non-fatal", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    const finalizeDeferred = createDeferred<{
      oauthCacheHits: number;
      oauthRefreshFailures: [];
      oauthSourceStatuses: [];
    }>();

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock({
        finalize: () => finalizeDeferred.promise,
      }),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({ promptMock, subscribeMock }) as Awaited<
        ReturnType<typeof getOrCreateConversationRuntime>
      >,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-executor-finalize-failure",
      conversationId: "conv-opencode-executor-finalize-failure",
      model: "anthropic/claude-sonnet-4-6",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");

    finalizeDeferred.reject(new Error("oauth reconcile failed"));
    await vi.waitFor(() => {
      expect(vi.mocked(logServerEvent)).toHaveBeenCalledWith(
        "error",
        "EXECUTOR_PREP_FINALIZE_FAILED",
        expect.objectContaining({
          error: "oauth reconcile failed",
        }),
        expect.objectContaining({
          generationId: "gen-opencode-executor-finalize-failure",
          conversationId: "conv-opencode-executor-finalize-failure",
        }),
      );
    });
  });

  it("surfaces structured transcript fetch errors for empty opencode completions", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(null);
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue({ id: "prompt-result-1" });
    const messagesMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        status: 404,
        data: {
          message: "session.messages returned 404",
        },
      },
    });
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([{ type: "server.connected", properties: {} }]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        messagesMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-empty-completion",
      conversationId: "conv-opencode-empty-completion",
      model: "openai/gpt-5.4",
      backendType: "opencode",
      userMessageContent: "hi",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(ctx.errorMessage).toContain("session.messages returned 404");
    expect(ctx.debugInfo?.originalErrorMessage).toContain(
      "session.messages returned 404",
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
    expect(vi.mocked(logServerEvent)).toHaveBeenCalledWith(
      "error",
      "OPENCODE_EMPTY_COMPLETION",
      expect.objectContaining({
        fallbackMessagesError: "session.messages returned 404",
        fallbackMessagesErrorDetail: expect.stringContaining(
          '"message":"session.messages returned 404"',
        ),
        promptResultDataShape: "object(id)",
      }),
      expect.objectContaining({
        generationId: "gen-opencode-empty-completion",
        conversationId: "conv-opencode-empty-completion",
      }),
    );
  });

  it("waits for async OpenCode prompts to reach idle after an early stream end", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(null);
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue({ data: "", error: null });
    const messagesMock = vi.fn().mockResolvedValue({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "async prompt completed" }],
        },
      ],
      error: null,
    });
    const statusMock = vi.fn().mockResolvedValue({
      data: {},
      error: null,
    });
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([{ type: "server.connected", properties: {} }]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        messagesMock,
        statusMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-async-early-stream-end",
      conversationId: "conv-opencode-async-early-stream-end",
      model: "openai/gpt-5.4",
      backendType: "opencode",
      userMessageContent: "hi",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(ctx.assistantContent).toBe("async prompt completed");
    expect(ctx.errorMessage).toBeUndefined();
    expect(statusMock).toHaveBeenCalled();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    expect(vi.mocked(logServerEvent)).not.toHaveBeenCalledWith(
      "error",
      "OPENCODE_EMPTY_COMPLETION",
      expect.anything(),
      expect.anything(),
    );
  });

  it.skip("captures session state and runtime log tail for opaque empty opencode completions", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(null);
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue({ data: null, error: {} });
    const messagesMock = vi.fn().mockResolvedValue({
      data: null,
      error: {},
    });
    const getSessionMock = vi.fn().mockResolvedValue({
      data: { id: "session-1", state: "running" },
      error: null,
    });
    const readFileMock = vi
      .fn()
      .mockResolvedValue(
        "booting runtime\nconnected to provider\nfatal: runner exited unexpectedly",
      );
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([{ type: "server.connected", properties: {} }]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        messagesMock,
        getSessionMock,
        readFile: readFileMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode-empty-completion-opaque",
      conversationId: "conv-opencode-empty-completion-opaque",
      model: "openai/gpt-5.4",
      backendType: "opencode",
      userMessageContent: "hi",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(ctx.errorMessage).toContain("non-terminal state");
    expect(ctx.completionReason).toBe("broken_runtime_state");
    expect(readFileMock).toHaveBeenCalledWith("/tmp/opencode.log");
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
    expect(vi.mocked(logServerEvent)).toHaveBeenCalledWith(
      "error",
      "OPENCODE_EMPTY_COMPLETION",
      expect.objectContaining({
        fallbackMessagesError: "{}",
        sessionGetDataShape: "object(id,state)",
        sessionGetDataDetail: expect.stringContaining('"state":"running"'),
        opencodeLogTail: expect.stringContaining(
          "fatal: runner exited unexpectedly",
        ),
        promptResultDataShape: null,
      }),
      expect.objectContaining({
        generationId: "gen-opencode-empty-completion-opaque",
        conversationId: "conv-opencode-empty-completion-opaque",
      }),
    );
  });

  it("does not block prompt send on post-prompt cache writes", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    const cacheWriteDeferred = createDeferred<void>();
    let cacheWriteStarted = false;
    let cacheWriteSettled = false;
    const promptCalled = createDeferred<void>();

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["github"]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([
      { name: "base-skill", updatedAt: new Date("2026-03-01T00:00:00.000Z") },
    ]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(null);
    vi.mocked(writeSkillsToSandbox).mockResolvedValue(["base-skill"]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("skills prompt");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([
      "github",
    ]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue(
      "integration skills prompt",
    );
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const writeFileMock = vi.fn().mockImplementation((targetPath: string) => {
      if (targetPath === "/app/.opencode/pre-prompt-cache.json") {
        cacheWriteStarted = true;
        return cacheWriteDeferred.promise.finally(() => {
          cacheWriteSettled = true;
        });
      }
      return Promise.resolve(undefined);
    });
    const promptMock = vi.fn().mockImplementation(async () => {
      promptCalled.resolve();
      return undefined;
    });
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
        writeFile: writeFileMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-post-prompt-cache",
        conversationId: "conv-opencode-post-prompt-cache",
        model: "anthropic/claude-sonnet-4-6",
        allowedIntegrations: ["github"],
      }),
    );

    await promptCalled.promise;
    expect(cacheWriteStarted).toBe(true);

    await runPromise;
    expect(cacheWriteSettled).toBe(false);
    expect(finishSpy).toHaveBeenCalledWith(expect.anything(), "completed");

    cacheWriteDeferred.resolve();
    await Promise.resolve();
  });

  it("treats post-prompt cache write failures as non-fatal", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["github"]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([
      { name: "base-skill", updatedAt: new Date("2026-03-01T00:00:00.000Z") },
    ]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(null);
    vi.mocked(writeSkillsToSandbox).mockResolvedValue(["base-skill"]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("skills prompt");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([
      "github",
    ]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue(
      "integration skills prompt",
    );
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const writeFileMock = vi.fn().mockImplementation((targetPath: string) => {
      if (targetPath === "/app/.opencode/pre-prompt-cache.json") {
        return Promise.reject(new Error("cache write failed"));
      }
      return Promise.resolve(undefined);
    });
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
        writeFile: writeFileMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    await mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-post-prompt-cache-failure",
        conversationId: "conv-opencode-post-prompt-cache-failure",
        model: "anthropic/claude-sonnet-4-6",
        allowedIntegrations: ["github"],
      }),
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(finishSpy).toHaveBeenCalledWith(expect.anything(), "completed");
  });

  it("does not require an anthropic api key for non-anthropic runs", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-openai-no-anthropic-key",
      conversationId: "conv-openai-no-anthropic-key",
      backendType: "opencode",
      model: "openai/gpt-5.4",
      userMessageContent: "Inspect the repo",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(vi.mocked(getOrCreateConversationRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4",
        anthropicApiKey: "",
      }),
      expect.anything(),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("surfaces an explicit error when OpenCode resolves without output or transcript", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const messagesMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([{ type: "server.connected", properties: {} }]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        messagesMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-openai-empty-output",
      conversationId: "conv-openai-empty-output",
      backendType: "opencode",
      model: "openai/gpt-5.4",
      userMessageContent: "hi",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(messagesMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      limit: 20,
    });
    expect(ctx.completionReason).toBe("runtime_error");
    expect(ctx.errorMessage).toContain(
      "without producing any assistant output",
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
  });

  it("persists the runtime active binding before pre-prompt work finishes and later stores the session id", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    const memoryDeferred = createDeferred<[]>();
    vi.mocked(syncMemoryFilesToSandbox).mockImplementation(
      () => memoryDeferred.promise,
    );
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock(),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-session-persist-early",
      title: "Conversation",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-session-persist-early",
        conversationId: "conv-session-persist-early",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    await vi.waitFor(() => {
      expect(promptMock).not.toHaveBeenCalled();
      expect(updateRuntimeSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeId: "runtime-1",
          sandboxId: "sandbox-1",
          sessionId: null,
          sandboxProvider: "e2b",
          runtimeHarness: "opencode",
          runtimeProtocolVersion: "opencode-v2",
          status: "active",
        }),
      );
    });

    memoryDeferred.resolve([]);
    await runPromise;

    expect(updateRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: "runtime-1",
        sandboxId: "sandbox-1",
        sessionId: "session-1",
        sandboxProvider: "e2b",
        runtimeHarness: "opencode",
        runtimeProtocolVersion: "opencode-v2",
        status: "active",
      }),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(finishSpy).toHaveBeenCalledWith(expect.anything(), "completed");
  });

  it("still requires an anthropic api key for anthropic runs", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "",
      configurable: true,
    });

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "resolveRuntimeFailure").mockResolvedValue("terminal_failed");
    const ctx = createCtx({
      id: "gen-anthropic-missing-key",
      conversationId: "conv-anthropic-missing-key",
      backendType: "opencode",
      model: "anthropic/claude-sonnet-4-6",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(ctx.errorMessage).toBe("ANTHROPIC_API_KEY is not configured");
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
  });

  it("disables snapshot restore for active reattach attempts once a run has already started", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-opencode-active",
      title: "Conversation",
      opencodeSessionId: "session-existing",
    });

    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn().mockResolvedValue(undefined),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([
            { type: "server.connected", properties: {} },
            { type: "session.idle", properties: {} },
          ]),
        }),
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    await mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-opencode-active",
        conversationId: "conv-opencode-active",
        executionPolicy: { allowSnapshotRestoreOnRun: false },
      }),
    );

    expect(vi.mocked(getOrCreateConversationRuntime)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowSnapshotRestore: false,
      }),
    );
  });

  it("finalizes bootstrap timeouts without falling into generic runtime recovery", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(getOrCreateConversationRuntime).mockRejectedValueOnce(
      new Error("Agent preparation timed out after 45 seconds."),
    );

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-bootstrap",
      title: "Conversation",
    });

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    const resolveRuntimeFailureSpy = vi.spyOn(
      mgr as never,
      "resolveRuntimeFailure",
    );

    const ctx = createCtx({
      id: "gen-bootstrap",
      conversationId: "conv-bootstrap",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(ctx.completionReason).toBe("bootstrap_timeout");
    expect(ctx.errorMessage).toBe(
      "Agent preparation timed out after 45 seconds.",
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "error");
    expect(resolveRuntimeFailureSpy).not.toHaveBeenCalled();
  });

  it("schedules a one-shot recovery reattach instead of finalizing healthy live runtimes", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-recoverable",
      title: "Conversation",
    });

    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn().mockRejectedValue(new Error("stream disconnected")),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([
            { type: "server.connected", properties: {} },
          ]),
        }),
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    const resolveRuntimeFailureSpy = vi
      .spyOn(mgr as never, "resolveRuntimeFailure")
      .mockResolvedValue("recoverable_live_runtime");
    const scheduleRecoverySpy = vi
      .spyOn(mgr as never, "scheduleRecoveryReattach")
      .mockImplementation(() => undefined);

    await mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-recoverable",
        conversationId: "conv-recoverable",
      }),
    );

    expect(resolveRuntimeFailureSpy).toHaveBeenCalled();
    expect(scheduleRecoverySpy).toHaveBeenCalled();
    expect(finishSpy).not.toHaveBeenCalledWith(expect.anything(), "error");
  });

  it("recovery reattach always re-enqueues instead of using a local timer", async () => {
    const mgr = asTestManager();
    const enqueueSpy = vi
      .spyOn((mgr as any).generationRunQueue as never, "enqueueGenerationRun")
      .mockResolvedValue(undefined);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    (mgr as never).scheduleRecoveryReattach(
      createCtx({
        id: "gen-requeue",
        conversationId: "conv-requeue",
        recoveryAttempts: 2,
      }),
    );

    expect(enqueueSpy).toHaveBeenCalledWith(
      "gen-requeue",
      "chat",
      expect.objectContaining({
        dedupeKey: "recovery-2",
        runMode: "recovery_reattach",
      }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("waits for the in-flight prompt rejection after a session.error before finalizing", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-session-error",
      title: "Conversation",
    });

    let promptStartedResolve: (() => void) | undefined;
    const promptStarted = new Promise<void>((resolve) => {
      promptStartedResolve = resolve;
    });
    let rejectPrompt: ((error: Error) => void) | undefined;
    const upstreamError = new Error(
      "Internal error: API Error: 400 quota exceeded",
    );
    const promptMock = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject: (error: Error) => void) => {
          promptStartedResolve?.();
          rejectPrompt = reject;
        }),
    );
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        {
          type: "session.error",
          properties: {
            error: {
              message: upstreamError.message,
            },
          },
        },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });
    vi.spyOn(mgr as never, "resolveRuntimeFailure").mockResolvedValue(
      undefined,
    );

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-session-error",
        conversationId: "conv-session-error",
        backendType: "opencode",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    await promptStarted;
    await Promise.resolve();
    expect(finishSpy).not.toHaveBeenCalled();

    rejectPrompt?.(upstreamError);
    await runPromise;

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(finishSpy).toHaveBeenCalledWith(expect.anything(), "error");
  });

  it("treats a live pending-tool export as recoverable on the first disconnect", () => {
    const exportState = extractRuntimeExportState({
      messages: [
        {
          info: { role: "assistant" },
          parts: [{ type: "tool", tool: "bash", state: { status: "pending" } }],
        },
      ],
    });

    expect(exportState).toBe("non_terminal");
    expect(
      classifyRuntimeFailure({
        exportState,
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("recoverable_live_runtime");
  });

  it("does not allow a second recovery reattach after the one-shot attempt is used", async () => {
    const mgr = asTestManager();
    const result = await mgr.resolveRuntimeFailure(
      createCtx({
        sessionId: "session-1",
        recoveryAttempts: 1,
        sandbox: {
          execute: vi.fn().mockResolvedValue({
            exitCode: 0,
            stdout: JSON.stringify({
              messages: [
                {
                  info: { role: "assistant" },
                  parts: [
                    {
                      type: "tool",
                      tool: "bash",
                      state: { status: "pending" },
                    },
                  ],
                },
              ],
            }),
          }),
        },
      }),
      {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { id: "session-1" }, error: null }),
      },
    );

    expect(result).toBe("broken_runtime_state");
  });

  it("parks a generation for run deadline with snapshot, teardown, and paused status", async () => {
    const teardownMock = vi.fn().mockResolvedValue(undefined);
    const mgr = asTestManager();
    const ctx = createCtx({
      id: "gen-deadline-park",
      conversationId: "conv-deadline-park",
      runtimeId: "runtime-deadline-park",
      sessionId: "session-deadline-park",
      sandboxId: "sandbox-deadline-park",
      coworkerRunId: "coworker-run-deadline-park",
      deadlineAt: new Date(Date.now() - 1_000),
      sandbox: {
        execute: vi
          .fn()
          .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown: teardownMock,
      },
    });
    mgr.activeGenerations.set(ctx.id, ctx);

    await (mgr as any).parkGenerationForRunDeadline(ctx);

    expect(saveConversationSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-deadline-park",
        sessionId: "session-deadline-park",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        isPaused: true,
        completionReason: "run_deadline",
        sandboxId: null,
      }),
    );
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-deadline-park");
    expect(mgr.activeGenerations.has(ctx.id)).toBe(false);
    const publishedPayloads = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    ).map((call) => (call[1] as { payload?: unknown } | undefined)?.payload);
    expect(publishedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status_change",
          status: "run_deadline_parked",
        }),
      ]),
    );
  });

  it("parks a generation for run deadline even if snapshot export hangs", async () => {
    vi.useFakeTimers();
    const teardownMock = vi.fn().mockResolvedValue(undefined);
    const runtime = createConversationRuntimeMock({
      promptMock: vi.fn(),
      subscribeMock: vi.fn().mockResolvedValue({ stream: asAsyncIterable([]) }),
    });
    const abortMock = runtime.harnessClient.abort as ReturnType<typeof vi.fn>;
    saveConversationSessionSnapshotMock.mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    const mgr = asTestManager();
    const ctx = createCtx({
      id: "gen-deadline-park-timeout",
      conversationId: "conv-deadline-park-timeout",
      runtimeId: "runtime-deadline-park-timeout",
      sessionId: "session-deadline-park-timeout",
      sandboxId: "sandbox-deadline-park-timeout",
      deadlineAt: new Date(Date.now() - 1_000),
      sandbox: {
        execute: vi
          .fn()
          .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown: teardownMock,
      },
    });
    mgr.activeGenerations.set(ctx.id, ctx);

    const parkPromise = (mgr as any).parkGenerationForRunDeadline(
      ctx,
      runtime.harnessClient,
    );

    await vi.advanceTimersByTimeAsync(20_100);
    await parkPromise;

    expect(abortMock).toHaveBeenCalledWith({
      sessionID: "session-deadline-park-timeout",
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        isPaused: true,
        completionReason: "run_deadline",
        sandboxId: null,
      }),
    );
    expect(teardownMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("parks runOpenCodeGeneration when the run deadline has already elapsed", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock(),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn(),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([]),
        }),
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const parkSpy = vi
      .spyOn(mgr as never, "parkGenerationForRunDeadline")
      .mockResolvedValue(undefined);
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    await mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-deadline-open",
        conversationId: "conv-deadline-open",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() - 1_000),
      }),
    );

    expect(parkSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it("parks runOpenCodeGeneration when the prompt promise hangs past the run deadline", async () => {
    vi.useFakeTimers();
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(listAccessibleEnabledSkillMetadataForUser).mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    vi.mocked(prepareExecutorInSandbox).mockResolvedValue(
      createExecutorPreparationMock(),
    );
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    const promptDeferred = createDeferred<void>();
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn(() => promptDeferred.promise),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([]),
        }),
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const parkSpy = vi
      .spyOn(mgr as never, "parkGenerationForRunDeadline")
      .mockResolvedValue(undefined);
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    const runPromise = mgr.runOpenCodeGeneration(
      createCtx({
        id: "gen-deadline-hung-prompt",
        conversationId: "conv-deadline-hung-prompt",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() + 50),
      }),
    );

    await vi.advanceTimersByTimeAsync(60);
    await runPromise;

    expect(parkSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reattaches to a live session without resending the prompt", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-recovery-live",
      title: "Conversation",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([
            { type: "server.connected", properties: {} },
            { type: "session.idle", properties: {} },
          ]),
        }),
        sessionSource: "live_session",
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );

    const ctx = createCtx({
      id: "gen-recovery-live",
      conversationId: "conv-recovery-live",
      sessionId: "session-1",
      executionPolicy: { allowSnapshotRestoreOnRun: false },
    });

    await mgr.runRecoveryReattach(ctx);

    expect(vi.mocked(getOrCreateConversationRuntime)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        replayHistory: false,
        allowSnapshotRestore: false,
      }),
    );
    expect(promptMock).not.toHaveBeenCalled();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("fails recovery reattach when only a fresh or restored session is available", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-recovery-fail",
      title: "Conversation",
    });

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    vi.mocked(getOrCreateConversationRuntime).mockResolvedValueOnce(
      createConversationRuntimeMock({
        promptMock: vi.fn().mockResolvedValue(undefined),
        subscribeMock: vi
          .fn()
          .mockResolvedValue({ stream: asAsyncIterable([]) }),
        sessionSource: "created_session",
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const createdCtx = createCtx({
      id: "gen-recovery-created",
      conversationId: "conv-recovery-fail",
      sessionId: "session-1",
    });
    await mgr.runRecoveryReattach(createdCtx);
    expect(createdCtx.completionReason).toBe("sandbox_missing");
    expect(finishSpy).toHaveBeenCalledWith(createdCtx, "error");

    vi.mocked(getOrCreateConversationRuntime).mockResolvedValueOnce(
      createConversationRuntimeMock({
        promptMock: vi.fn().mockResolvedValue(undefined),
        subscribeMock: vi
          .fn()
          .mockResolvedValue({ stream: asAsyncIterable([]) }),
        sessionSource: "restored_snapshot",
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const restoredCtx = createCtx({
      id: "gen-recovery-restored",
      conversationId: "conv-recovery-fail",
      sessionId: "session-1",
    });
    await mgr.runRecoveryReattach(restoredCtx);
    expect(restoredCtx.completionReason).toBe("broken_runtime_state");
    expect(finishSpy).toHaveBeenCalledWith(restoredCtx, "error");
  });

  it("parks recovery reattach when no runtime budget remains", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-recovery-timeout",
      title: "Conversation",
    });

    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn(),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([]),
        }),
        sessionSource: "live_session",
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const parkSpy = vi
      .spyOn(mgr as never, "parkGenerationForRunDeadline")
      .mockResolvedValue(undefined);
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    await mgr.runRecoveryReattach(
      createCtx({
        id: "gen-recovery-timeout",
        conversationId: "conv-recovery-timeout",
        sessionId: "session-1",
        deadlineAt: new Date(Date.now() - 1_000),
      }),
    );

    expect(parkSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it("parks recovery reattach when the continuation prompt hangs past the run deadline", async () => {
    vi.useFakeTimers();
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-recovery-hung-prompt",
      title: "Conversation",
    });

    const promptDeferred = createDeferred<void>();
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock: vi.fn(() => promptDeferred.promise),
        subscribeMock: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([]),
        }),
        sessionSource: "live_session",
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const parkSpy = vi
      .spyOn(mgr as never, "parkGenerationForRunDeadline")
      .mockResolvedValue(undefined);
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    const runPromise = mgr.runRecoveryReattach(
      createCtx({
        id: "gen-recovery-hung-prompt",
        conversationId: "conv-recovery-hung-prompt",
        sessionId: "session-1",
        deadlineAt: new Date(Date.now() + 50),
      }),
      {
        onRuntimeAttached: async () => [{ type: "text", text: "continue" }],
      },
    );

    await vi.advanceTimersByTimeAsync(60);
    await runPromise;

    expect(parkSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("routes coworker builder prompts to the builder agent and keeps builder context in system", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-builder",
      title: "Coworker Builder",
      opencodeSessionId: "session-existing",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-builder-opencode",
      conversationId: "conv-builder",
      backendType: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      userMessageContent: "Make this coworker run every hour",
      builderCoworkerContext: {
        coworkerId: "wf-1",
        updatedAt: "2026-03-03T12:00:00.000Z",
        prompt: "Current coworker prompt",
        model: "anthropic/claude-sonnet-4-6",
        toolAccessMode: "selected",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
      },
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "coworker_builder",
        builderCoworkerContext: ctx.builderCoworkerContext,
      }),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    const promptArg = promptMock.mock.calls[0]?.[0] as {
      agent?: string;
      system?: string;
    };
    expect(promptArg.agent).toBe(CMDCLAW_COWORKER_BUILDER_AGENT_ID);
    expect(promptArg.system).toBe("mock system prompt for coworker_builder");
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("routes coworker runs to the runner agent", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([
      "/home/user/coworker-documents/wf-1/brief.pdf",
    ]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-coworker",
      title: "Coworker Conversation",
      opencodeSessionId: "session-existing",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-coworker-opencode",
      conversationId: "conv-coworker",
      backendType: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      coworkerId: "wf-1",
      coworkerRunId: "wf-run-1",
      userMessageContent: "Execute scheduled coworker task",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "coworker_runner",
        coworkerPrompt: undefined,
        triggerPayload: undefined,
      }),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    const promptArg = promptMock.mock.calls[0]?.[0] as {
      agent?: string;
      system?: string;
      parts?: Array<{ type: string; text?: string }>;
    };
    expect(promptArg.agent).toBe(CMDCLAW_COWORKER_RUNNER_AGENT_ID);
    expect(promptArg.system).toBe("mock system prompt for coworker_runner");
    expect(vi.mocked(writeCoworkerDocumentsToSandbox)).toHaveBeenCalledWith(
      expect.anything(),
      "wf-1",
    );
    expect(promptArg.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(
            "/home/user/coworker-documents/wf-1/brief.pdf",
          ),
        }),
      ]),
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("streams OpenCode reasoning parts as thinking events", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(writeCoworkerDocumentsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryFilesToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-reasoning",
      title: "Conversation",
      opencodeSessionId: "session-existing",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "reason-1",
              sessionID: "session-1",
              messageID: "msg-1",
              type: "reasoning",
              text: "plan",
              time: { start: Date.now() },
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "reason-1",
              sessionID: "session-1",
              messageID: "msg-1",
              type: "reasoning",
              text: "plan more",
              time: { start: Date.now() },
            },
          },
        },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      createConversationRuntimeMock({
        promptMock,
        subscribeMock,
      }) as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(
      undefined,
    );
    vi.spyOn(mgr, "handleRuntimeActionableEvent").mockResolvedValue({
      type: "none",
    });
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    const ctx = createCtx({
      id: "gen-reasoning",
      conversationId: "conv-reasoning",
      backendType: "opencode",
      model: "openai/gpt-5.4",
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    const publishedThinkingEvents = (
      publishGenerationStreamEventMock.mock.calls as unknown[][]
    )
      .map((call) => call[1] as { payload?: unknown } | undefined)
      .filter((entry): entry is { payload?: unknown } => !!entry)
      .map((entry) => entry.payload)
      .filter(
        (
          event,
        ): event is { type: "thinking"; content: string; thinkingId: string } =>
          !!event &&
          typeof event === "object" &&
          (event as { type?: unknown }).type === "thinking",
      );
    expect(publishedThinkingEvents).toEqual(
      expect.arrayContaining([
        { type: "thinking", content: "plan", thinkingId: "reason-1" },
        { type: "thinking", content: " more", thinkingId: "reason-1" },
      ]),
    );
    expect(ctx.contentParts).toEqual(
      expect.arrayContaining([
        { type: "thinking", id: "reason-1", content: "plan more" },
      ]),
    );
  });

  it("uses the live runtime client when applying a hot OpenCode approval decision", async () => {
    getInterruptMock.mockResolvedValue({
      id: "interrupt-approval",
      kind: "runtime_permission",
      providerRequestId: "request-1",
      providerToolUseId: "tool-1",
      display: {},
    });

    const permissionReplyMock = vi.fn().mockResolvedValue(undefined);
    const mgr = asTestManager();
    await (mgr as any).decisionFlow.applyRuntimeApprovalDecision({
      ctx: createCtx({
        id: "gen-approval",
        conversationId: "conv-approval",
        runtimeId: "runtime-1",
        userId: "user-1",
        model: "openai/gpt-5.4",
      }),
      interruptId: "interrupt-approval",
      decision: "allow",
      sendRuntimeDecision: (request: any) =>
        sendRuntimeApprovalDecision(
          {
            permission: { reply: permissionReplyMock },
            question: { reply: vi.fn(), reject: vi.fn() },
          },
          request,
        ),
    });

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "request-1",
      reply: "always",
    });
    expect(vi.mocked(getOrCreateConversationRuntime)).not.toHaveBeenCalled();
  });

  it("restores a suspended snapshot, replays the resolved OpenCode approval, and clears resumeInterruptId", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-resume-interrupt",
      title: "Conversation",
    });
    interruptStore.set("interrupt-resume-permission", {
      id: "interrupt-resume-permission",
      generationId: "gen-resume-interrupt",
      runtimeId: "runtime-1",
      conversationId: "conv-resume-interrupt",
      turnSeq: 3,
      kind: "runtime_permission",
      status: "accepted",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        toolInput: { permission: "external_directory" },
      },
      provider: "opencode",
      providerRequestId: "permission-request-resume",
      providerToolUseId: "tool-resume-permission",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    const runtime = createConversationRuntimeMock({
      promptMock,
      subscribeMock,
      sessionSource: "restored_snapshot",
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      runtime as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);

    const ctx = createCtx({
      id: "gen-resume-interrupt",
      conversationId: "conv-resume-interrupt",
      resumeInterruptId: "interrupt-resume-permission",
      currentInterruptId: "interrupt-resume-permission",
      remainingRunMs: 444_000,
      deadlineAt: new Date(0),
      suspendedAt: new Date("2026-03-11T15:00:00.000Z"),
      status: "awaiting_approval",
      sessionId: undefined,
      model: "openai/gpt-5.4",
      runtimeTurnSeq: 3,
      runtimeCallbackToken: "runtime-token",
    });

    await (mgr as any).resumeRunner.runSuspendedInterruptResume(ctx);

    expect(vi.mocked(getOrCreateConversationRuntime)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowSnapshotRestore: true,
        replayHistory: false,
      }),
    );
    expect(runtime.harnessClient.replyPermission).toHaveBeenCalledWith({
      requestID: "permission-request-resume",
      reply: "always",
    });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith(
      "interrupt-resume-permission",
    );
    expect(ctx.resumeInterruptId).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeInterruptId: null,
        suspendedAt: null,
      }),
    );
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(promptMock).not.toHaveBeenCalled();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("restores a parked plugin write, injects the approved command result, and prompts OpenCode to continue", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-plugin-resume",
      title: "Conversation",
    });
    interruptStore.set("interrupt-plugin-resume", {
      id: "interrupt-plugin-resume",
      generationId: "gen-plugin-resume",
      runtimeId: "runtime-1",
      conversationId: "conv-plugin-resume",
      turnSeq: 4,
      kind: "plugin_write",
      status: "accepted",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi --as bot",
        toolInput: {
          command: "slack send -c C123 -t hi --as bot",
          workdir: "/app",
        },
        runtimeTool: {
          sessionId: "session-1",
          messageId: "message-assistant-1",
          partId: "part-tool-1",
          callId: "call-tool-1",
          toolName: "bash",
          input: {
            command: "slack send -c C123 -t hi --as bot",
            workdir: "/app",
          },
        },
      },
      provider: "plugin",
      providerRequestId: "plugin-write:runtime-1:4:opencode:call-tool-1",
      providerToolUseId: "plugin-tool-1",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    const execMock = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    execMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    execMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    execMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '[{"ok":true,"ts":"1775739000.000100"}]\n',
      stderr: "",
    });
    const runtime = createConversationRuntimeMock({
      promptMock,
      subscribeMock,
      exec: execMock,
      sessionSource: "restored_snapshot",
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      runtime as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-plugin-resume",
      conversationId: "conv-plugin-resume",
      resumeInterruptId: "interrupt-plugin-resume",
      remainingRunMs: 444_000,
      deadlineAt: new Date(0),
      suspendedAt: new Date("2026-03-11T15:00:00.000Z"),
      status: "awaiting_approval",
      sessionId: "session-1",
      model: "openai/gpt-5.4",
      runtimeTurnSeq: 4,
      runtimeCallbackToken: "runtime-token",
      contentParts: [
        {
          type: "tool_use",
          id: "call-tool-1",
          name: "bash",
          input: {
            command: "slack send -c C123 -t hi --as bot",
            workdir: "/app",
          },
          integration: "slack",
          operation: "send",
        },
      ],
    });

    await (mgr as any).resumeRunner.runSuspendedInterruptResume(ctx);

    const commands = execMock.mock.calls.map((call) => String(call[0]));
    expect(commands.join("\n")).toContain("slack send -c C123 -t hi --as bot");
    expect(runtime.harnessClient.updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        messageID: "message-assistant-1",
        partID: "part-tool-1",
        part: expect.objectContaining({
          callID: "call-tool-1",
          state: expect.objectContaining({
            status: "completed",
            output: '[{"ok":true,"ts":"1775739000.000100"}]\n',
          }),
        }),
      }),
    );
    expect(markInterruptAppliedMock).toHaveBeenCalledWith(
      "interrupt-plugin-resume",
    );
    expect(ctx.contentParts).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "call-tool-1",
        content: '[{"ok":true,"ts":"1775739000.000100"}]\n',
      }),
    );
    expect(ctx.contentParts).not.toContainEqual({
      type: "text",
      text: "Done.",
    });
    expect(promptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        agent: CMDCLAW_CHAT_AGENT_ID,
        system: "mock system prompt for chat",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parts: [
          {
            type: "text",
            text: "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
          },
        ],
      }),
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("restores a parked auth interrupt, applies it, and prompts OpenCode to continue", async () => {
    interruptStore.set("interrupt-auth-resume", {
      id: "interrupt-auth-resume",
      generationId: "gen-auth-resume",
      runtimeId: "runtime-1",
      conversationId: "conv-auth-resume",
      turnSeq: 4,
      kind: "auth",
      status: "accepted",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["notion"] },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "auth-resume-notion",
      responsePayload: {
        connectedIntegrations: ["notion"],
        integration: "notion",
      },
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    const runtime = createConversationRuntimeMock({
      promptMock,
      subscribeMock,
      sessionSource: "restored_snapshot",
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      runtime as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-auth-resume",
      conversationId: "conv-auth-resume",
      resumeInterruptId: "interrupt-auth-resume",
      remainingRunMs: 444_000,
      deadlineAt: new Date(0),
      suspendedAt: new Date("2026-03-11T15:00:00.000Z"),
      status: "awaiting_auth",
      sessionId: "session-1",
      model: "openai/gpt-5.4",
      runtimeTurnSeq: 4,
      runtimeCallbackToken: "runtime-token",
    });

    await (mgr as any).resumeRunner.runSuspendedInterruptResume(ctx);

    expect(promptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        agent: CMDCLAW_CHAT_AGENT_ID,
        system: "mock system prompt for chat",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parts: [
          {
            type: "text",
            text: "Continue the interrupted assistant turn. Authentication for notion is now complete.",
          },
        ],
      }),
    );
    expect(ctx.resumeInterruptId).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeInterruptId: null,
        suspendedAt: null,
      }),
    );
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("restores a parked runtime question, reapplies the answer, and prompts OpenCode to continue", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-question-resume",
      title: "Conversation",
    });
    interruptStore.set("interrupt-question-resume", {
      id: "interrupt-question-resume",
      generationId: "gen-question-resume",
      runtimeId: "runtime-1",
      conversationId: "conv-question-resume",
      turnSeq: 4,
      kind: "runtime_question",
      status: "accepted",
      display: {
        title: "question",
        integration: "cmdclaw",
        operation: "question",
        toolInput: {
          questions: [
            {
              header: "Pick",
              question: "Choose one",
              options: [
                { label: "Alpha", description: "Alpha" },
                { label: "Beta", description: "Beta" },
              ],
            },
          ],
        },
      },
      provider: "opencode",
      providerRequestId: "question-request-resume",
      providerToolUseId: "tool-question-resume",
      responsePayload: {
        questionAnswers: [["Beta"]],
      },
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    const runtime = createConversationRuntimeMock({
      promptMock,
      subscribeMock,
      sessionSource: "restored_snapshot",
    });
    vi.mocked(getOrCreateConversationRuntime).mockResolvedValue(
      runtime as Awaited<ReturnType<typeof getOrCreateConversationRuntime>>,
    );

    const mgr = asTestManager();
    const finishSpy = vi
      .spyOn(mgr, "finishGeneration")
      .mockResolvedValue(undefined);
    const ctx = createCtx({
      id: "gen-question-resume",
      conversationId: "conv-question-resume",
      resumeInterruptId: "interrupt-question-resume",
      currentInterruptId: "interrupt-question-resume",
      remainingRunMs: 444_000,
      deadlineAt: new Date(0),
      suspendedAt: new Date("2026-03-11T15:00:00.000Z"),
      status: "awaiting_approval",
      sessionId: undefined,
      model: "openai/gpt-5.4",
      runtimeTurnSeq: 4,
      runtimeCallbackToken: "runtime-token",
      builderCoworkerContext: {
        coworkerId: "wf-builder-resume",
        updatedAt: "2026-03-03T12:00:00.000Z",
        prompt: "Current coworker prompt",
        model: "openai/gpt-5.4",
        toolAccessMode: "selected",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: [],
      },
    });

    await (mgr as any).resumeRunner.runSuspendedInterruptResume(ctx);

    expect(runtime.harnessClient.replyQuestion).toHaveBeenCalledWith({
      requestID: "question-request-resume",
      answers: [["Beta"]],
    });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith(
      "interrupt-question-resume",
    );
    expect(vi.mocked(composeOpencodePromptSpec)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "coworker_builder",
        builderCoworkerContext: ctx.builderCoworkerContext,
      }),
    );
    expect(promptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        agent: CMDCLAW_COWORKER_BUILDER_AGENT_ID,
        system: "mock system prompt for coworker_builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parts: [
          {
            type: "text",
            text: "Continue the interrupted assistant turn. The pending question has been answered. The resolved answer was: Beta.",
          },
        ],
      }),
    );
    expect(ctx.resumeInterruptId).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
  });

  it("reaps stale generations and error-finalizes running and waiting contexts", async () => {
    const now = Date.now();
    interruptStore.set("interrupt-stale-approval", {
      id: "interrupt-stale-approval",
      generationId: "gen-stale-approval",
      kind: "runtime_question",
      status: "pending",
      requestedAt: new Date(now - 31 * 60 * 1000),
      expiresAt: new Date(now - 1_000),
    });
    interruptStore.set("interrupt-stale-auth", {
      id: "interrupt-stale-auth",
      generationId: "gen-stale-auth",
      kind: "auth",
      status: "pending",
      requestedAt: new Date(now - 61 * 60 * 1000),
      expiresAt: new Date(now - 1_000),
    });
    generationFindManyMock.mockResolvedValue([
      {
        id: "gen-stale-running",
        status: "running",
        startedAt: new Date(now - 7 * 60 * 60 * 1000),
      },
      {
        id: "gen-stale-approval",
        status: "awaiting_approval",
        startedAt: new Date(now - 31 * 60 * 1000),
      },
      {
        id: "gen-stale-auth",
        status: "awaiting_auth",
        startedAt: new Date(now - 61 * 60 * 1000),
      },
      {
        id: "gen-fresh-running",
        status: "running",
        startedAt: new Date(now - 30 * 60 * 1000),
      },
    ]);

    const mgr = asTestManager();
    mgr.activeGenerations.set(
      "gen-stale-running",
      createCtx({ id: "gen-stale-running" }),
    );
    mgr.activeGenerations.set(
      "gen-stale-approval",
      createCtx({ id: "gen-stale-approval" }),
    );
    mgr.activeGenerations.set(
      "gen-stale-auth",
      createCtx({ id: "gen-stale-auth" }),
    );
    mgr.activeGenerations.set(
      "gen-fresh-running",
      createCtx({ id: "gen-fresh-running" }),
    );

    const summary = await generationManager.reapStaleGenerations();

    expect(summary).toEqual({
      scanned: 4,
      stale: 1,
      finalizedRunningAsError: 1,
      finalizedWaitingAsError: 0,
    });

    expect(updateSetMock.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            status: "error",
            completedAt: expect.any(Date),
          }),
        ],
        [
          expect.objectContaining({
            generationStatus: "error",
          }),
        ],
      ]),
    );
    expect(mgr.activeGenerations.has("gen-stale-running")).toBe(false);
    expect(mgr.activeGenerations.has("gen-stale-approval")).toBe(true);
    expect(mgr.activeGenerations.has("gen-stale-auth")).toBe(true);
    expect(mgr.activeGenerations.has("gen-fresh-running")).toBe(true);
  });
});
