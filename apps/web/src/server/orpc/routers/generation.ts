import { GENERATION_ERROR_PHASES } from "@cmdclaw/core/lib/generation-errors";
import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import { PROVIDER_AUTH_SOURCES } from "@cmdclaw/core/lib/provider-auth-source";
import { generationManager } from "@cmdclaw/core/server/services/generation-manager";
import { isGenerationStartError } from "@cmdclaw/core/server/services/generation-start-error";
import { startPendingCoworkerRun } from "@cmdclaw/core/server/services/coworker-service";
import { generationLifecyclePolicy } from "@cmdclaw/core/server/services/lifecycle-policy";
import { listSelectablePlatformSkills } from "@cmdclaw/core/server/services/platform-skill-service";
import {
  createTraceId,
  emitCanonicalServiceEvent,
  logServerEvent,
} from "@cmdclaw/core/server/utils/observability";
import { db } from "@cmdclaw/db/client";
import { generation, conversation, coworkerRun, generationInterrupt } from "@cmdclaw/db/schema";
import { eventIterator, ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { detectMessageLanguage } from "@/server/utils/detect-message-language";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

const activeGenerationStatuses = [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
] as const;

type ActiveGenerationStatus = (typeof activeGenerationStatuses)[number];

const activeConversationStatuses = new Set([
  "generating",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

function normalizeRpcErrorCode(error: unknown): string {
  if (isGenerationStartError(error)) {
    return error.generationErrorCode;
  }
  if (error instanceof ORPCError) {
    return error.code.toLowerCase();
  }
  if (error instanceof Error) {
    return error.name.toLowerCase();
  }
  return "unknown_error";
}

function isActiveGenerationStatus(
  status: string | null | undefined,
): status is ActiveGenerationStatus {
  return (
    status !== null &&
    status !== undefined &&
    (activeGenerationStatuses as readonly string[]).includes(status)
  );
}

function mapGenerationStatusToConversationStatus(
  status: ActiveGenerationStatus,
): "generating" | "awaiting_approval" | "awaiting_auth" | "paused" {
  return status === "running" ? "generating" : status;
}

// Schema for generation events (same structure as GenerationEvent type)
const generationEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("system"),
    content: z.string(),
    coworkerId: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_use"),
    toolName: z.string(),
    toolInput: z.unknown(),
    toolUseId: z.string().optional(),
    integration: z.string().optional(),
    operation: z.string().optional(),
    isWrite: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    result: z.unknown(),
    toolUseId: z.string().optional(),
  }),
  z.object({
    type: z.literal("thinking"),
    content: z.string(),
    thinkingId: z.string(),
  }),
  z.object({
    type: z.literal("interrupt_pending"),
    interruptId: z.string(),
    generationId: z.string(),
    runtimeId: z.string().nullable(),
    conversationId: z.string(),
    turnSeq: z.number().int().positive().nullable(),
    kind: z.enum(["plugin_write", "runtime_permission", "runtime_question", "auth"]),
    status: z.enum(["pending", "accepted", "rejected", "expired", "cancelled"]),
    providerToolUseId: z.string(),
    display: z.object({
      title: z.string(),
      integration: z.string().optional(),
      operation: z.string().optional(),
      command: z.string().optional(),
      toolInput: z.record(z.string(), z.unknown()).optional(),
      questionSpec: z
        .object({
          questions: z.array(
            z.object({
              header: z.string(),
              question: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  description: z.string().optional(),
                }),
              ),
              multiple: z.boolean().optional(),
              custom: z.boolean().optional(),
            }),
          ),
        })
        .optional(),
      authSpec: z
        .object({
          integrations: z.array(z.string()),
          reason: z.string().optional(),
        })
        .optional(),
    }),
    responsePayload: z
      .object({
        questionAnswers: z.array(z.array(z.string())).optional(),
        connectedIntegrations: z.array(z.string()).optional(),
        integration: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("interrupt_resolved"),
    interruptId: z.string(),
    generationId: z.string(),
    runtimeId: z.string().nullable(),
    conversationId: z.string(),
    turnSeq: z.number().int().positive().nullable(),
    kind: z.enum(["plugin_write", "runtime_permission", "runtime_question", "auth"]),
    status: z.enum(["pending", "accepted", "rejected", "expired", "cancelled"]),
    providerToolUseId: z.string(),
    display: z.object({
      title: z.string(),
      integration: z.string().optional(),
      operation: z.string().optional(),
      command: z.string().optional(),
      toolInput: z.record(z.string(), z.unknown()).optional(),
      questionSpec: z
        .object({
          questions: z.array(
            z.object({
              header: z.string(),
              question: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  description: z.string().optional(),
                }),
              ),
              multiple: z.boolean().optional(),
              custom: z.boolean().optional(),
            }),
          ),
        })
        .optional(),
      authSpec: z
        .object({
          integrations: z.array(z.string()),
          reason: z.string().optional(),
        })
        .optional(),
    }),
    responsePayload: z
      .object({
        questionAnswers: z.array(z.array(z.string())).optional(),
        connectedIntegrations: z.array(z.string()).optional(),
        integration: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("done"),
    generationId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalCostUsd: z.number(),
    }),
    artifacts: z
      .object({
        timing: z
          .object({
            sandboxStartupDurationMs: z.number().optional(),
            sandboxStartupMode: z.enum(["created", "reused", "unknown"]).optional(),
            generationDurationMs: z.number().optional(),
            phaseDurationsMs: z
              .object({
                sandboxConnectOrCreateMs: z.number().optional(),
                opencodeReadyMs: z.number().optional(),
                sessionReadyMs: z.number().optional(),
                agentInitMs: z.number().optional(),
                prePromptSetupMs: z.number().optional(),
                waitForFirstEventMs: z.number().optional(),
                promptToFirstTokenMs: z.number().optional(),
                generationToFirstTokenMs: z.number().optional(),
                promptToFirstVisibleOutputMs: z.number().optional(),
                generationToFirstVisibleOutputMs: z.number().optional(),
                modelStreamMs: z.number().optional(),
                postProcessingMs: z.number().optional(),
              })
              .optional(),
            phaseTimestamps: z
              .array(
                z.object({
                  phase: z.string(),
                  at: z.string(),
                  elapsedMs: z.number(),
                }),
              )
              .optional(),
          })
          .optional(),
        attachments: z.array(
          z.object({
            id: z.string(),
            filename: z.string(),
            mimeType: z.string(),
            sizeBytes: z.number(),
          }),
        ),
        sandboxFiles: z.array(
          z.object({
            fileId: z.string(),
            path: z.string(),
            filename: z.string(),
            mimeType: z.string(),
            sizeBytes: z.number().nullable(),
          }),
        ),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("cancelled"),
    generationId: z.string(),
    conversationId: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("status_change"),
    status: z.string(),
    metadata: z
      .object({
        sandboxProvider: z.enum(["e2b", "daytona", "docker"]).optional(),
        runtimeId: z.string().optional(),
        runtimeHarness: z.enum(["opencode", "agent-sdk"]).optional(),
        runtimeProtocolVersion: z.enum(["opencode-v2", "sandbox-agent-v1"]).optional(),
        sandboxId: z.string().optional(),
        sessionId: z.string().optional(),
        parkedInterruptId: z.string().optional(),
        releasedSandboxId: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("sandbox_file"),
    fileId: z.string(),
    path: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().nullable(),
  }),
]);
const generationEventSchema = z.intersection(
  z.object({
    cursor: z.string().optional(),
  }),
  generationEventPayloadSchema,
);

async function requireConversationAccessInActiveWorkspace(
  userId: string,
  conversationId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv || conv.userId !== userId || conv.workspaceId !== workspaceId) {
    throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
  }

  return { conversation: conv, workspaceId };
}

async function requireGenerationAccessInActiveWorkspace(
  userId: string,
  generationId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const genRecord = await db.query.generation.findFirst({
    where: eq(generation.id, generationId),
    with: { conversation: true },
  });

  if (
    !genRecord ||
    genRecord.conversation.userId !== userId ||
    genRecord.conversation.workspaceId !== workspaceId
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Generation not found" });
  }

  return { generation: genRecord, workspaceId };
}

async function requireInterruptAccessInActiveWorkspace(
  userId: string,
  interruptId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const interrupt = await db.query.generationInterrupt.findFirst({
    where: eq(generationInterrupt.id, interruptId),
    columns: {
      id: true,
      conversationId: true,
    },
  });

  const conv = interrupt
    ? await db.query.conversation.findFirst({
        where: and(
          eq(conversation.id, interrupt.conversationId),
          eq(conversation.userId, userId),
          eq(conversation.workspaceId, workspaceId),
        ),
        columns: {
          id: true,
        },
      })
    : null;

  if (!interrupt || !conv) {
    throw new ORPCError("NOT_FOUND", { message: "Interrupt not found" });
  }

  return { interrupt, workspaceId };
}

// Start a new generation (returns immediately with generationId)
const modelReferenceSchema = z
  .string()
  .min(3)
  .refine((value) => {
    try {
      parseModelReference(value);
      return true;
    } catch {
      return false;
    }
  }, "Model must use provider/model format");
const providerAuthSourceSchema = z.enum(PROVIDER_AUTH_SOURCES);

const startGeneration = protectedProcedure
  .input(
    z
      .object({
        conversationId: z.string().optional(),
        content: z.string().max(100000),
        model: modelReferenceSchema.optional(),
        authSource: providerAuthSourceSchema.nullish(),
        autoApprove: z.boolean().optional(),
        sandboxProvider: z.enum(["e2b", "daytona", "docker"]).optional(),
        resumePausedGenerationId: z.string().optional(),
        debugRunDeadlineMs: z
          .number()
          .int()
          .min(1_000)
          .max(generationLifecyclePolicy.runDeadlineMs)
          .optional(),
        debugApprovalHotWaitMs: z
          .number()
          .int()
          .min(1_000)
          .max(generationLifecyclePolicy.runDeadlineMs)
          .optional(),
        debugRuntimeNoProgressTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(generationLifecyclePolicy.runtimeProgressStallMs)
          .optional(),
        debugForceRuntimeNoProgressAfterPrompt: z.boolean().optional(),
        selectedPlatformSkillSlugs: z.array(z.string().max(128)).max(50).optional(),
        fileAttachments: z
          .array(
            z.object({
              name: z.string(),
              mimeType: z.string(),
              dataUrl: z.string(),
            }),
          )
          .optional(),
      })
      .refine(
        (input) => input.content.trim().length > 0 || (input.fileAttachments?.length ?? 0) > 0,
        "Message content or at least one attachment is required",
      ),
  )
  .output(
    z.object({
      generationId: z.string(),
      conversationId: z.string(),
      traceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const startedAt = Date.now();
    const logContext = {
      source: "rpc",
      route: "/api/rpc/generation/startGeneration",
      rpcProcedure: "generation.startGeneration",
      userId: context.user.id,
    };

    try {
      if (input.conversationId) {
        await requireConversationAccessInActiveWorkspace(
          context.user.id,
          input.conversationId,
          context.workspaceId,
        );
      } else {
        await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
      }
      if (input.conversationId && !input.resumePausedGenerationId) {
        const pendingRun = await context.db.query.coworkerRun.findFirst({
          where: and(
            eq(coworkerRun.conversationId, input.conversationId),
            eq(coworkerRun.ownerId, context.user.id),
            eq(coworkerRun.status, "needs_user_input"),
          ),
          columns: { id: true },
        });
        if (pendingRun) {
          const result = await startPendingCoworkerRun({
            conversationId: input.conversationId,
            userId: context.user.id,
            userInput: input.content,
            fileAttachments: input.fileAttachments,
          });
          return {
            generationId: result.generationId,
            conversationId: result.conversationId,
            traceId: createTraceId(),
          };
        }
      }

      const result = await generationManager.startGeneration({
        conversationId: input.conversationId,
        content: input.content,
        model: input.model,
        authSource: input.authSource,
        userId: context.user.id,
        autoApprove: input.autoApprove,
        sandboxProvider: input.sandboxProvider,
        resumePausedGenerationId: input.resumePausedGenerationId,
        debugRunDeadlineMs: input.debugRunDeadlineMs,
        debugApprovalHotWaitMs: input.debugApprovalHotWaitMs,
        debugRuntimeNoProgressTimeoutMs: input.debugRuntimeNoProgressTimeoutMs,
        debugForceRuntimeNoProgressAfterPrompt: input.debugForceRuntimeNoProgressAfterPrompt,
        selectedPlatformSkillSlugs: input.selectedPlatformSkillSlugs,
        fileAttachments: input.fileAttachments,
      });

      const successLogContext = {
        ...logContext,
        generationId: result.generationId,
        conversationId: result.conversationId,
        traceId: result.traceId,
      };
      emitCanonicalServiceEvent({
        eventName: "cmdclaw.generation.start_rpc",
        operationName: "generation.start_rpc",
        eventId: `rpc:generation.start:${result.generationId}:${startedAt}`,
        outcome: "success",
        context: successLogContext,
        attributes: {
          "rpc.system": "orpc",
          "rpc.method": "generation.startGeneration",
          "http.route": "/api/rpc/generation/startGeneration",
          "cmdclaw.generation.id": result.generationId,
          "cmdclaw.conversation.id": result.conversationId,
          "cmdclaw.user.id": context.user.id,
          "cmdclaw.generation.request.elapsed_ms": Date.now() - startedAt,
          "cmdclaw.model.provider": input.model
            ? parseModelReference(input.model).providerID
            : null,
          "cmdclaw.sandbox.provider": input.sandboxProvider ?? "default",
          "cmdclaw.generation.file_attachment_count": input.fileAttachments?.length ?? 0,
          "cmdclaw.generation.selected_platform_skill_count":
            input.selectedPlatformSkillSlugs?.length ?? 0,
        },
      });
      logServerEvent(
        "info",
        "RPC_START_GENERATION_OK",
        {
          elapsedMs: Date.now() - startedAt,
        },
        successLogContext,
      );

      return result;
    } catch (error) {
      emitCanonicalServiceEvent({
        eventName: "cmdclaw.generation.start_rpc",
        operationName: "generation.start_rpc",
        eventId: `rpc:generation.start:failed:${context.user.id}:${startedAt}`,
        outcome: "failure",
        context: {
          ...logContext,
          conversationId: input.conversationId,
        },
        attributes: {
          "rpc.system": "orpc",
          "rpc.method": "generation.startGeneration",
          "http.route": "/api/rpc/generation/startGeneration",
          "cmdclaw.conversation.id": input.conversationId,
          "cmdclaw.user.id": context.user.id,
          "cmdclaw.generation.request.elapsed_ms": Date.now() - startedAt,
          "cmdclaw.failure.phase": GENERATION_ERROR_PHASES.START_RPC,
          "cmdclaw.error.normalized_code": normalizeRpcErrorCode(error),
          "cmdclaw.model.provider": input.model
            ? parseModelReference(input.model).providerID
            : null,
          "cmdclaw.sandbox.provider": input.sandboxProvider ?? "default",
          "cmdclaw.generation.file_attachment_count": input.fileAttachments?.length ?? 0,
          "cmdclaw.generation.selected_platform_skill_count":
            input.selectedPlatformSkillSlugs?.length ?? 0,
        },
      });
      logServerEvent(
        "error",
        "RPC_START_GENERATION_FAILED",
        {
          elapsedMs: Date.now() - startedAt,
          conversationId: input.conversationId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          generationErrorCode: isGenerationStartError(error) ? error.generationErrorCode : null,
        },
        logContext,
      );
      if (isGenerationStartError(error)) {
        throw new ORPCError(error.rpcCode, {
          defined: true,
          message: error.message,
          data: {
            generationErrorCode: error.generationErrorCode,
            phase: GENERATION_ERROR_PHASES.START_RPC,
          },
        });
      }
      throw error;
    }
  });

const enqueueConversationMessage = protectedProcedure
  .input(
    z.object({
      conversationId: z.string(),
      content: z.string().min(1).max(100000),
      selectedPlatformSkillSlugs: z.array(z.string().max(128)).max(50).optional(),
      fileAttachments: z
        .array(
          z.object({
            name: z.string(),
            mimeType: z.string(),
            dataUrl: z.string(),
          }),
        )
        .optional(),
      replaceExisting: z.boolean().optional(),
    }),
  )
  .output(
    z.object({
      queuedMessageId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireConversationAccessInActiveWorkspace(
      context.user.id,
      input.conversationId,
      context.workspaceId,
    );
    return generationManager.enqueueConversationMessage({
      conversationId: input.conversationId,
      userId: context.user.id,
      content: input.content,
      fileAttachments: input.fileAttachments,
      selectedPlatformSkillSlugs: input.selectedPlatformSkillSlugs,
      replaceExisting: input.replaceExisting,
    });
  });

const listConversationQueuedMessages = protectedProcedure
  .input(
    z.object({
      conversationId: z.string(),
    }),
  )
  .output(
    z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        fileAttachments: z
          .array(
            z.object({
              name: z.string(),
              mimeType: z.string(),
              dataUrl: z.string(),
            }),
          )
          .optional(),
        selectedPlatformSkillSlugs: z.array(z.string()).optional(),
        status: z.enum(["queued", "processing"]),
        createdAt: z.string(),
      }),
    ),
  )
  .handler(async ({ input, context }) => {
    await requireConversationAccessInActiveWorkspace(
      context.user.id,
      input.conversationId,
      context.workspaceId,
    );
    let queued;
    try {
      queued = await generationManager.listConversationQueuedMessages(
        input.conversationId,
        context.user.id,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Conversation not found") {
        return [];
      }
      throw error;
    }
    return queued.map((item) => ({
      id: item.id,
      content: item.content,
      fileAttachments: item.fileAttachments,
      selectedPlatformSkillSlugs: item.selectedPlatformSkillSlugs,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    }));
  });

const removeConversationQueuedMessage = protectedProcedure
  .input(
    z.object({
      queuedMessageId: z.string(),
      conversationId: z.string(),
    }),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    await requireConversationAccessInActiveWorkspace(
      context.user.id,
      input.conversationId,
      context.workspaceId,
    );
    const success = await generationManager.removeConversationQueuedMessage(
      input.queuedMessageId,
      input.conversationId,
      context.user.id,
    );
    return { success };
  });

const updateConversationQueuedMessage = protectedProcedure
  .input(
    z.object({
      queuedMessageId: z.string(),
      conversationId: z.string(),
      content: z.string().min(1).max(100000),
      selectedPlatformSkillSlugs: z.array(z.string().max(128)).max(50).optional(),
      fileAttachments: z
        .array(
          z.object({
            name: z.string(),
            mimeType: z.string(),
            dataUrl: z.string(),
          }),
        )
        .optional(),
    }),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    await requireConversationAccessInActiveWorkspace(
      context.user.id,
      input.conversationId,
      context.workspaceId,
    );
    const success = await generationManager.updateConversationQueuedMessage({
      queuedMessageId: input.queuedMessageId,
      conversationId: input.conversationId,
      userId: context.user.id,
      content: input.content,
      fileAttachments: input.fileAttachments,
      selectedPlatformSkillSlugs: input.selectedPlatformSkillSlugs,
    });
    return { success };
  });

const listPlatformSkills = protectedProcedure
  .output(
    z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        description: z.string(),
      }),
    ),
  )
  .handler(async () => {
    return await listSelectablePlatformSkills();
  });

const detectUserMessageLanguage = protectedProcedure
  .input(
    z.object({
      text: z.string().min(1).max(10000),
    }),
  )
  .output(
    z.object({
      language: z.enum(["french", "other"]),
    }),
  )
  .handler(async ({ input }) => {
    const language = await detectMessageLanguage(input.text);
    return { language };
  });

// Subscribe to generation stream (can be called multiple times, from multiple clients)
const subscribeGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
      cursor: z.string().optional(),
    }),
  )
  .output(eventIterator(generationEventSchema))
  .handler(async function* ({ input, context }) {
    const access = await requireGenerationAccessInActiveWorkspace(
      context.user.id,
      input.generationId,
      context.workspaceId,
    );
    const streamId = access.generation.traceId ?? createTraceId();
    const openedAt = Date.now();
    const logContext = {
      source: "rpc",
      route: "/api/rpc/generation/subscribeGeneration",
      rpcProcedure: "generation.subscribeGeneration",
      generationId: input.generationId,
      conversationId: access.generation.conversationId,
      userId: context.user.id,
      traceId: streamId,
    };
    logServerEvent(
      "info",
      "RPC_SUBSCRIBE_GENERATION_OPENED",
      generationManager.getStreamCountersSnapshot(),
      logContext,
    );

    const stream = generationManager.subscribeToGeneration(input.generationId, context.user.id, {
      cursor: input.cursor,
    });

    try {
      for await (const event of stream) {
        yield event;
      }
    } finally {
      emitCanonicalServiceEvent({
        eventName: "cmdclaw.generation.subscribe_rpc",
        operationName: "generation.subscribe_rpc",
        eventId: `rpc:generation.subscribe:${input.generationId}:${streamId}`,
        outcome: "success",
        context: logContext,
        attributes: {
          "rpc.system": "orpc",
          "rpc.method": "generation.subscribeGeneration",
          "http.route": "/api/rpc/generation/subscribeGeneration",
          "cmdclaw.generation.id": input.generationId,
          "cmdclaw.conversation.id": access.generation.conversationId,
          "cmdclaw.user.id": context.user.id,
          "cmdclaw.generation.subscribe.state": "closed",
          "cmdclaw.generation.subscribe.elapsed_ms": Date.now() - openedAt,
          "cmdclaw.generation.subscribe.has_cursor": Boolean(input.cursor),
          ...generationManager.getStreamCountersSnapshot(),
        },
      });
      logServerEvent(
        "info",
        "RPC_SUBSCRIBE_GENERATION_CLOSED",
        {
          elapsedMs: Date.now() - openedAt,
          ...generationManager.getStreamCountersSnapshot(),
        },
        logContext,
      );
    }
  });

// Cancel a generation
const cancelGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    }),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    await requireGenerationAccessInActiveWorkspace(
      context.user.id,
      input.generationId,
      context.workspaceId,
    );
    const success = await generationManager.cancelGeneration(input.generationId, context.user.id);
    return { success };
  });

// Resume a paused generation (after approval timeout)
const resumeGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    }),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    await requireGenerationAccessInActiveWorkspace(
      context.user.id,
      input.generationId,
      context.workspaceId,
    );
    const success = await generationManager.resumeGeneration(input.generationId, context.user.id);
    return { success };
  });

// Submit approval decision
const submitApproval = protectedProcedure
  .input(
    z.union([
      z.object({
        interruptId: z.string(),
        decision: z.enum(["approve", "deny"]),
        questionAnswers: z.array(z.array(z.string())).optional(),
      }),
      z.object({
        generationId: z.string(),
        toolUseId: z.string(),
        decision: z.enum(["approve", "deny"]),
        questionAnswers: z.array(z.array(z.string())).optional(),
      }),
    ]),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    if ("interruptId" in input) {
      await requireInterruptAccessInActiveWorkspace(
        context.user.id,
        input.interruptId,
        context.workspaceId,
      );
      const success = await generationManager.submitApprovalByInterrupt(
        input.interruptId,
        input.decision,
        context.user.id,
        input.questionAnswers,
      );
      return { success };
    }

    await requireGenerationAccessInActiveWorkspace(
      context.user.id,
      input.generationId,
      context.workspaceId,
    );
    const success = await generationManager.submitApproval(
      input.generationId,
      input.toolUseId,
      input.decision,
      context.user.id,
      input.questionAnswers,
    );
    return { success };
  });

// Submit auth result (after OAuth completes)
const submitAuthResult = protectedProcedure
  .input(
    z.union([
      z.object({
        interruptId: z.string(),
        integration: z.string(),
        success: z.boolean(),
      }),
      z.object({
        generationId: z.string(),
        integration: z.string(),
        success: z.boolean(),
      }),
    ]),
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    if ("interruptId" in input) {
      await requireInterruptAccessInActiveWorkspace(
        context.user.id,
        input.interruptId,
        context.workspaceId,
      );
      const success = await generationManager.submitAuthResultByInterrupt(
        input.interruptId,
        input.integration,
        input.success,
        context.user.id,
      );
      return { success };
    }

    await requireGenerationAccessInActiveWorkspace(
      context.user.id,
      input.generationId,
      context.workspaceId,
    );
    const success = await generationManager.submitAuthResult(
      input.generationId,
      input.integration,
      input.success,
      context.user.id,
    );
    return { success };
  });

// Get generation status (for polling fallback)
const getGenerationStatus = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    }),
  )
  .output(
    z
      .object({
        status: z.enum([
          "running",
          "awaiting_approval",
          "awaiting_auth",
          "paused",
          "completed",
          "cancelled",
          "error",
        ]),
        contentParts: z.array(z.unknown()),
        pendingApproval: z
          .object({
            toolUseId: z.string(),
            toolName: z.string(),
            toolInput: z.unknown(),
            requestedAt: z.string(),
          })
          .nullable(),
        usage: z.object({
          inputTokens: z.number(),
          outputTokens: z.number(),
        }),
      })
      .nullable(),
  )
  .handler(async ({ input, context }) => {
    try {
      await requireGenerationAccessInActiveWorkspace(
        context.user.id,
        input.generationId,
        context.workspaceId,
      );
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }

    const status = await generationManager.getGenerationStatus(input.generationId);
    return status;
  });

// Get active generation for a conversation
const getActiveGeneration = protectedProcedure
  .input(
    z.object({
      conversationId: z.string(),
    }),
  )
  .output(
    z.object({
      generationId: z.string().nullable(),
      startedAt: z.string().nullable(),
      errorMessage: z.string().nullable(),
      pauseReason: z.string().nullable(),
      debugRunDeadlineMs: z.number().int().nullable(),
      contentParts: z.array(z.unknown()).nullable(),
      status: z
        .enum([
          "idle",
          "generating",
          "awaiting_approval",
          "awaiting_auth",
          "paused",
          "complete",
          "error",
        ])
        .nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    let conv;
    try {
      conv = (
        await requireConversationAccessInActiveWorkspace(
          context.user.id,
          input.conversationId,
          context.workspaceId,
        )
      ).conversation;
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") {
        return {
          generationId: null,
          startedAt: null,
          errorMessage: null,
          pauseReason: null,
          debugRunDeadlineMs: null,
          contentParts: null,
          status: null,
        };
      }
      throw error;
    }

    let startedAt: string | null = null;
    let errorMessage: string | null = null;
    let pauseReason: string | null = null;
    let debugRunDeadlineMs: number | null = null;
    let contentParts: unknown[] | null = null;
    let activeGenerationId = conv.currentGenerationId;
    let activeStatus = conv.generationStatus;
    let currentGeneration = activeGenerationId
      ? await db.query.generation.findFirst({
          where: eq(generation.id, activeGenerationId),
          columns: {
            id: true,
            status: true,
            startedAt: true,
            errorMessage: true,
            completionReason: true,
            executionPolicy: true,
            deadlineAt: true,
            contentParts: true,
          },
        })
      : null;

    const durableStateLooksActive =
      typeof activeStatus === "string" && activeConversationStatuses.has(activeStatus);
    if (!durableStateLooksActive || !currentGeneration) {
      const fallbackGeneration = await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, conv.id),
          inArray(generation.status, activeGenerationStatuses),
        ),
        orderBy: [desc(generation.startedAt), desc(generation.id)],
        columns: {
          id: true,
          status: true,
          startedAt: true,
          errorMessage: true,
          completionReason: true,
          executionPolicy: true,
          deadlineAt: true,
          contentParts: true,
        },
      });
      if (isActiveGenerationStatus(fallbackGeneration?.status)) {
        activeGenerationId = fallbackGeneration.id ?? activeGenerationId;
        activeStatus = mapGenerationStatusToConversationStatus(fallbackGeneration.status);
        currentGeneration = fallbackGeneration;
      }
    }

    startedAt = currentGeneration?.startedAt?.toISOString() ?? null;
    errorMessage = currentGeneration?.errorMessage ?? null;
    pauseReason = activeStatus === "paused" ? (currentGeneration?.completionReason ?? null) : null;
    const executionPolicy = currentGeneration?.executionPolicy as
      | { debugRunDeadlineMs?: unknown }
      | null
      | undefined;
    debugRunDeadlineMs =
      typeof executionPolicy?.debugRunDeadlineMs === "number"
        ? executionPolicy.debugRunDeadlineMs
        : activeStatus === "paused" &&
            currentGeneration?.completionReason === "run_deadline" &&
            currentGeneration.startedAt instanceof Date &&
            currentGeneration.deadlineAt instanceof Date
          ? Math.max(
              0,
              currentGeneration.deadlineAt.getTime() - currentGeneration.startedAt.getTime(),
            )
          : null;
    contentParts =
      activeStatus === "paused" &&
      currentGeneration?.completionReason === "run_deadline" &&
      Array.isArray(currentGeneration.contentParts)
        ? currentGeneration.contentParts
        : null;

    return {
      generationId: activeGenerationId,
      startedAt,
      errorMessage,
      pauseReason,
      debugRunDeadlineMs,
      contentParts,
      status: activeStatus,
    };
  });

export const generationRouter = {
  startGeneration,
  enqueueConversationMessage,
  listConversationQueuedMessages,
  removeConversationQueuedMessage,
  updateConversationQueuedMessage,
  subscribeGeneration,
  cancelGeneration,
  resumeGeneration,
  submitApproval,
  submitAuthResult,
  listPlatformSkills,
  detectUserMessageLanguage,
  getGenerationStatus,
  getActiveGeneration,
};
