import { db } from "@cmdclaw/db/client";
import {
  conversation,
  coworker,
  coworkerRun,
  generation,
  message,
  type ContentPart,
  type GenerationExecutionPolicy,
} from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import {
  CUSTOM_SKILL_PREFIX,
  normalizeCoworkerAllowedSkillSlugs,
} from "../../../lib/coworker-tool-policy";
import type { IntegrationType } from "../../oauth/config";
import { createTraceId, logServerEvent } from "../../utils/observability";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "../../../lib/chat-model-defaults";
import { normalizeModelAuthSource } from "../../../lib/provider-auth-source";
import { conversationRuntimeService } from "../conversation-runtime-service";
import {
  resolveCoworkerBuilderContextByConversation,
  type CoworkerBuilderContext,
} from "../coworker-builder-service";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../generation-interrupt-service";
import {
  generationLifecyclePolicy,
  isApprovalExpired,
  isAuthExpired,
  isRunExpired,
  resolveGenerationDeadlineAt,
  type GenerationCompletionReason,
} from "../lifecycle-policy";
import type {
  GenerationContext,
  GenerationDebugInfo,
  GenerationRunMode,
  GenerationStatus,
} from "./types";

export const SESSION_RESET_COMMANDS = new Set(["/new"]);

export type QueuedGenerationRecord = typeof generation.$inferSelect & {
  conversation: typeof conversation.$inferSelect;
};

type LinkedCoworkerRunRecord = Pick<
  typeof coworkerRun.$inferSelect,
  "id" | "coworkerId" | "triggerPayload"
>;

type LinkedCoworkerRecord = Pick<
  typeof coworker.$inferSelect,
  | "allowedIntegrations"
  | "allowedCustomIntegrations"
  | "allowedExecutorSourceIds"
  | "allowedSkillSlugs"
  | "prompt"
  | "promptDo"
  | "promptDont"
  | "autoApprove"
>;

type RuntimeRecord = Awaited<ReturnType<typeof conversationRuntimeService.getRuntime>>;

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

export type QueuedGenerationContextInput =
  | {
      status: "ready";
      traceId: string;
      latestUserMessageContent: string;
      linkedCoworkerRun: LinkedCoworkerRunRecord | null;
      linkedCoworker: LinkedCoworkerRecord | null;
      executionPolicy: GenerationExecutionPolicy;
      linkedCoworkerAllowedSkillSlugs: string[];
      linkedCoworkerPlatformSkillSlugs: string[];
      builderCoworkerContext: CoworkerBuilderContext | null;
      pendingInterrupt: GenerationInterruptRecord | null;
      runtimeRecord: RuntimeRecord;
    }
  | { status: "runtime_stale" };

export type QueuedGenerationContextResult =
  | {
      status: "ready";
      context: GenerationContext;
      pendingInterrupt: GenerationInterruptRecord | null;
    }
  | { status: "runtime_stale" };

export type TurnRunnerContextLoaderDependencies = {
  getExecutionPolicyFromRecord: (
    genRecord: typeof generation.$inferSelect,
    fallbackAutoApprove: boolean,
  ) => GenerationExecutionPolicy;
};

export class TurnRunnerContextLoader {
  constructor(private readonly dependencies: TurnRunnerContextLoaderDependencies) {}

  async loadQueuedGenerationContext(
    genRecord: QueuedGenerationRecord,
  ): Promise<QueuedGenerationContextResult> {
    const loaded = await this.loadQueuedGenerationContextInput(genRecord);
    if (loaded.status === "runtime_stale") {
      return loaded;
    }

    const ctx: GenerationContext = {
      id: genRecord.id,
      traceId: loaded.traceId,
      conversationId: genRecord.conversationId,
      userId: genRecord.conversation.userId!,
      workspaceId: genRecord.conversation.workspaceId ?? null,
      status: genRecord.status as GenerationStatus,
      executionPolicy: loaded.executionPolicy,
      deadlineAt: resolveGenerationDeadlineAt({
        startedAt: genRecord.startedAt,
        deadlineAt: genRecord.deadlineAt,
      }),
      remainingRunMs:
        genRecord.remainingRunMs && genRecord.remainingRunMs > 0
          ? genRecord.remainingRunMs
          : generationLifecyclePolicy.runDeadlineMs,
      approvalHotWaitMs: resolveApprovalHotWaitMs(loaded.executionPolicy.debugApprovalHotWaitMs),
      suspendedAt: genRecord.suspendedAt ?? null,
      resumeInterruptId: genRecord.resumeInterruptId ?? null,
      lastRuntimeProgressAt: genRecord.lastRuntimeProgressAt ?? genRecord.startedAt,
      recoveryAttempts: genRecord.recoveryAttempts ?? 0,
      completionReason: (genRecord.completionReason as GenerationCompletionReason | null) ?? null,
      debugInfo: (genRecord.debugInfo as GenerationDebugInfo | null) ?? undefined,
      contentParts: (genRecord.contentParts as ContentPart[] | null) ?? [],
      assistantContent: "",
      abortController: new AbortController(),
      pendingApproval: null,
      pendingAuth: null,
      usage: {
        inputTokens: genRecord.inputTokens,
        outputTokens: genRecord.outputTokens,
        totalCostUsd: 0,
      },
      startedAt: genRecord.startedAt,
      lastSaveAt: new Date(),
      isNewConversation: false,
      model: genRecord.conversation.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL,
      authSource: normalizeModelAuthSource({
        model: genRecord.conversation.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL,
        authSource: genRecord.conversation.authSource,
      }),
      userMessageContent:
        loaded.executionPolicy.queuedUserMessageContent ?? loaded.latestUserMessageContent,
      attachments: loaded.executionPolicy.queuedFileAttachments,
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      runtimeTools: new Map(),
      backendType: "runtime",
      sandboxProviderOverride: loaded.executionPolicy.sandboxProvider,
      coworkerId: loaded.linkedCoworkerRun?.coworkerId,
      coworkerRunId: loaded.linkedCoworkerRun?.id,
      allowedIntegrations: this.resolveAllowedIntegrations({
        executionPolicy: loaded.executionPolicy,
        linkedCoworker: loaded.linkedCoworker,
      }),
      autoApprove:
        loaded.executionPolicy.autoApprove ??
        loaded.linkedCoworker?.autoApprove ??
        genRecord.conversation.autoApprove,
      allowedCustomIntegrations:
        loaded.executionPolicy.allowedCustomIntegrations ??
        loaded.linkedCoworker?.allowedCustomIntegrations ??
        undefined,
      remoteIntegrationSource: loaded.executionPolicy.remoteIntegrationSource,
      allowedExecutorSourceIds:
        loaded.executionPolicy.allowedExecutorSourceIds ??
        loaded.linkedCoworker?.allowedExecutorSourceIds ??
        undefined,
      allowedSkillSlugs:
        loaded.executionPolicy.allowedSkillSlugs ?? loaded.linkedCoworkerAllowedSkillSlugs ?? undefined,
      coworkerPrompt: undefined,
      coworkerPromptDo: undefined,
      coworkerPromptDont: undefined,
      triggerPayload: undefined,
      builderCoworkerContext: loaded.builderCoworkerContext,
      selectedPlatformSkillSlugs:
        loaded.executionPolicy.selectedPlatformSkillSlugs ??
        (loaded.linkedCoworkerPlatformSkillSlugs.length > 0
          ? loaded.linkedCoworkerPlatformSkillSlugs
          : undefined),
      userStagedFilePaths: new Set(),
      uploadedSandboxFileIds: new Set(),
      runtimeCallbackToken: loaded.runtimeRecord?.callbackToken ?? undefined,
      runtimeId: loaded.runtimeRecord?.id ?? genRecord.runtimeId ?? undefined,
      runtimeTurnSeq: loaded.pendingInterrupt?.turnSeq ?? loaded.runtimeRecord?.activeTurnSeq,
      sandboxId: loaded.runtimeRecord?.sandboxId ?? undefined,
      sessionId: loaded.runtimeRecord?.sessionId ?? undefined,
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
      phaseMarks: {},
      phaseTimeline: [],
      streamSequence: 0,
      streamPublishedCount: 0,
      streamDeliveredCount: 0,
    };
    ctx.currentInterruptId = loaded.pendingInterrupt?.id;

    return {
      status: "ready",
      context: ctx,
      pendingInterrupt: loaded.pendingInterrupt,
    };
  }

  async loadQueuedGenerationContextInput(
    genRecord: QueuedGenerationRecord,
  ): Promise<QueuedGenerationContextInput> {
    const latestUserMessage = await db.query.message.findFirst({
      where: and(eq(message.conversationId, genRecord.conversationId), eq(message.role, "user")),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      columns: { content: true },
    });
    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, genRecord.id),
      columns: { id: true, coworkerId: true, triggerPayload: true },
    });
    const linkedCoworker = linkedCoworkerRun
      ? await db.query.coworker.findFirst({
          where: eq(coworker.id, linkedCoworkerRun.coworkerId),
          columns: {
            allowedIntegrations: true,
            allowedCustomIntegrations: true,
            allowedExecutorSourceIds: true,
            allowedSkillSlugs: true,
            prompt: true,
            promptDo: true,
            promptDont: true,
            autoApprove: true,
          },
        })
      : null;
    const executionPolicy = this.dependencies.getExecutionPolicyFromRecord(
      genRecord,
      linkedCoworker?.autoApprove ?? genRecord.conversation.autoApprove,
    );
    const linkedCoworkerAllowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(
      linkedCoworker?.allowedSkillSlugs,
    );
    const linkedCoworkerPlatformSkillSlugs = linkedCoworkerAllowedSkillSlugs.filter(
      (entry) => !entry.startsWith(CUSTOM_SKILL_PREFIX),
    );
    const builderCoworkerContext =
      genRecord.conversation.type === "coworker"
        ? await resolveCoworkerBuilderContextByConversation({
          database: db,
          userId: genRecord.conversation.userId!,
          conversationId: genRecord.conversationId,
        })
        : null;
    const pendingInterrupt = await generationInterruptService.getPendingInterruptForGeneration(
      genRecord.id,
    );
    const runtimeRecord = genRecord.runtimeId
      ? await conversationRuntimeService.getRuntime(genRecord.runtimeId)
      : await conversationRuntimeService.getRuntimeForConversation(genRecord.conversationId);

    if (
      genRecord.runtimeId &&
      (!runtimeRecord ||
        runtimeRecord.status !== "active" ||
        runtimeRecord.activeGenerationId !== genRecord.id)
    ) {
      logServerEvent(
        "warn",
        "QUEUED_GENERATION_RUNTIME_STALE",
        {
          generationId: genRecord.id,
          runtimeId: genRecord.runtimeId,
          runtimeStatus: runtimeRecord?.status ?? null,
          runtimeActiveGenerationId: runtimeRecord?.activeGenerationId ?? null,
        },
        {
          source: "generation-manager",
          generationId: genRecord.id,
          conversationId: genRecord.conversationId,
          userId: genRecord.conversation.userId ?? undefined,
        },
      );
      return { status: "runtime_stale" };
    }

    return {
      status: "ready",
      traceId: genRecord.traceId ?? createTraceId(),
      latestUserMessageContent: latestUserMessage?.content ?? "",
      linkedCoworkerRun: linkedCoworkerRun ?? null,
      linkedCoworker: linkedCoworker ?? null,
      executionPolicy,
      linkedCoworkerAllowedSkillSlugs,
      linkedCoworkerPlatformSkillSlugs,
      builderCoworkerContext,
      pendingInterrupt,
      runtimeRecord,
    };
  }

  resolveAllowedIntegrations(input: {
    executionPolicy: GenerationExecutionPolicy;
    linkedCoworker: LinkedCoworkerRecord | null;
  }): IntegrationType[] | undefined {
    return (
      (input.executionPolicy.allowedIntegrations as IntegrationType[] | undefined) ??
      (input.linkedCoworker?.allowedIntegrations as IntegrationType[] | null | undefined) ??
      undefined
    );
  }
}

export type TurnRunnerDependencies = {
  activeGenerations: Map<string, GenerationContext>;
  contextLoader: TurnRunnerContextLoader;
  acquireGenerationLease(generationId: string): Promise<string | null>;
  renewGenerationLease(generationId: string, token: string): Promise<void>;
  releaseGenerationLease(generationId: string, token: string): Promise<void>;
  failQueuedRunBeforeContext(input: {
    generationId: string;
    message: string;
  }): Promise<void>;
  markPhase(ctx: GenerationContext, phase: string): void;
  setCompletionReason(ctx: GenerationContext, reason: GenerationCompletionReason): void;
  finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "error" | "cancelled",
  ): Promise<void>;
  hydrateStreamSequence(ctx: GenerationContext): Promise<void>;
  handleSessionReset(ctx: GenerationContext): Promise<void>;
  refreshCancellationSignal(
    ctx: GenerationContext,
    options?: { force?: boolean },
  ): Promise<boolean>;
  waitForSandboxSlotLease(
    ctx: GenerationContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued">;
  releaseSandboxSlotLease(ctx: GenerationContext): Promise<void>;
  enqueueGenerationTimeout(
    generationId: string,
    kind: "approval" | "auth",
    expiresAtIso: string,
  ): Promise<void>;
  processGenerationTimeout(generationId: string, kind: "approval" | "auth"): Promise<void>;
  runSuspendedInterruptResume(ctx: GenerationContext): Promise<void>;
  runRecoveryReattach(ctx: GenerationContext): Promise<void>;
  runRuntimeGeneration(ctx: GenerationContext): Promise<void>;
};

export class TurnRunner {
  constructor(private readonly deps: TurnRunnerDependencies) {}

  async runQueuedGeneration(
    generationId: string,
    runMode: GenerationRunMode = "normal_run",
  ): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return;
    }
    if (!genRecord.conversation.userId) {
      return;
    }

    let leaseToken: string | null = null;
    try {
      leaseToken = await this.deps.acquireGenerationLease(generationId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.deps.failQueuedRunBeforeContext({
        generationId,
        message: messageText,
      });
      return;
    }
    if (!leaseToken) {
      return;
    }

    try {
      const rehydrated = await this.deps.contextLoader.loadQueuedGenerationContext(genRecord);
      if (rehydrated.status === "runtime_stale") {
        return;
      }
      const ctx = rehydrated.context;
      const { pendingInterrupt } = rehydrated;

      logServerEvent(
        "info",
        "QUEUED_GENERATION_CONTEXT_REHYDRATED",
        {
          rehydratedAttachmentsCount: ctx.attachments?.length ?? 0,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );

      if (
        (ctx.status === "awaiting_approval" || ctx.status === "awaiting_auth") &&
        pendingInterrupt &&
        !ctx.resumeInterruptId
      ) {
        return;
      }

      this.deps.activeGenerations.set(genRecord.id, ctx);
      this.deps.markPhase(ctx, "generation_started");
      if (
        isRunExpired(
          {
            startedAt: ctx.startedAt,
            deadlineAt: ctx.deadlineAt,
          },
          new Date(),
        )
      ) {
        this.deps.setCompletionReason(ctx, "run_deadline");
        ctx.errorMessage =
          "We stopped this run because it exceeded the 15 minute wall-clock limit.";
        await this.deps.finishGeneration(ctx, "error");
        return;
      }
      if (ctx.status === "awaiting_approval" && pendingInterrupt?.expiresAt) {
        await this.deps.enqueueGenerationTimeout(
          ctx.id,
          "approval",
          pendingInterrupt.expiresAt.toISOString(),
        );
      }
      if (ctx.status === "awaiting_auth" && pendingInterrupt?.expiresAt) {
        await this.deps.enqueueGenerationTimeout(
          ctx.id,
          "auth",
          pendingInterrupt.expiresAt.toISOString(),
        );
      }
      if (
        ctx.status === "awaiting_approval" &&
        pendingInterrupt &&
        isApprovalExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          new Date(),
        )
      ) {
        await this.deps.processGenerationTimeout(ctx.id, "approval");
        return;
      }
      if (
        ctx.status === "awaiting_auth" &&
        pendingInterrupt &&
        isAuthExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          new Date(),
        )
      ) {
        await this.deps.processGenerationTimeout(ctx.id, "auth");
        return;
      }

      await this.runGeneration(ctx, runMode, leaseToken);
    } finally {
      await this.deps.releaseGenerationLease(generationId, leaseToken).catch((err) => {
        console.error(
          `[GenerationManager] Failed to release queued-generation lease for ${generationId}:`,
          err,
        );
      });
    }
  }

  async runGeneration(
    ctx: GenerationContext,
    runMode: GenerationRunMode = "normal_run",
    leaseTokenOverride?: string | null,
  ): Promise<void> {
    const ownsLease = !leaseTokenOverride;
    let leaseToken: string | null = leaseTokenOverride ?? null;
    if (!leaseToken) {
      try {
        leaseToken = await this.deps.acquireGenerationLease(ctx.id);
      } catch (error) {
        ctx.errorMessage = error instanceof Error ? error.message : String(error);
        await this.deps.finishGeneration(ctx, "error");
        return;
      }
      if (!leaseToken) {
        return;
      }
    }

    const leaseRenewTimer = setInterval(() => {
      void this.deps.renewGenerationLease(ctx.id, leaseToken).catch((err) => {
        console.error(`[GenerationManager] Failed to renew lease for generation ${ctx.id}:`, err);
      });
    }, 30_000);

    try {
      const latestGenerationState = await db.query.generation.findFirst({
        where: eq(generation.id, ctx.id),
        columns: {
          status: true,
          messageId: true,
          completedAt: true,
        },
      });
      if (latestGenerationState) {
        if (
          latestGenerationState.completedAt ||
          latestGenerationState.messageId ||
          latestGenerationState.status === "completed" ||
          latestGenerationState.status === "cancelled" ||
          latestGenerationState.status === "error"
        ) {
          return;
        }
      }
      await this.deps.hydrateStreamSequence(ctx);
      if (
        !ctx.resumeInterruptId &&
        isRunExpired(
          {
            startedAt: ctx.startedAt,
            deadlineAt: ctx.deadlineAt,
          },
          new Date(),
        )
      ) {
        this.deps.setCompletionReason(ctx, "run_deadline");
        ctx.errorMessage =
          "We stopped this run because it exceeded the 15 minute wall-clock limit.";
        await this.deps.finishGeneration(ctx, "error");
        return;
      }
      const trimmed = ctx.userMessageContent.trim();
      if (SESSION_RESET_COMMANDS.has(trimmed)) {
        await this.deps.handleSessionReset(ctx);
        return;
      }
      if (await this.deps.refreshCancellationSignal(ctx, { force: true })) {
        await this.deps.finishGeneration(ctx, "cancelled");
        return;
      }
      const slotStatus = await this.deps.waitForSandboxSlotLease(ctx, {
        allowWorkerRequeue: true,
        runMode,
      });
      if (slotStatus === "requeued") {
        return;
      }
      if (ctx.resumeInterruptId) {
        return this.deps.runSuspendedInterruptResume(ctx);
      }
      return runMode === "recovery_reattach"
        ? this.deps.runRecoveryReattach(ctx)
        : this.deps.runRuntimeGeneration(ctx);
    } finally {
      clearInterval(leaseRenewTimer);
      await this.deps.releaseSandboxSlotLease(ctx).catch((err) => {
        console.error(
          `[GenerationManager] Failed to release sandbox slot for generation ${ctx.id}:`,
          err,
        );
      });
      if (ownsLease && leaseToken) {
        await this.deps.releaseGenerationLease(ctx.id, leaseToken).catch((err) => {
          console.error(
            `[GenerationManager] Failed to release lease for generation ${ctx.id}:`,
            err,
          );
        });
      }
    }
  }
}
