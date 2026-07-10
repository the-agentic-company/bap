import { GENERATION_ERROR_PHASES } from "@bap/core/lib/generation-errors";
import { parseModelReference } from "@bap/core/lib/model-reference";
import { PROVIDER_AUTH_SOURCES } from "@bap/core/lib/provider-auth-source";
import { generationManager } from "@bap/core/server/services/generation-manager";
import { BAP_MCP_SCOPE } from "@bap/core/server/sandbox/platform-mcp-server";
import { evaluateSpawnRequest } from "@bap/core/server/services/generation/spawn-depth";
import { isGenerationStartError } from "@bap/core/server/services/generation-start-error";
import { startPendingCoworkerRun } from "@bap/core/server/services/coworker-service";
import { generationLifecyclePolicy } from "@bap/core/server/services/lifecycle-policy";
import { listSelectablePlatformSkills } from "@bap/core/server/services/platform-skill-service";
import {
  createTraceId,
  emitCanonicalServiceEvent,
  logger,
} from "@bap/core/server/utils/observability";
import { db } from "@bap/db/client";
import { generation, coworkerRun } from "@bap/db/schema";
import { eventIterator, ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { detectMessageLanguage } from "@/server/utils/detect-message-language";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";
import { generationEventSchema } from "./generation-event-schema";
import {
  requireConversationAccessInActiveWorkspace,
  requireGenerationAccessInActiveWorkspace,
  requireInterruptAccessInActiveWorkspace,
} from "./generation-access";

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
const runnerFailureReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_.:-]+$/i, "Reason must be a compact machine-readable code");
const fileAttachmentSchema = z.object({
  fileAssetId: z.string().min(1),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

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
        fileAttachments: z.array(fileAttachmentSchema).optional(),
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
      const activeWorkspaceId = input.conversationId
        ? (
            await requireConversationAccessInActiveWorkspace(
              context.user.id,
              input.conversationId,
              context.workspaceId,
            )
          ).workspaceId
        : (await requireActiveWorkspaceAccess(context.user.id, context.workspaceId)).workspace.id;
      // Runtime-Originated Runs (ADR-0013): calls from the platform MCP server
      // carry a Spawn Depth; refuse beyond the platform maximum. Evaluated before
      // any run is started, including the pending-coworker path below.
      let spawnDepth: number | undefined;
      if (context.authSource === "managed_mcp" && context.runtimeMcp) {
        const spawnEvaluation = evaluateSpawnRequest(context.runtimeMcp.spawnDepth);
        if (!spawnEvaluation.allowed) {
          throw new ORPCError("BAD_REQUEST", { message: spawnEvaluation.message });
        }
        spawnDepth = spawnEvaluation.childSpawnDepth;
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
          // The pending run keeps the Spawn Depth it was created with; the guard
          // above already refused a max-depth runtime caller from resuming it.
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
        workspaceId: activeWorkspaceId,
        spawnDepth,
      });

      const successLogContext = {
        ...logContext,
        generationId: result.generationId,
        conversationId: result.conversationId,
        traceId: result.traceId,
      };
      emitCanonicalServiceEvent({
        eventName: "bap.generation.start_rpc",
        operationName: "generation.start_rpc",
        eventId: `rpc:generation.start:${result.generationId}:${startedAt}`,
        outcome: "success",
        context: successLogContext,
        attributes: {
          "rpc.system": "orpc",
          "rpc.method": "generation.startGeneration",
          "http.route": "/api/rpc/generation/startGeneration",
          "bap.generation.id": result.generationId,
          "bap.conversation.id": result.conversationId,
          "bap.user.id": context.user.id,
          "bap.generation.request.elapsed_ms": Date.now() - startedAt,
          "bap.model.provider": input.model ? parseModelReference(input.model).providerID : null,
          "bap.sandbox.provider": input.sandboxProvider ?? "default",
          "bap.generation.file_attachment_count": input.fileAttachments?.length ?? 0,
          "bap.generation.selected_platform_skill_count":
            input.selectedPlatformSkillSlugs?.length ?? 0,
          "bap.workspace.id": activeWorkspaceId,
          "bap.auth.source": context.authSource,
          "bap.spawn.depth": spawnDepth ?? 0,
        },
      });
      logger.info({
        event: "RPC_START_GENERATION_OK",
        ...successLogContext,
        elapsedMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      emitCanonicalServiceEvent({
        eventName: "bap.generation.start_rpc",
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
          "bap.conversation.id": input.conversationId,
          "bap.user.id": context.user.id,
          "bap.generation.request.elapsed_ms": Date.now() - startedAt,
          "bap.failure.phase": GENERATION_ERROR_PHASES.START_RPC,
          "bap.error.normalized_code": normalizeRpcErrorCode(error),
          "bap.model.provider": input.model ? parseModelReference(input.model).providerID : null,
          "bap.sandbox.provider": input.sandboxProvider ?? "default",
          "bap.generation.file_attachment_count": input.fileAttachments?.length ?? 0,
          "bap.generation.selected_platform_skill_count":
            input.selectedPlatformSkillSlugs?.length ?? 0,
        },
      });
      logger.error({
        event: "RPC_START_GENERATION_FAILED",
        ...logContext,
        elapsedMs: Date.now() - startedAt,
        conversationId: input.conversationId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        generationErrorCode: isGenerationStartError(error) ? error.generationErrorCode : null,
      });
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

const markCurrentCoworkerRunFailed = protectedProcedure
  .input(
    z.object({
      reason: runnerFailureReasonSchema,
      message: z.string().trim().min(1).max(2_000).optional(),
    }),
  )
  .output(
    z.object({
      status: z.literal("failed"),
      generationId: z.string(),
      conversationId: z.string(),
      coworkerRunId: z.string(),
      active: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const runtimeMcp = context.runtimeMcp;
    if (
      context.authSource !== "managed_mcp" ||
      !runtimeMcp ||
      runtimeMcp.surface !== "coworker_runner"
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only coworker runner MCP calls can mark a coworker run as failed.",
      });
    }

    if (!runtimeMcp.scopes.includes(BAP_MCP_SCOPE.coworkerRunFail)) {
      throw new ORPCError("FORBIDDEN", {
        message: "This runner token cannot mark coworker runs as failed.",
      });
    }

    const { generationId, conversationId, coworkerRunId } = runtimeMcp;
    if (!generationId || !conversationId || !coworkerRunId) {
      throw new ORPCError("FORBIDDEN", {
        message: "Runner token is missing the bound generation or coworker run.",
      });
    }

    const result = await generationManager.failCurrentCoworkerRunFromRuntime({
      generationId,
      conversationId,
      coworkerRunId,
      userId: context.user.id,
      workspaceId: runtimeMcp.workspaceId,
      reason: input.reason,
      message: input.message,
    });

    if (!result.failed) {
      throw new ORPCError("CONFLICT", {
        message: "The bound coworker run could not be marked as failed.",
      });
    }

    emitCanonicalServiceEvent({
      eventName: "bap.generation.runner_declared_failure",
      operationName: "generation.runner_declared_failure",
      eventId: `rpc:generation.runner_declared_failure:${generationId}:${Date.now()}`,
      outcome: "success",
      context: {
        userId: context.user.id,
        generationId,
        conversationId,
      },
      attributes: {
        "rpc.system": "orpc",
        "rpc.method": "generation.markCurrentCoworkerRunFailed",
        "http.route": "/api/rpc/generation/markCurrentCoworkerRunFailed",
        "bap.generation.id": generationId,
        "bap.conversation.id": conversationId,
        "bap.coworker_run.id": coworkerRunId,
        "bap.user.id": context.user.id,
        "bap.workspace.id": runtimeMcp.workspaceId,
        "bap.failure.kind": "runner_declared_failure",
        "bap.failure.reason": input.reason,
        "bap.generation.runner_failure.active": result.active,
      },
    });

    return {
      status: "failed" as const,
      generationId,
      conversationId,
      coworkerRunId,
      active: result.active,
    };
  });

const enqueueConversationMessage = protectedProcedure
  .input(
    z.object({
      conversationId: z.string(),
      content: z.string().min(1).max(100000),
      selectedPlatformSkillSlugs: z.array(z.string().max(128)).max(50).optional(),
      fileAttachments: z.array(fileAttachmentSchema).optional(),
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
        fileAttachments: z.array(fileAttachmentSchema).optional(),
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
      fileAttachments: z.array(fileAttachmentSchema).optional(),
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
    logger.info({
      event: "RPC_SUBSCRIBE_GENERATION_OPENED",
      ...logContext,
      ...generationManager.getStreamCountersSnapshot(),
    });

    const stream = generationManager.subscribeToGeneration(input.generationId, context.user.id, {
      cursor: input.cursor,
    });

    try {
      for await (const event of stream) {
        yield event;
      }
    } finally {
      emitCanonicalServiceEvent({
        eventName: "bap.generation.subscribe_rpc",
        operationName: "generation.subscribe_rpc",
        eventId: `rpc:generation.subscribe:${input.generationId}:${streamId}`,
        outcome: "success",
        context: logContext,
        attributes: {
          "rpc.system": "orpc",
          "rpc.method": "generation.subscribeGeneration",
          "http.route": "/api/rpc/generation/subscribeGeneration",
          "bap.generation.id": input.generationId,
          "bap.conversation.id": access.generation.conversationId,
          "bap.user.id": context.user.id,
          "bap.generation.subscribe.state": "closed",
          "bap.generation.subscribe.elapsed_ms": Date.now() - openedAt,
          "bap.generation.subscribe.has_cursor": Boolean(input.cursor),
          ...generationManager.getStreamCountersSnapshot(),
        },
      });
      logger.info({
        event: "RPC_SUBSCRIBE_GENERATION_CLOSED",
        ...logContext,
        elapsedMs: Date.now() - openedAt,
        ...generationManager.getStreamCountersSnapshot(),
      });
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

    const isRunnerDeclaredFailure =
      currentGeneration?.completionReason === "runner_declared_failure";
    if (isRunnerDeclaredFailure && activeStatus === "error") {
      activeStatus = "complete";
    }

    startedAt = currentGeneration?.startedAt?.toISOString() ?? null;
    errorMessage = isRunnerDeclaredFailure ? null : (currentGeneration?.errorMessage ?? null);
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
  markCurrentCoworkerRunFailed,
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
