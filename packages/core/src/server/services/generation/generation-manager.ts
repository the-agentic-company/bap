import { db } from "@bap/db/client";
import { conversation, generation, message, messageAttachment } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import type { IntegrationType } from "../../oauth/config";
import type { RuntimeToolRef } from "../../runtime/runtime-driver";
import { SandboxSlotLeaseCoordinator } from "../../execution/sandbox-slot-lease";
import type { SandboxBackend } from "../../sandbox/types";
import {
  buildQueueJobId,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  getQueue,
} from "../../queues/queue-client";
import { getLatestGenerationStreamEnvelope } from "../../redis/generation-event-bus";
import { logger } from "../../utils/observability";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../generation-interrupt-service";
import { writeSessionTranscriptFromConversation } from "../memory-service";
import { clearConversationSessionSnapshot } from "../runtime-session-snapshot-service";
import { SESSION_BOUNDARY_PREFIX } from "../session-constants";
import { conversationRuntimeService } from "../conversation-runtime-service";
import { GenerationControl, getExecutionPolicyFromRecord } from "./control/generation-control";
import { GenerationLifecycleStore } from "./core/lifecycle-store";
import { GenerationTurnFinalizer } from "./core/turn-finalizer";
import { GenerationTurnSuspender } from "./core/turn-suspension";
import { DecisionFlow, InterruptParking } from "./decisions/decision-flow";
import {
  GenerationMaintenance,
  type GenerationTimeoutKind,
} from "./maintenance/generation-maintenance";
import {
  ConversationTurnQueue,
  type ConversationQueuedMessageRecord,
  type UserFileAttachment,
} from "./queue/conversation-turn-queue";
import { GenerationRunQueue } from "./queue/generation-run-queue";
import { importIntegrationSkillDraftsFromSandbox } from "./skills/integration-skill-drafts";
import { GenerationEventLog } from "./streams/generation-event-log";
import { GenerationContextState } from "./runtime/generation-context-state";
import { GenerationResumeRunner } from "./runtime/generation-resume-runner";
import {
  RuntimeGenerationDriver,
  type RuntimeRecoveryReattachOptions,
} from "../../runtime/runtime-generation-driver";
import { createRuntimeDriver } from "../../runtime/runtime-driver-factory";
import {
  TurnIntake,
  type StartCoworkerGenerationInput,
  type StartGenerationInput,
} from "./turn-intake";
import { SESSION_RESET_COMMANDS, TurnRunner, TurnRunnerContextLoader } from "./turn-runner";
import type {
  GenerationContext,
  GenerationEvent,
  GenerationRunMode,
  GenerationStreamEvent,
} from "./types";
import { generationLifecyclePolicy, type GenerationCompletionReason } from "../lifecycle-policy";

export type { GenerationEvent };

const CANCELLATION_POLL_INTERVAL_MS = 1000;
const AGENT_PREPARING_TIMEOUT_MS = generationLifecyclePolicy.bootstrapTimeoutMs;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = extractStructuredErrorMessage(error);
    if (message) {
      return message;
    }
    const json = safeJsonStringify(error);
    if (json) {
      return json;
    }
  }
  return String(error);
}

function extractStructuredErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  const nestedCandidates = [record.error, record.data, record.details];
  for (const candidate of nestedCandidates) {
    const nested = extractStructuredErrorMessage(candidate);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

class GenerationManager {
  private activeGenerations = new Map<string, GenerationContext>();
  private readonly lifecycleStore = new GenerationLifecycleStore();
  private readonly generationRunQueue = new GenerationRunQueue({
    activeGenerations: this.activeGenerations,
    lifecycleStore: this.lifecycleStore,
    runQueuedGeneration: (generationId, runMode) => this.runQueuedGeneration(generationId, runMode),
    formatErrorMessage,
  });
  private readonly generationControl = new GenerationControl({
    activeGenerations: this.activeGenerations,
    lifecycleStore: this.lifecycleStore,
    releaseSandboxSlotLease: (ctx) => this.releaseSandboxSlotLease(ctx),
  });
  private readonly contextState = new GenerationContextState({
    lifecycleStore: this.lifecycleStore,
    scheduleSave: (ctx) => this.scheduleSave(ctx),
    formatErrorMessage,
  });
  private readonly interruptParking = new InterruptParking({
    activeGenerations: this.activeGenerations,
    getApprovalHotWaitMs: (ctx) => this.contextState.getApprovalHotWaitMs(ctx),
    broadcast: (ctx, event) => this.broadcast(ctx, event),
    suspendGenerationForInterrupt: (ctx, interrupt) =>
      this.turnSuspender.suspendGenerationForInterrupt(ctx, interrupt),
    getPluginApprovalStatus: (generationId, interruptId) =>
      this.getPluginApprovalStatus(generationId, interruptId),
  });
  private readonly turnFinalizer = new GenerationTurnFinalizer({
    lifecycleStore: this.lifecycleStore,
    markPhase: (ctx, phase) => this.contextState.markPhase(ctx, phase),
    broadcast: (ctx, event) => this.broadcast(ctx, event),
    stopExternalInterruptPolling: (ctx) => this.interruptParking.stopExternalInterruptPolling(ctx),
    releaseSandboxSlotLease: (ctx) => this.releaseSandboxSlotLease(ctx),
    evictActiveGenerationContext: (generationId) => this.evictActiveGenerationContext(generationId),
    enqueueConversationQueuedMessageProcess: (conversationId) =>
      this.conversationTurnQueue.enqueueConversationQueuedMessageProcess(conversationId),
    saveSessionSnapshotIfPossible: (ctx, reason) => this.saveSessionSnapshotIfPossible(ctx, reason),
  });
  private readonly turnSuspender = new GenerationTurnSuspender({
    lifecycleStore: this.lifecycleStore,
    refreshRemainingRunBudget: (ctx, now) => this.contextState.refreshRemainingRunBudget(ctx, now),
    setCompletionReason: (ctx, reason) => this.contextState.setCompletionReason(ctx, reason),
    stopExternalInterruptPolling: (ctx) => this.interruptParking.stopExternalInterruptPolling(ctx),
    saveProgress: (ctx) => this.saveProgress(ctx),
    releaseSandboxSlotLease: (ctx) => this.releaseSandboxSlotLease(ctx),
    evictActiveGenerationContext: (generationId) => this.evictActiveGenerationContext(generationId),
    broadcast: (ctx, event) => this.broadcast(ctx, event),
  });
  private readonly turnIntake = new TurnIntake({
    lifecycleStore: this.lifecycleStore,
    persistMessageAttachments: (params) => this.persistMessageAttachments(params),
    enqueuePreparingStuckCheck: (generationId) => this.enqueuePreparingStuckCheck(generationId),
    enqueueGenerationRun: (generationId, runType, options) =>
      this.generationRunQueue.enqueueGenerationRun(generationId, runType, options),
  });
  private readonly turnRunnerContextLoader = new TurnRunnerContextLoader({
    getExecutionPolicyFromRecord: (genRecord, fallbackAutoApprove) =>
      getExecutionPolicyFromRecord(genRecord, fallbackAutoApprove),
  });
  private readonly turnRunner = new TurnRunner({
    activeGenerations: this.activeGenerations,
    contextLoader: this.turnRunnerContextLoader,
    acquireGenerationLease: (generationId) =>
      this.generationRunQueue.acquireGenerationLease(generationId),
    renewGenerationLease: (generationId, token) =>
      this.generationRunQueue.renewGenerationLease(generationId, token),
    releaseGenerationLease: (generationId, token) =>
      this.generationRunQueue.releaseGenerationLease(generationId, token),
    failQueuedRunBeforeContext: (input) => this.lifecycleStore.failQueuedRunBeforeContext(input),
    markPhase: (ctx, phase) => this.contextState.markPhase(ctx, phase),
    setCompletionReason: (ctx, reason) => this.contextState.setCompletionReason(ctx, reason),
    finishGeneration: (ctx, status) => this.finishGeneration(ctx, status),
    hydrateStreamSequence: (ctx) => this.hydrateStreamSequence(ctx),
    handleSessionReset: (ctx) => this.handleSessionReset(ctx),
    refreshCancellationSignal: (ctx, options) => this.refreshCancellationSignal(ctx, options),
    waitForSandboxSlotLease: (ctx, options) => this.waitForSandboxSlotLease(ctx, options),
    releaseSandboxSlotLease: (ctx) => this.releaseSandboxSlotLease(ctx),
    enqueueGenerationTimeout: (generationId, kind, expiresAtIso) =>
      this.enqueueGenerationTimeout(generationId, kind, expiresAtIso),
    processGenerationTimeout: (generationId, kind) =>
      this.processGenerationTimeout(generationId, kind),
    runSuspendedInterruptResume: (ctx) => this.resumeRunner.runSuspendedInterruptResume(ctx),
    runRecoveryReattach: (ctx) => this.runRecoveryReattach(ctx),
    runRuntimeGeneration: (ctx) => this.runRuntimeGeneration(ctx),
  });
  private readonly sandboxSlotLeaseCoordinator = new SandboxSlotLeaseCoordinator({
    getGenerationRunType: (ctx) => this.generationRunQueue.getGenerationRunType(ctx),
    enqueueGenerationRun: (generationId, runType, options) =>
      this.generationRunQueue.enqueueGenerationRun(generationId, runType, options),
    evictActiveGenerationContext: (generationId) => this.evictActiveGenerationContext(generationId),
    logRenewalError: (generationId, error) =>
      console.error(
        `[GenerationManager] Failed to renew sandbox slot for generation ${generationId}:`,
        error,
      ),
  });
  private readonly decisionFlow: DecisionFlow = new DecisionFlow({
    lifecycleStore: this.lifecycleStore,
    getActiveRuntimeContext: (generationId) => this.activeGenerations.get(generationId),
    getExecutionPolicy: (genRecord, defaultAutoApprove) =>
      getExecutionPolicyFromRecord(genRecord, defaultAutoApprove),
    onPendingInterrupt: async ({ generationId, conversationId, interrupt, event, kind }) => {
      const activeCtx = this.activeGenerations.get(generationId);
      if (activeCtx) {
        activeCtx.status = kind === "auth" ? "awaiting_auth" : "awaiting_approval";
        activeCtx.currentInterruptId = interrupt.id;
        this.broadcast(activeCtx, event);
        // Snapshot only when the generation is actually parked. Exporting the full
        // runtime session inline here duplicates that work and can blow up the dev
        // server heap for large sessions while this request is still open.
        this.interruptParking.scheduleApprovalPark(activeCtx, interrupt);
      } else {
        await this.publishDetachedGenerationStreamEvent({
          generationId,
          conversationId,
          event,
        });
      }
    },
    onPluginApprovalResolved: ({ generationId, interrupt, event }) => {
      const activeCtx = this.activeGenerations.get(generationId);
      if (!activeCtx) {
        return;
      }
      activeCtx.status = "running";
      if (activeCtx.currentInterruptId === interrupt.id) {
        activeCtx.currentInterruptId = undefined;
      }
      this.broadcast(activeCtx, event);
      if (activeCtx.approvalParkTimeoutId) {
        clearTimeout(activeCtx.approvalParkTimeoutId);
        activeCtx.approvalParkTimeoutId = undefined;
      }
    },
    onAuthResolved: ({ generationId, interrupt, event }) => {
      const activeCtx = this.activeGenerations.get(generationId);
      if (!activeCtx) {
        return;
      }
      activeCtx.status = "running";
      if (activeCtx.currentInterruptId === interrupt.id) {
        activeCtx.currentInterruptId = undefined;
      }
      this.broadcast(activeCtx, event);
      if (activeCtx.approvalParkTimeoutId) {
        clearTimeout(activeCtx.approvalParkTimeoutId);
        activeCtx.approvalParkTimeoutId = undefined;
      }
    },
    enqueueGenerationRun: (generationId, runType) =>
      this.generationRunQueue.enqueueGenerationRun(generationId, runType),
    enqueueGenerationTimeout: (generationId, kind, expiresAtIso) =>
      this.enqueueGenerationTimeout(generationId, kind, expiresAtIso),
    enqueueResolvedInterruptResume: (input) =>
      this.generationRunQueue.enqueueResolvedInterruptResume(input),
    enqueueConversationQueuedMessageProcess: (conversationId) =>
      this.conversationTurnQueue.enqueueConversationQueuedMessageProcess(conversationId),
    touchConversationLastUserVisibleAction: (conversationId) =>
      this.generationRunQueue.touchConversationLastUserVisibleAction(conversationId),
    processGenerationTimeout: (generationId, kind) =>
      this.processGenerationTimeout(generationId, kind),
    updateRuntimeToolPart: (runtimeClient, runtimeTool, patch) =>
      this.runtimeCoordinator.updateRuntimeToolPart(runtimeClient, runtimeTool, patch),
  });
  private readonly maintenance = new GenerationMaintenance({
    abortAndEvictActiveGeneration: (generationId) => {
      const ctx = this.activeGenerations.get(generationId);
      if (ctx) {
        ctx.abortController.abort();
      }
      this.evictActiveGenerationContext(generationId);
    },
    hasActiveGeneration: (generationId) => this.activeGenerations.has(generationId),
    expireActiveGenerationTimeout: async (input) => {
      const ctx = this.activeGenerations.get(input.generationId);
      if (!ctx) {
        return;
      }
      this.contextState.setCompletionReason(ctx, input.completionReason);
      ctx.errorMessage = input.message;
      if (input.kind === "approval") {
        await this.handleApprovalTimeout(ctx);
      } else {
        await this.handleAuthTimeout(ctx);
      }
    },
    finalizeDetachedGenerationError: (input) => this.finalizeDetachedGenerationError(input),
    finalizeStaleGenerationsAsError: (input) =>
      this.lifecycleStore.finalizeStaleGenerationsAsError(input),
    finalizeCancelledGenerations: (input) =>
      this.lifecycleStore.finalizeCancelledGenerations(input),
  });
  private readonly eventLog = new GenerationEventLog({
    projectInterruptPendingEvent: (interrupt) => this.projectInterruptPendingEvent(interrupt),
  });
  private readonly runtimeCoordinator: RuntimeGenerationDriver = new RuntimeGenerationDriver({
    runtimeDriver: createRuntimeDriver({
      adapter: "opencode",
      opencode: {
        bootstrapTimeoutMs: AGENT_PREPARING_TIMEOUT_MS,
        contextState: this.contextState,
        decisionFlow: this.decisionFlow,
        interruptParking: this.interruptParking,
        turnFinalizer: this.turnFinalizer,
        refreshCancellationSignal: (ctx, options) => this.refreshCancellationSignal(ctx, options),
        finishGeneration: (ctx, status) => this.finishGeneration(ctx, status),
        setSnapshotRestoreAllowance: (ctx, allowed) =>
          this.setSnapshotRestoreAllowance(ctx, allowed),
        parkGenerationForRunDeadline: (ctx, runtimeClient) =>
          this.parkGenerationForRunDeadline(ctx, runtimeClient),
        awaitPromiseUntilRunDeadline: (ctx, promise) =>
          this.awaitPromiseUntilRunDeadline(ctx, promise),
        scheduleSave: (ctx) => this.scheduleSave(ctx),
        broadcast: (ctx, event) => this.broadcast(ctx, event),
        importIntegrationSkillDraftsFromSandbox: (ctx) =>
          this.importIntegrationSkillDraftsFromSandbox(ctx),
        scheduleRecoveryReattach: (ctx) => this.scheduleRecoveryReattach(ctx),
        recordRecoveryAttempt: (ctx) => this.recordRecoveryAttempt(ctx),
        saveProgress: (ctx) => this.saveProgress(ctx),
        getActiveContext: (generationId) => this.activeGenerations.get(generationId),
      },
    }),
  });
  private readonly resumeRunner = new GenerationResumeRunner({
    lifecycleStore: this.lifecycleStore,
    decisionFlow: this.decisionFlow,
    contextState: this.contextState,
    runRuntimeGeneration: (ctx) => this.runRuntimeGeneration(ctx),
    runRecoveryReattach: (ctx, options) => this.runRecoveryReattach(ctx, options),
    finishGeneration: (ctx, status) => this.finishGeneration(ctx, status),
    saveProgress: (ctx) => this.saveProgress(ctx),
    broadcast: (ctx, event) => this.broadcast(ctx, event),
  });
  private readonly conversationTurnQueue = new ConversationTurnQueue({
    startGeneration: (input) => this.startGeneration(input),
  });
  private async persistMessageAttachments(params: {
    conversationId: string;
    messageId: string;
    attachments?: UserFileAttachment[];
  }): Promise<void> {
    const attachments = params.attachments;
    if (!attachments || attachments.length === 0) {
      return;
    }

    const { uploadToS3, ensureBucket } = await import("../../storage/s3-client");
    await ensureBucket();

    await Promise.all(
      attachments.map(async (attachment) => {
        const base64Data = attachment.dataUrl.split(",")[1] || "";
        const buffer = Buffer.from(base64Data, "base64");
        const sanitizedFilename = attachment.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storageKey = `attachments/${params.conversationId}/${params.messageId}/${Date.now()}-${sanitizedFilename}`;
        await uploadToS3(storageKey, buffer, attachment.mimeType);
        await db.insert(messageAttachment).values({
          messageId: params.messageId,
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: buffer.length,
          storageKey,
        });
      }),
    );
  }

  async enqueueConversationMessage(params: {
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
    replaceExisting?: boolean;
  }): Promise<{ queuedMessageId: string }> {
    return this.conversationTurnQueue.enqueueConversationMessage(params);
  }

  async listConversationQueuedMessages(
    conversationId: string,
    userId: string,
  ): Promise<ConversationQueuedMessageRecord[]> {
    return this.conversationTurnQueue.listConversationQueuedMessages(conversationId, userId);
  }

  async removeConversationQueuedMessage(
    queuedMessageId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    return this.conversationTurnQueue.removeConversationQueuedMessage(
      queuedMessageId,
      conversationId,
      userId,
    );
  }

  async updateConversationQueuedMessage(params: {
    queuedMessageId: string;
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
  }): Promise<boolean> {
    return this.conversationTurnQueue.updateConversationQueuedMessage(params);
  }

  async processConversationQueuedMessages(conversationId: string): Promise<void> {
    await this.conversationTurnQueue.processConversationQueuedMessages(conversationId);
  }

  getStreamCountersSnapshot(): {
    opened: number;
    closed: number;
    timedOut: number;
    deduped: number;
    active: number;
  } {
    return this.eventLog.getCounters();
  }

  private evictActiveGenerationContext(generationId: string): void {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return;
    }

    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
    }
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.interruptParking.stopExternalInterruptPolling(ctx);
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
    }
    if (ctx.sandboxSlotLeaseRenewId) {
      clearInterval(ctx.sandboxSlotLeaseRenewId);
      ctx.sandboxSlotLeaseRenewId = undefined;
    }

    ctx.pendingMessageParts.clear();

    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
    this.activeGenerations.delete(generationId);
  }

  private async recordRecoveryAttempt(ctx: GenerationContext): Promise<void> {
    ctx.recoveryAttempts += 1;
    await this.lifecycleStore.recordRecoveryAttempt({
      generationId: ctx.id,
      recoveryAttempts: ctx.recoveryAttempts,
    });
  }

  private async finalizeDetachedGenerationError(params: {
    generationId: string;
    conversationId: string;
    runtimeId?: string;
    coworkerRunId?: string;
    message: string;
    completionReason: GenerationCompletionReason;
  }): Promise<void> {
    await this.lifecycleStore.finalizeDetachedGenerationError(params);
    await this.publishDetachedGenerationStreamEvent({
      generationId: params.generationId,
      conversationId: params.conversationId,
      event: {
        type: "error",
        message: params.message,
      },
    });
  }

  private async setSnapshotRestoreAllowance(
    ctx: Pick<GenerationContext, "id" | "executionPolicy">,
    allow: boolean,
  ): Promise<void> {
    const current = ctx.executionPolicy.allowSnapshotRestoreOnRun ?? true;
    if (current === allow) {
      return;
    }

    ctx.executionPolicy = {
      ...ctx.executionPolicy,
      allowSnapshotRestoreOnRun: allow,
    };
    await this.lifecycleStore.setSnapshotRestoreAllowance({
      generationId: ctx.id,
      executionPolicy: ctx.executionPolicy,
    });
  }

  private scheduleRecoveryReattach(ctx: GenerationContext): void {
    const delayMs = generationLifecyclePolicy.recoveryObserveWindowMs;
    void this.generationRunQueue
      .enqueueGenerationRun(ctx.id, this.generationRunQueue.getGenerationRunType(ctx), {
        delayMs,
        dedupeKey: `recovery-${ctx.recoveryAttempts}`,
        runMode: "recovery_reattach",
      })
      .catch((error) => {
        console.error(
          `[GenerationManager] Failed to enqueue recovery attempt for generation ${ctx.id}:`,
          error,
        );
      });
  }

  private async releaseSandboxSlotLease(ctx: GenerationContext): Promise<void> {
    await this.sandboxSlotLeaseCoordinator.release(ctx);
  }

  private async ensureSandboxSlotLease(
    ctx: GenerationContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued" | "waiting"> {
    return this.sandboxSlotLeaseCoordinator.ensure(ctx, options);
  }

  private async waitForSandboxSlotLease(
    ctx: GenerationContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued"> {
    return this.sandboxSlotLeaseCoordinator.wait(ctx, options);
  }

  private async enqueueGenerationTimeout(
    generationId: string,
    kind: GenerationTimeoutKind,
    expiresAtIso: string,
  ): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    const queue = getQueue();
    const runAt = Date.parse(expiresAtIso);
    const delay = Math.max(0, Number.isFinite(runAt) ? runAt - Date.now() : 0);
    const timeoutKey =
      Number.isFinite(runAt) && runAt > 0
        ? String(runAt)
        : expiresAtIso.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
    const jobName =
      kind === "approval" ? GENERATION_APPROVAL_TIMEOUT_JOB_NAME : GENERATION_AUTH_TIMEOUT_JOB_NAME;
    const jobId = buildQueueJobId([jobName, generationId, timeoutKey]);
    await queue.add(
      jobName,
      { generationId, kind, expiresAt: expiresAtIso },
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private async enqueuePreparingStuckCheck(generationId: string): Promise<void> {
    try {
      const queue = getQueue();
      const jobName = GENERATION_PREPARING_STUCK_CHECK_JOB_NAME;
      await queue.add(
        jobName,
        { generationId },
        {
          jobId: buildQueueJobId([jobName, generationId]),
          delay: AGENT_PREPARING_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      logger.warn({
        event: "GENERATION_PREPARING_STUCK_CHECK_ENQUEUE_FAILED",
        ...{ source: "generation-manager" },
        ...{
          generationId,
          error: formatErrorMessage(error),
        },
      });
    }
  }

  /**
   * Start a new generation for a conversation
   */
  async startGeneration(
    params: StartGenerationInput,
  ): Promise<{ generationId: string; conversationId: string; traceId: string }> {
    return this.turnIntake.startGeneration(params);
  }

  /**
   * Start a new coworker generation.
   */
  async startCoworkerGeneration(
    params: StartCoworkerGenerationInput,
  ): Promise<{ generationId: string; conversationId: string }> {
    return this.turnIntake.startCoworkerGeneration(params);
  }

  async runQueuedGeneration(
    generationId: string,
    runMode: GenerationRunMode = "normal_run",
  ): Promise<void> {
    await this.turnRunner.runQueuedGeneration(generationId, runMode);
  }

  /**
   * Subscribe to a generation's events
   */
  async *subscribeToGeneration(
    generationId: string,
    userId: string,
    options?: { cursor?: string },
  ): AsyncGenerator<GenerationStreamEvent, void, unknown> {
    yield* this.eventLog.subscribe({
      generationId,
      userId,
      cursor: options?.cursor,
    });
  }

  /**
   * Cancel a generation
   */
  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
    return this.generationControl.cancelGeneration(generationId, userId);
  }

  async resumeGeneration(generationId: string, userId: string): Promise<boolean> {
    return this.decisionFlow.resumeGeneration(generationId, userId);
  }

  async processGenerationTimeout(generationId: string, kind: GenerationTimeoutKind): Promise<void> {
    return this.maintenance.processGenerationTimeout(generationId, kind);
  }

  async processPreparingStuckCheck(generationId: string): Promise<void> {
    return this.maintenance.processPreparingStuckCheck(generationId);
  }

  async reapStaleGenerations(): Promise<{
    scanned: number;
    stale: number;
    finalizedRunningAsError: number;
    finalizedWaitingAsError: number;
  }> {
    return this.maintenance.reapStaleGenerations();
  }

  private async refreshCancellationSignal(
    ctx: GenerationContext,
    options?: { force?: boolean },
  ): Promise<boolean> {
    if (ctx.abortController.signal.aborted) {
      return true;
    }

    const now = Date.now();
    if (
      !options?.force &&
      ctx.lastCancellationCheckAt &&
      now - ctx.lastCancellationCheckAt < CANCELLATION_POLL_INTERVAL_MS
    ) {
      return false;
    }
    ctx.lastCancellationCheckAt = now;

    const latest = await db.query.generation.findFirst({
      where: eq(generation.id, ctx.id),
      columns: {
        status: true,
        cancelRequestedAt: true,
      },
    });

    if (!latest) {
      return false;
    }

    if (latest.cancelRequestedAt || latest.status === "cancelled") {
      ctx.abortController.abort();
      return true;
    }

    return false;
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(
    generationId: string,
    toolUseId: string,
    decision: "approve" | "deny",
    userId: string,
    questionAnswers?: string[][],
  ): Promise<boolean> {
    return this.decisionFlow.submitApproval({
      generationId,
      toolUseId,
      decision,
      userId,
      questionAnswers,
    });
  }

  async submitApprovalByInterrupt(
    interruptId: string,
    decision: "approve" | "deny",
    userId: string,
    questionAnswers?: string[][],
  ): Promise<boolean> {
    return this.decisionFlow.submitApprovalByInterrupt({
      interruptId,
      decision,
      userId,
      questionAnswers,
    });
  }

  async getAllowedIntegrationsForGeneration(
    generationId: string,
  ): Promise<IntegrationType[] | null> {
    return this.generationControl.getAllowedIntegrationsForGeneration(generationId);
  }

  /**
   * Get generation status
   */
  async getGenerationStatus(
    generationId: string,
  ): ReturnType<GenerationControl["getGenerationStatus"]> {
    return this.generationControl.getGenerationStatus(generationId);
  }

  // ========== Private Methods ==========

  /**
   * Dispatch generation to the appropriate backend.
   */
  private async runGeneration(
    ctx: GenerationContext,
    runMode: GenerationRunMode = "normal_run",
    leaseTokenOverride?: string | null,
  ): Promise<void> {
    await this.turnRunner.runGeneration(ctx, runMode, leaseTokenOverride);
  }

  private async hydrateStreamSequence(ctx: GenerationContext): Promise<void> {
    try {
      const latest = await getLatestGenerationStreamEnvelope(ctx.id);
      if (!latest) {
        return;
      }
      ctx.streamSequence = Math.max(ctx.streamSequence, latest.envelope.sequence);
      ctx.streamLastCursor = latest.cursor;
    } catch (error) {
      logger.warn({
        event: "GENERATION_STREAM_SEQUENCE_HYDRATE_FAILED",
        ...{
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
        ...{
          error: formatErrorMessage(error),
        },
      });
    }
  }

  private async handleSessionReset(ctx: GenerationContext): Promise<void> {
    try {
      await writeSessionTranscriptFromConversation({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        source: "manual_reset",
        messageLimit: 15,
        excludeUserMessages: Array.from(SESSION_RESET_COMMANDS),
      });
    } catch (err) {
      console.error("[GenerationManager] Failed to write session transcript:", err);
    }

    try {
      await clearConversationSessionSnapshot(ctx.conversationId);
    } catch (err) {
      console.error("[GenerationManager] Failed to clear session snapshot:", err);
    }

    await db.insert(message).values({
      conversationId: ctx.conversationId,
      role: "system",
      content: `${SESSION_BOUNDARY_PREFIX}\n${new Date().toISOString()}`,
    });

    if (ctx.runtimeId) {
      await conversationRuntimeService.updateRuntimeSession({
        runtimeId: ctx.runtimeId,
        sessionId: null,
        sandboxId: ctx.sandboxId ?? null,
      });
    }

    ctx.sessionId = undefined;

    ctx.assistantContent = "Started a new session.";
    ctx.contentParts = [{ type: "text", text: ctx.assistantContent }];

    await this.finishGeneration(ctx, "completed");
  }

  private async runRecoveryReattach(
    ctx: GenerationContext,
    options?: RuntimeRecoveryReattachOptions,
  ): Promise<void> {
    await this.runtimeCoordinator.runRecoveryReattach(ctx, options);
  }

  private async runRuntimeGeneration(ctx: GenerationContext): Promise<void> {
    await this.runtimeCoordinator.runNormal(ctx);
  }

  private async importIntegrationSkillDraftsFromSandbox(ctx: GenerationContext): Promise<void> {
    if (!ctx.sandbox) {
      return;
    }
    await importIntegrationSkillDraftsFromSandbox({
      userId: ctx.userId,
      sandbox: ctx.sandbox,
      logDraftError: (filePath, error) => {
        console.error(
          `[GenerationManager] Failed to import integration skill draft ${filePath}:`,
          error,
        );
      },
      logSkippedDraft: (slug, error) => {
        console.warn(
          `[GenerationManager] Skipped integration skill draft for slug '${slug}':`,
          error instanceof Error ? error.message : error,
        );
      },
    });
  }

  private async handleApprovalTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_approval" || !ctx.currentInterruptId) {
      return;
    }

    console.log(`[GenerationManager] Approval timeout for generation ${ctx.id}, failing run`);
    this.contextState.setCompletionReason(ctx, "approval_timeout");
    if (!ctx.errorMessage) {
      ctx.errorMessage = "Approval request expired before the run could continue.";
    }
    await generationInterruptService.resolveInterrupt({
      interruptId: ctx.currentInterruptId,
      status: "expired",
    });
    ctx.currentInterruptId = undefined;
    await this.finishGeneration(ctx, "error");
  }

  private async handleAuthTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_auth" || !ctx.currentInterruptId) {
      return;
    }

    console.log(`[GenerationManager] Auth timeout for generation ${ctx.id}, failing run`);
    this.contextState.setCompletionReason(ctx, "auth_timeout");
    if (!ctx.errorMessage) {
      ctx.errorMessage = "Authentication request expired before the run could continue.";
    }
    await generationInterruptService.resolveInterrupt({
      interruptId: ctx.currentInterruptId,
      status: "expired",
    });
    ctx.currentInterruptId = undefined;
    await this.finishGeneration(ctx, "error");
  }

  /**
   * Submit an auth result (called after OAuth completes)
   */
  async submitAuthResult(
    generationId: string,
    integration: string,
    success: boolean,
    userId: string,
  ): Promise<boolean> {
    return this.decisionFlow.submitAuthResult({
      generationId,
      integration,
      success,
      userId,
    });
  }

  async submitAuthResultByInterrupt(
    interruptId: string,
    integration: string,
    success: boolean,
    userId: string,
  ): Promise<boolean> {
    return this.decisionFlow.submitAuthResultByInterrupt({
      interruptId,
      integration,
      success,
      userId,
    });
  }

  /**
   * Wait for user approval on a write operation (called by internal router from plugin).
   * This creates a pending approval request and waits for the user to respond.
   */
  async waitForApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
    },
  ): Promise<"allow" | "deny"> {
    return this.decisionFlow.waitForApproval(generationId, request);
  }

  async requestPluginApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
      providerRequestId?: string;
      runtimeTool?: RuntimeToolRef;
    },
  ): Promise<{
    decision: "allow" | "deny" | "pending";
    toolUseId?: string;
    interruptId?: string;
    expiresAt?: string;
  }> {
    return this.decisionFlow.requestPluginApproval(generationId, request);
  }

  async requestAuthInterrupt(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<
    { interruptId: string; status: "pending"; expiresAt?: string } | { status: "accepted" }
  > {
    return this.decisionFlow.requestAuthInterrupt(generationId, request);
  }

  async getPluginApprovalStatus(
    generationId: string,
    interruptId: string,
  ): Promise<"pending" | "allow" | "deny"> {
    return this.decisionFlow.getPluginApprovalStatus(generationId, interruptId);
  }

  /**
   * Wait for OAuth authentication (called by internal router from plugin).
   * This creates a pending auth request and waits for the OAuth flow to complete.
   */
  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; userId?: string }> {
    return this.decisionFlow.waitForAuth(generationId, request);
  }

  private async saveSessionSnapshotIfPossible(
    ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
    reason: string,
  ): Promise<void> {
    await this.turnSuspender.saveSessionSnapshotIfPossible(ctx, reason);
  }

  private async awaitPromiseUntilRunDeadline<T>(
    ctx: Pick<GenerationContext, "deadlineAt">,
    promise: Promise<T>,
  ): Promise<{ type: "resolved"; value: T } | { type: "timed_out" }> {
    const remainingRunTimeMs = this.contextState.getRemainingRunTimeMs(ctx);
    if (remainingRunTimeMs <= 0) {
      return { type: "timed_out" };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then((value) => ({ type: "resolved" as const, value })),
        new Promise<{ type: "timed_out" }>((resolve) => {
          timeoutId = setTimeout(() => resolve({ type: "timed_out" }), remainingRunTimeMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async parkGenerationForRunDeadline(
    ctx: GenerationContext,
    runtimeClient?: { abort(input: { sessionID: string }): Promise<unknown> },
  ): Promise<void> {
    await this.turnSuspender.parkGenerationForRunDeadline(ctx, runtimeClient);
  }

  private async finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error",
  ): Promise<void> {
    await this.turnFinalizer.finishGeneration(ctx, status);
  }

  private scheduleSave(ctx: GenerationContext): void {
    this.turnFinalizer.scheduleSave(ctx);
  }

  private async saveProgress(ctx: GenerationContext): Promise<void> {
    await this.turnFinalizer.saveProgress(ctx);
  }

  private publishEventToRedisStream(ctx: GenerationContext, event: GenerationEvent): void {
    this.eventLog.publishActive(ctx, event);
  }

  private projectInterruptPendingEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return this.decisionFlow.projectPendingEvent(interrupt);
  }

  private projectInterruptResolvedEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return this.decisionFlow.projectResolvedEvent(interrupt);
  }

  private async publishDetachedGenerationStreamEvent(params: {
    generationId: string;
    conversationId: string;
    event: GenerationEvent;
  }): Promise<void> {
    await this.eventLog.publishDetached(params);
  }

  private broadcast(ctx: GenerationContext, event: GenerationEvent): void {
    this.publishEventToRedisStream(ctx, event);
  }
}

const globalForGenerationManager = globalThis as typeof globalThis & {
  __bapGenerationManager?: GenerationManager;
};
export const generationManager =
  globalForGenerationManager.__bapGenerationManager ?? new GenerationManager();

if (process.env.NODE_ENV !== "production") {
  globalForGenerationManager.__bapGenerationManager = generationManager;
}
