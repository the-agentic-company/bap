import { db } from "@cmdclaw/db/client";
import {
  conversation,
  coworker,
  generation,
  message,
  user,
  type GenerationExecutionPolicy,
  type SyntheticTrafficKind,
} from "@cmdclaw/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { IntegrationType } from "../../oauth/config";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "../../../lib/chat-model-defaults";
import { START_GENERATION_ERROR_CODES } from "../../../lib/generation-errors";
import { parseModelReference } from "../../../lib/model-reference";
import {
  normalizeModelAuthSource,
  providerSupportsAuthSource,
  type ProviderAuthSource,
} from "../../../lib/provider-auth-source";
import { normalizeCoworkerAllowedSkillSlugs, splitCoworkerAllowedSkillSlugs } from "../../../lib/coworker-tool-policy";
import { resolveDefaultOpencodeFreeModel } from "../../ai/opencode-models";
import type { RemoteIntegrationSource } from "../../integrations/remote-integrations";
import { createTraceId, logServerEvent } from "../../utils/observability";
import { resolveCoworkerBuilderContextByConversation } from "../coworker-builder-service";
import { generateCoworkerMetadataOnFirstPromptFill } from "../coworker-metadata";
import { GenerationStartError } from "../generation-start-error";
import { resolveSelectedPlatformSkillSlugs } from "../platform-skill-service";
import { conversationRuntimeService } from "../conversation-runtime-service";
import {
  createGenerationLifecycle,
  generationLifecyclePolicy,
} from "../lifecycle-policy";
import type { GenerationDebugInfo } from "./types";
import type { GenerationLifecycleStore } from "./core/lifecycle-store";
import { checkModelAccessForUser } from "./model-access";
import type { UserFileAttachment } from "./queue/conversation-turn-queue";

export type StartGenerationInput = {
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
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  allowedIntegrations?: IntegrationType[];
  fileAttachments?: UserFileAttachment[];
  selectedPlatformSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  syntheticKind?: SyntheticTrafficKind;
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
  remoteIntegrationSource?: RemoteIntegrationSource;
  debugRunDeadlineMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  syntheticKind?: SyntheticTrafficKind;
};

type TurnIntakeDeps = {
  lifecycleStore: GenerationLifecycleStore;
  persistMessageAttachments: (params: {
    conversationId: string;
    messageId: string;
    attachments: UserFileAttachment[];
  }) => Promise<void>;
  enqueuePreparingStuckCheck: (generationId: string) => Promise<void>;
  enqueueGenerationRun: (
    generationId: string,
    runType: "chat" | "coworker",
    options?: { traceId?: string },
  ) => Promise<void>;
};

const DEFAULT_MODEL_REFERENCE = DEFAULT_CONNECTED_CHATGPT_MODEL;

let cachedDefaultCoworkerModelPromise: Promise<string> | undefined;

export class TurnIntake {
  constructor(private readonly deps: TurnIntakeDeps) {}

  async startGeneration(
    params: StartGenerationInput,
  ): Promise<{ generationId: string; conversationId: string; traceId: string }> {
    const { content, userId, model, autoApprove } = params;
    const runDeadlineMs = resolveGenerationRunDeadlineMs(params.debugRunDeadlineMs);
    const debugApprovalHotWaitMs =
      params.debugApprovalHotWaitMs === undefined
        ? undefined
        : resolveApprovalHotWaitMs(params.debugApprovalHotWaitMs);
    const debugRuntimeNoProgressTimeoutMs =
      params.debugRuntimeNoProgressTimeoutMs === undefined
        ? undefined
        : resolveRuntimeNoProgressTimeoutMs(
            params.debugRuntimeNoProgressTimeoutMs,
          );
    const fileAttachments = params.fileAttachments;
    const requestedModel = model?.trim();
    if (requestedModel) {
      const { providerID } = parseModelReference(requestedModel);
      if (params.authSource && !providerSupportsAuthSource(providerID, params.authSource)) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
          rpcCode: "BAD_REQUEST",
          message: `Model provider "${providerID}" does not support auth source "${params.authSource}".`,
        });
      }
    }
    const requestedAuthSource = requestedModel
      ? resolveModelAuthSource({
          model: requestedModel,
          authSource: params.authSource,
        })
      : null;
    const traceId = createTraceId();
    const startGenerationStartedAt = Date.now();
    const logContext = {
      source: "generation-manager",
      traceId,
      userId,
      conversationId: params.conversationId,
    };
    logServerEvent(
      "info",
      "START_GENERATION_REQUESTED",
      {
        hasConversationId: Boolean(params.conversationId),
        requestedModel: requestedModel ?? null,
        hasAllowedIntegrations: params.allowedIntegrations !== undefined,
        sandboxProviderOverride: params.sandboxProvider ?? null,
        fileAttachmentsCount: fileAttachments?.length ?? 0,
        selectedPlatformSkillCount: params.selectedPlatformSkillSlugs?.length ?? 0,
      },
      logContext,
    );

    if (params.conversationId) {
      const existing = await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, params.conversationId),
          inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        ),
        columns: {
          id: true,
          status: true,
          completionReason: true,
        },
      });
      const requestedContinuation = params.content.trim().replace(/\s+/g, " ").toLowerCase();
      const canResumePausedRunDeadline =
        existing?.status === "paused" &&
        existing.completionReason === "run_deadline" &&
        (params.resumePausedGenerationId === existing.id ||
          (requestedContinuation === "continue" &&
            (params.resumePausedGenerationId === undefined ||
              params.resumePausedGenerationId === existing.id)));
      if (existing && !canResumePausedRunDeadline) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.ACTIVE_GENERATION_EXISTS,
          rpcCode: "BAD_REQUEST",
          message: `Generation already in progress for this conversation (${existing.id}, status=${existing.status})`,
        });
      }
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "active_generation_check",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      logContext,
    );

    let conv: typeof conversation.$inferSelect;
    let isNewConversation = false;

    if (params.conversationId) {
      const existing = await db.query.conversation.findFirst({
        where: eq(conversation.id, params.conversationId),
      });
      if (!existing) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.CONVERSATION_NOT_FOUND,
          rpcCode: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      if (existing.userId !== userId) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.ACCESS_DENIED,
          rpcCode: "FORBIDDEN",
          message: "Access denied",
        });
      }
      conv = existing;
    } else {
      isNewConversation = true;
      const resolvedModel = requestedModel ?? DEFAULT_MODEL_REFERENCE;
      const resolvedAuthSource = resolveModelAuthSource({
        model: resolvedModel,
        authSource: requestedAuthSource,
      });
      const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      const dbUser =
        "user" in db.query
          ? await db.query.user.findFirst({
              where: eq(user.id, userId),
              columns: {
                activeWorkspaceId: true,
              },
            })
          : null;
      const [newConv] = await db
        .insert(conversation)
        .values({
          userId,
          workspaceId: dbUser?.activeWorkspaceId ?? null,
          title,
          type: "chat",
          model: resolvedModel,
          authSource: resolvedAuthSource,
          autoApprove: false,
          syntheticKind: params.syntheticKind,
        })
        .returning();
      conv = newConv;
    }
    const resolvedModel = requestedModel ?? conv.model ?? DEFAULT_MODEL_REFERENCE;
    const resolvedAuthSource = resolveModelAuthSource({
      model: resolvedModel,
      authSource: requestedAuthSource ?? conv.authSource,
    });
    if (requestedModel || conv.authSource !== resolvedAuthSource) {
      const updatedConv = await this.deps.lifecycleStore.updateConversationModelSelection({
        conversationId: conv.id,
        model: resolvedModel,
        authSource: resolvedAuthSource,
      });
      if (updatedConv) {
        conv = updatedConv;
      }
    }
    const accessCheck = await checkModelAccessForUser({
      userId,
      model: resolvedModel,
      authSource: resolvedAuthSource,
    });
    if (!accessCheck.allowed) {
      logServerEvent(
        "warn",
        "START_GENERATION_MODEL_ACCESS_DENIED",
        {
          requestedModel: requestedModel ?? null,
          resolvedModel,
          reason: accessCheck.reason,
        },
        { ...logContext, conversationId: conv.id },
      );
      throw new GenerationStartError({
        generationErrorCode: START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
        rpcCode: "BAD_REQUEST",
        message: accessCheck.userMessage,
      });
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "model_access_validated",
        elapsedMs: Date.now() - startGenerationStartedAt,
        resolvedModel,
        resolvedAuthSource,
      },
      { ...logContext, conversationId: conv.id },
    );
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_ready",
        elapsedMs: Date.now() - startGenerationStartedAt,
        resolvedConversationId: conv.id,
        isNewConversation,
      },
      { ...logContext, conversationId: conv.id },
    );

    const selectedPlatformSkillSlugs = await resolveSelectedPlatformSkillSlugs(
      params.selectedPlatformSkillSlugs,
    );
    let builderCoworkerContext =
      conv.type === "coworker"
        ? await resolveCoworkerBuilderContextByConversation({
            database: db,
            userId,
            conversationId: conv.id,
          })
        : null;

    const [userMsg] = await db
      .insert(message)
      .values({
        conversationId: conv.id,
        role: "user",
        content,
      })
      .returning();

    if (builderCoworkerContext) {
      const coworkerMetadataRow = await db.query.coworker.findFirst({
        where: and(
          eq(coworker.id, builderCoworkerContext.coworkerId),
          eq(coworker.ownerId, userId),
        ),
        columns: {
          id: true,
          name: true,
          description: true,
          username: true,
          prompt: true,
          triggerType: true,
          allowedIntegrations: true,
          allowedCustomIntegrations: true,
          schedule: true,
          autoApprove: true,
          promptDo: true,
          promptDont: true,
        },
      });

      if (coworkerMetadataRow) {
        const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
          database: db,
          current: coworkerMetadataRow,
          next: {
            ...coworkerMetadataRow,
            prompt: content,
          },
        });
        const persistedMetadataUpdates = Object.fromEntries(
          Object.entries(metadataUpdates).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );

        if (Object.keys(persistedMetadataUpdates).length > 0) {
          await db
            .update(coworker)
            .set(persistedMetadataUpdates)
            .where(eq(coworker.id, builderCoworkerContext.coworkerId));

          builderCoworkerContext =
            (await resolveCoworkerBuilderContextByConversation({
              database: db,
              userId,
              conversationId: conv.id,
            })) ?? builderCoworkerContext;
        }
      }
    }

    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "message_saved",
        elapsedMs: Date.now() - startGenerationStartedAt,
        messageId: userMsg.id,
      },
      { ...logContext, conversationId: conv.id },
    );

    if (fileAttachments && fileAttachments.length > 0) {
      try {
        await this.deps.persistMessageAttachments({
          conversationId: conv.id,
          messageId: userMsg.id,
          attachments: fileAttachments,
        });
        logServerEvent(
          "info",
          "START_GENERATION_PHASE_DONE",
          {
            phase: "attachments_uploaded",
            elapsedMs: Date.now() - startGenerationStartedAt,
            fileAttachmentsCount: fileAttachments.length,
          },
          { ...logContext, conversationId: conv.id },
        );
      } catch (err) {
        logServerEvent(
          "error",
          "START_GENERATION_ATTACHMENTS_UPLOAD_FAILED",
          {
            elapsedMs: Date.now() - startGenerationStartedAt,
            error: formatErrorMessage(err),
          },
          { ...logContext, conversationId: conv.id },
        );
      }
    }

    const executionPolicy = buildExecutionPolicy({
      allowedIntegrations: params.allowedIntegrations,
      remoteIntegrationSource: params.remoteIntegrationSource,
      autoApprove: autoApprove ?? conv.autoApprove,
      sandboxProvider: params.sandboxProvider,
      selectedPlatformSkillSlugs,
      queuedFileAttachments: fileAttachments,
      debugRunDeadlineMs: params.debugRunDeadlineMs,
      debugApprovalHotWaitMs,
      debugRuntimeNoProgressTimeoutMs,
      debugForceRuntimeNoProgressAfterPrompt:
        params.debugForceRuntimeNoProgressAfterPrompt,
    });
    const lifecycle = createGenerationLifecycle();
    lifecycle.deadlineAt = new Date(lifecycle.lastRuntimeEventAt.getTime() + runDeadlineMs);
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: conv.id,
        status: "running",
        executionPolicy,
        debugInfo: buildInitialDebugInfo(
          params.remoteIntegrationSource,
          params.allowedIntegrations,
        ),
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
        traceId,
        deadlineAt: lifecycle.deadlineAt,
        remainingRunMs: runDeadlineMs,
        lastRuntimeEventAt: lifecycle.lastRuntimeEventAt,
        recoveryAttempts: lifecycle.recoveryAttempts,
        completionReason: lifecycle.completionReason,
      })
      .returning();
    const runtimeBinding = await conversationRuntimeService.bindGenerationToRuntime({
      conversationId: conv.id,
      generationId: genRecord.id,
    });
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "generation_record_created",
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: genRecord.id,
        runtimeId: runtimeBinding.runtimeId,
        turnSeq: runtimeBinding.turnSeq,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    await this.deps.lifecycleStore.markConversationGenerationStarted({
      conversationId: conv.id,
      generationId: genRecord.id,
    });
    await this.deps.enqueuePreparingStuckCheck(genRecord.id);
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_status_updated",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    await this.deps.enqueueGenerationRun(genRecord.id, "chat", { traceId });

    logServerEvent(
      "info",
      "GENERATION_ENQUEUED",
      {
        backendType: "runtime",
        delivery: "queue",
        enqueuedAttachmentsCount: fileAttachments?.length ?? 0,
      },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: conv.id,
        userId,
      },
    );
    logServerEvent(
      "info",
      "START_GENERATION_RETURNING",
      {
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: genRecord.id,
      },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: conv.id,
        userId,
      },
    );

    return {
      generationId: genRecord.id,
      conversationId: conv.id,
      traceId,
    };
  }

  async startCoworkerGeneration(
    params: StartCoworkerGenerationInput,
  ): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model } = params;
    const resolvedModel = await resolveCoworkerModel(model);
    const resolvedAuthSource = resolveModelAuthSource({
      model: resolvedModel,
      authSource: params.authSource,
    });
    const accessCheck = await checkModelAccessForUser({
      userId,
      model: resolvedModel,
      authSource: resolvedAuthSource,
    });
    if (!accessCheck.allowed) {
      throw new Error(accessCheck.userMessage);
    }
    const normalizedAllowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(
      params.allowedSkillSlugs,
    );
    const { platformSkillSlugs } = splitCoworkerAllowedSkillSlugs(normalizedAllowedSkillSlugs);
    const selectedPlatformSkillSlugs = await resolveSelectedPlatformSkillSlugs(platformSkillSlugs);
    const debugRuntimeNoProgressTimeoutMs =
      params.debugRuntimeNoProgressTimeoutMs === undefined
        ? undefined
        : resolveRuntimeNoProgressTimeoutMs(
            params.debugRuntimeNoProgressTimeoutMs,
          );

    const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    const [newConv] = await db
      .insert(conversation)
      .values({
        userId,
        workspaceId: params.workspaceId ?? null,
        title: title || "Coworker run",
        type: "coworker",
        model: resolvedModel,
        authSource: resolvedAuthSource,
        autoApprove: params.autoApprove,
        syntheticKind: params.syntheticKind,
      })
      .returning();

    const [userMessage] = await db
      .insert(message)
      .values({
        conversationId: newConv.id,
        role: "user",
        content,
      })
      .returning({ id: message.id });

    if (!userMessage?.id) {
      throw new Error("Failed to create coworker user message");
    }

    if (params.fileAttachments && params.fileAttachments.length > 0) {
      await this.deps.persistMessageAttachments({
        conversationId: newConv.id,
        messageId: userMessage.id,
        attachments: params.fileAttachments,
      });
    }

    const executionPolicy = buildExecutionPolicy({
      allowedIntegrations: params.allowedIntegrations,
      allowedCustomIntegrations: params.allowedCustomIntegrations,
      allowedExecutorSourceIds: params.allowedExecutorSourceIds,
      allowedSkillSlugs: normalizedAllowedSkillSlugs,
      remoteIntegrationSource: params.remoteIntegrationSource,
      autoApprove: params.autoApprove,
      sandboxProvider: params.sandboxProvider,
      selectedPlatformSkillSlugs,
      queuedFileAttachments: params.fileAttachments,
      debugRunDeadlineMs: params.debugRunDeadlineMs,
      debugRuntimeNoProgressTimeoutMs,
      debugForceRuntimeNoProgressAfterPrompt:
        params.debugForceRuntimeNoProgressAfterPrompt,
    });
    const traceId = createTraceId();
    const lifecycle = createGenerationLifecycle();
    const runDeadlineMs = resolveGenerationRunDeadlineMs(params.debugRunDeadlineMs);
    lifecycle.deadlineAt = new Date(lifecycle.lastRuntimeEventAt.getTime() + runDeadlineMs);
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: newConv.id,
        status: "running",
        executionPolicy,
        debugInfo: buildInitialDebugInfo(
          params.remoteIntegrationSource,
          params.allowedIntegrations,
        ),
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
        traceId,
        deadlineAt: lifecycle.deadlineAt,
        remainingRunMs: runDeadlineMs,
        lastRuntimeEventAt: lifecycle.lastRuntimeEventAt,
        recoveryAttempts: lifecycle.recoveryAttempts,
        completionReason: lifecycle.completionReason,
      })
      .returning();
    await conversationRuntimeService.bindGenerationToRuntime({
      conversationId: newConv.id,
      generationId: genRecord.id,
    });

    await this.deps.lifecycleStore.markConversationGenerationStarted({
      conversationId: newConv.id,
      generationId: genRecord.id,
    });

    await this.deps.enqueueGenerationRun(genRecord.id, "coworker", { traceId });

    logServerEvent(
      "info",
      "COWORKER_GENERATION_ENQUEUED",
      { delivery: "queue" },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: newConv.id,
        userId,
      },
    );

    return {
      generationId: genRecord.id,
      conversationId: newConv.id,
    };
  }
}

function resolveModelAuthSource(params: {
  model: string;
  authSource?: ProviderAuthSource | null;
}): ProviderAuthSource | null {
  return normalizeModelAuthSource({
    model: params.model,
    authSource: params.authSource,
  });
}

async function resolveCoworkerModel(model?: string): Promise<string> {
  const configured = model?.trim();
  if (configured) {
    parseModelReference(configured);
    return configured;
  }

  if (!cachedDefaultCoworkerModelPromise) {
    cachedDefaultCoworkerModelPromise = resolveDefaultOpencodeFreeModel();
  }

  return cachedDefaultCoworkerModelPromise;
}

function buildExecutionPolicy(params: {
  allowedIntegrations?: IntegrationType[];
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  queuedFileAttachments?: UserFileAttachment[];
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
}): GenerationExecutionPolicy {
  return {
    allowedIntegrations: params.allowedIntegrations,
    allowedCustomIntegrations: params.allowedCustomIntegrations,
    allowedExecutorSourceIds: params.allowedExecutorSourceIds,
    allowedSkillSlugs: params.allowedSkillSlugs,
    remoteIntegrationSource: params.remoteIntegrationSource,
    autoApprove: params.autoApprove,
    sandboxProvider: params.sandboxProvider,
    selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs,
    allowSnapshotRestoreOnRun: true,
    queuedFileAttachments: params.queuedFileAttachments,
    debugRunDeadlineMs: params.debugRunDeadlineMs,
    debugApprovalHotWaitMs: params.debugApprovalHotWaitMs,
    debugRuntimeNoProgressTimeoutMs:
      params.debugRuntimeNoProgressTimeoutMs,
    debugForceRuntimeNoProgressAfterPrompt:
      params.debugForceRuntimeNoProgressAfterPrompt,
  };
}

function resolveGenerationRunDeadlineMs(debugRunDeadlineMs: number | undefined): number {
  if (debugRunDeadlineMs === undefined) {
    return generationLifecyclePolicy.runDeadlineMs;
  }
  if (
    !Number.isInteger(debugRunDeadlineMs) ||
    debugRunDeadlineMs < 1_000 ||
    debugRunDeadlineMs > generationLifecyclePolicy.runDeadlineMs
  ) {
    throw new Error(
      `debugRunDeadlineMs must be an integer between 1000 and ${generationLifecyclePolicy.runDeadlineMs}`,
    );
  }
  return debugRunDeadlineMs;
}

function resolveApprovalHotWaitMs(debugApprovalHotWaitMs: number | undefined): number {
  if (debugApprovalHotWaitMs === undefined) {
    return generationLifecyclePolicy.approvalHotWaitMs;
  }
  if (
    !Number.isInteger(debugApprovalHotWaitMs) ||
    debugApprovalHotWaitMs < 1_000 ||
    debugApprovalHotWaitMs > generationLifecyclePolicy.runDeadlineMs
  ) {
    throw new Error(
      `debugApprovalHotWaitMs must be an integer between 1000 and ${generationLifecyclePolicy.runDeadlineMs}`,
    );
  }
  return debugApprovalHotWaitMs;
}

function resolveRuntimeNoProgressTimeoutMs(
  debugRuntimeNoProgressTimeoutMs: number | undefined,
): number {
  if (debugRuntimeNoProgressTimeoutMs === undefined) {
    return generationLifecyclePolicy.runtimeNoProgressAfterPromptMs;
  }
  if (
    !Number.isInteger(debugRuntimeNoProgressTimeoutMs) ||
    debugRuntimeNoProgressTimeoutMs < 1_000 ||
    debugRuntimeNoProgressTimeoutMs >
      generationLifecyclePolicy.runtimeNoProgressAfterPromptMs
  ) {
    throw new Error(
      `debugRuntimeNoProgressTimeoutMs must be an integer between 1000 and ${generationLifecyclePolicy.runtimeNoProgressAfterPromptMs}`,
    );
  }
  return debugRuntimeNoProgressTimeoutMs;
}

function buildInitialDebugInfo(
  remoteIntegrationSource?: RemoteIntegrationSource,
  allowedIntegrations?: IntegrationType[],
): GenerationDebugInfo | undefined {
  if (!remoteIntegrationSource) {
    return undefined;
  }

  return {
    remoteRun: {
      targetEnv: remoteIntegrationSource.targetEnv,
      remoteUserId: remoteIntegrationSource.remoteUserId,
      remoteUserEmail: remoteIntegrationSource.remoteUserEmail ?? null,
      allowedIntegrations: allowedIntegrations ? [...allowedIntegrations] : undefined,
      phases: {},
    },
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
