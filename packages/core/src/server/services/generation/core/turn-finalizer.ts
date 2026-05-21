import { db } from "@cmdclaw/db/client";
import { message, type MessageTiming } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { logServerEvent } from "../../../utils/observability";
import { getSandboxSlotManager } from "../../sandbox-slot-manager";
import { sendTaskDonePush } from "../../web-push-service";
import { collectMentionedSandboxFiles } from "../files/sandbox-file-collection";
import type { GenerationContext, GenerationEvent } from "../types";
import type { GenerationLifecycleStore } from "./lifecycle-store";

const SAVE_DEBOUNCE_MS = 2000;

type GenerationTerminalStatus = "completed" | "cancelled" | "error";

type TurnFinalizerDependencies = {
  lifecycleStore: GenerationLifecycleStore;
  markPhase(ctx: GenerationContext, phase: string): void;
  broadcast(ctx: GenerationContext, event: GenerationEvent): void;
  stopExternalInterruptPolling(ctx: GenerationContext): void;
  releaseSandboxSlotLease(ctx: GenerationContext): Promise<void>;
  evictActiveGenerationContext(generationId: string): void;
  enqueueConversationQueuedMessageProcess(conversationId: string): Promise<unknown>;
  saveSessionSnapshotIfPossible(
    ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
    reason: string,
  ): Promise<void>;
};

type SandboxFileExposureOptions = {
  summaryMessage: (summary: { discoveredCount: number; exposedCount: number }) => string;
  collectionErrorMessage: string;
  uploadErrorMessage: (filePath: string) => string;
  warnOnUploadError?: boolean;
};

function phaseDurationMs(
  phaseMarks: Record<string, number>,
  startPhase: string,
  endPhase: string,
): number | undefined {
  const start = phaseMarks[startPhase];
  const end = phaseMarks[endPhase];
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return Math.max(0, end - start);
}

function getGenerationDiagnosticMessage(
  debugInfo: GenerationContext["debugInfo"] | null | undefined,
): string | undefined {
  const message = debugInfo?.originalErrorMessage?.trim();
  return message && message.length > 0 ? message : undefined;
}

function formatGenerationErrorMessage(message: string, diagnosticMessage?: string): string {
  const normalizedMessage = message.trim();
  const normalizedDiagnostic = diagnosticMessage?.trim();
  if (!normalizedDiagnostic) {
    return normalizedMessage;
  }
  if (normalizedMessage.includes(normalizedDiagnostic)) {
    return normalizedMessage;
  }
  return `${normalizedMessage}\nUnderlying error: ${normalizedDiagnostic}`;
}

async function getDoneArtifacts(messageId: string): Promise<
  | {
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
    }
  | undefined
> {
  const messageRecord = await db.query.message.findFirst({
    where: eq(message.id, messageId),
    with: {
      attachments: true,
      sandboxFiles: true,
    },
  });

  if (!messageRecord) {
    return undefined;
  }

  return {
    timing: messageRecord.timing ?? undefined,
    attachments: messageRecord.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
    sandboxFiles: messageRecord.sandboxFiles.map((file) => ({
      fileId: file.id,
      path: file.path,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  };
}

function buildMessageTiming(ctx: GenerationContext): MessageTiming {
  const generationCompletedAt = Date.now();
  const generationStartedAt = ctx.startedAt.getTime();
  const phaseMarks = ctx.phaseMarks ?? {};
  const phaseTimeline = ctx.phaseTimeline ?? [];
  const messageTiming: MessageTiming = {
    generationDurationMs: Math.max(0, generationCompletedAt - generationStartedAt),
  };
  const sandboxInitMs =
    phaseMarks.sandbox_init_started !== undefined && phaseMarks.agent_init_started !== undefined
      ? Math.max(0, phaseMarks.agent_init_started - phaseMarks.sandbox_init_started)
      : undefined;
  const sandboxConnectStartMs =
    phaseMarks.sandbox_init_checking_cache ?? phaseMarks.sandbox_init_started;
  const sandboxConnectEndMs = phaseMarks.sandbox_init_reused ?? phaseMarks.sandbox_init_created;
  const sandboxConnectOrCreateMs =
    sandboxConnectStartMs !== undefined && sandboxConnectEndMs !== undefined
      ? Math.max(0, sandboxConnectEndMs - sandboxConnectStartMs)
      : undefined;
  const sandboxCreateMs = phaseDurationMs(
    phaseMarks,
    "sandbox_init_creating",
    "sandbox_init_created",
  );
  const opencodeReadyStartMs =
    phaseMarks.agent_init_opencode_starting ?? phaseMarks.agent_init_started;
  const opencodeReadyMs =
    opencodeReadyStartMs !== undefined && phaseMarks.agent_init_opencode_ready !== undefined
      ? Math.max(0, phaseMarks.agent_init_opencode_ready - opencodeReadyStartMs)
      : undefined;
  const sessionReadyMs =
    phaseMarks.agent_init_session_reused !== undefined &&
    phaseMarks.agent_init_started !== undefined
      ? Math.max(0, phaseMarks.agent_init_session_reused - phaseMarks.agent_init_started)
      : phaseMarks.agent_init_session_creating !== undefined &&
          phaseMarks.agent_init_session_init_completed !== undefined
        ? Math.max(
            0,
            phaseMarks.agent_init_session_init_completed - phaseMarks.agent_init_session_creating,
          )
        : undefined;
  const legacySandboxStartupMs =
    ctx.agentInitStartedAt && ctx.agentSandboxReadyAt
      ? Math.max(0, ctx.agentSandboxReadyAt - ctx.agentInitStartedAt)
      : undefined;
  const resolvedSandboxStartupMs = sandboxConnectOrCreateMs ?? legacySandboxStartupMs;
  if (resolvedSandboxStartupMs !== undefined) {
    messageTiming.sandboxStartupDurationMs = resolvedSandboxStartupMs;
    messageTiming.sandboxStartupMode = ctx.agentSandboxMode ?? "unknown";
  }

  const agentInitMs =
    phaseMarks.agent_init_started !== undefined && phaseMarks.agent_init_ready !== undefined
      ? Math.max(0, phaseMarks.agent_init_ready - phaseMarks.agent_init_started)
      : undefined;
  const prePromptSetupMs =
    phaseMarks.pre_prompt_setup_started !== undefined && phaseMarks.prompt_sent !== undefined
      ? Math.max(0, phaseMarks.prompt_sent - phaseMarks.pre_prompt_setup_started)
      : undefined;
  const prePromptMemorySyncMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_memory_sync_started",
    "pre_prompt_memory_sync_completed",
  );
  const prePromptRuntimeContextWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_runtime_context_write_started",
    "pre_prompt_runtime_context_write_completed",
  );
  const prePromptExecutorPrepareMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_prepare_started",
    "pre_prompt_executor_prepare_completed",
  );
  const prePromptExecutorBootstrapLoadMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_bootstrap_load_started",
    "pre_prompt_executor_bootstrap_load_completed",
  );
  const prePromptExecutorConfigWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_config_write_started",
    "pre_prompt_executor_config_write_completed",
  );
  const prePromptExecutorServerProbeMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_server_probe_started",
    "pre_prompt_executor_server_probe_completed",
  );
  const prePromptExecutorServerWaitReadyMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_server_wait_ready_started",
    "pre_prompt_executor_server_wait_ready_completed",
  );
  const prePromptExecutorStatusCheckMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_status_check_started",
    "pre_prompt_executor_status_check_completed",
  );
  const prePromptExecutorOauthReconcileMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_executor_oauth_reconcile_started",
    "pre_prompt_executor_oauth_reconcile_completed",
  );
  const prePromptSkillsAndCredsLoadMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_skills_and_creds_load_started",
    "pre_prompt_skills_and_creds_load_completed",
  );
  const prePromptCacheReadMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_cache_read_started",
    "pre_prompt_cache_read_completed",
  );
  const prePromptSkillsWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_skills_write_started",
    "pre_prompt_skills_write_completed",
  );
  const prePromptCustomIntegrationCliWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_custom_integration_cli_write_started",
    "pre_prompt_custom_integration_cli_write_completed",
  );
  const prePromptCustomIntegrationPermissionsWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_custom_integration_permissions_write_started",
    "pre_prompt_custom_integration_permissions_write_completed",
  );
  const prePromptIntegrationSkillsWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_integration_skills_write_started",
    "pre_prompt_integration_skills_write_completed",
  );
  const prePromptCacheWriteMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_cache_write_started",
    "pre_prompt_cache_write_completed",
  );
  const prePromptPromptSpecComposeMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_prompt_spec_compose_started",
    "pre_prompt_prompt_spec_compose_completed",
  );
  const prePromptEventStreamSubscribeMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_event_stream_subscribe_started",
    "pre_prompt_event_stream_subscribe_completed",
  );
  const prePromptCoworkerDocsStageMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_coworker_docs_stage_started",
    "pre_prompt_coworker_docs_stage_completed",
  );
  const prePromptAttachmentsStageMs = phaseDurationMs(
    phaseMarks,
    "pre_prompt_attachments_stage_started",
    "pre_prompt_attachments_stage_completed",
  );
  const waitForFirstEventMs =
    phaseMarks.prompt_sent !== undefined && phaseMarks.first_event_received !== undefined
      ? Math.max(0, phaseMarks.first_event_received - phaseMarks.prompt_sent)
      : undefined;
  const firstTokenAtMs = phaseMarks.first_token_emitted;
  const firstVisibleOutputAtMs =
    phaseMarks.first_visible_output_emitted ?? phaseMarks.first_token_emitted;
  const promptToFirstTokenMs =
    phaseMarks.prompt_sent !== undefined && firstTokenAtMs !== undefined
      ? Math.max(0, firstTokenAtMs - phaseMarks.prompt_sent)
      : undefined;
  const generationToFirstTokenMs =
    phaseMarks.generation_started !== undefined && firstTokenAtMs !== undefined
      ? Math.max(0, firstTokenAtMs - phaseMarks.generation_started)
      : undefined;
  const promptToFirstVisibleOutputMs =
    phaseMarks.prompt_sent !== undefined && firstVisibleOutputAtMs !== undefined
      ? Math.max(0, firstVisibleOutputAtMs - phaseMarks.prompt_sent)
      : undefined;
  const generationToFirstVisibleOutputMs =
    phaseMarks.generation_started !== undefined && firstVisibleOutputAtMs !== undefined
      ? Math.max(0, firstVisibleOutputAtMs - phaseMarks.generation_started)
      : undefined;
  const streamFinishedAt = phaseMarks.session_idle ?? phaseMarks.prompt_completed;
  const modelStreamMs =
    phaseMarks.first_event_received !== undefined && streamFinishedAt !== undefined
      ? Math.max(0, streamFinishedAt - phaseMarks.first_event_received)
      : undefined;
  const postProcessingMs =
    phaseMarks.post_processing_started !== undefined &&
    phaseMarks.post_processing_completed !== undefined
      ? Math.max(0, phaseMarks.post_processing_completed - phaseMarks.post_processing_started)
      : undefined;

  const phaseDurationsMs = {
    sandboxInitMs,
    sandboxConnectOrCreateMs,
    sandboxCreateMs,
    opencodeReadyMs,
    sessionReadyMs,
    agentInitMs,
    prePromptSetupMs,
    prePromptMemorySyncMs,
    prePromptRuntimeContextWriteMs,
    prePromptExecutorPrepareMs,
    prePromptExecutorBootstrapLoadMs,
    prePromptExecutorConfigWriteMs,
    prePromptExecutorServerProbeMs,
    prePromptExecutorServerWaitReadyMs,
    prePromptExecutorStatusCheckMs,
    prePromptExecutorOauthReconcileMs,
    prePromptSkillsAndCredsLoadMs,
    prePromptCacheReadMs,
    prePromptSkillsWriteMs,
    prePromptCustomIntegrationCliWriteMs,
    prePromptCustomIntegrationPermissionsWriteMs,
    prePromptIntegrationSkillsWriteMs,
    prePromptCacheWriteMs,
    prePromptPromptSpecComposeMs,
    prePromptEventStreamSubscribeMs,
    prePromptCoworkerDocsStageMs,
    prePromptAttachmentsStageMs,
    waitForFirstEventMs,
    promptToFirstTokenMs,
    generationToFirstTokenMs,
    promptToFirstVisibleOutputMs,
    generationToFirstVisibleOutputMs,
    modelStreamMs,
    postProcessingMs,
  };
  if (Object.values(phaseDurationsMs).some((value) => value !== undefined)) {
    messageTiming.phaseDurationsMs = phaseDurationsMs;
  }

  if (phaseTimeline.length > 0) {
    messageTiming.phaseTimestamps = phaseTimeline.map((entry) => ({
      phase: entry.phase,
      at: new Date(entry.atMs).toISOString(),
      elapsedMs: entry.elapsedMs,
    }));
  }

  return messageTiming;
}

export class GenerationTurnFinalizer {
  constructor(private readonly deps: TurnFinalizerDependencies) {}

  scheduleSave(ctx: GenerationContext): void {
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }

    ctx.saveDebounceId = setTimeout(() => {
      void this.saveProgress(ctx);
    }, SAVE_DEBOUNCE_MS);
  }

  async saveProgress(ctx: GenerationContext): Promise<void> {
    ctx.lastSaveAt = new Date();

    await this.deps.lifecycleStore.appendProgress({
      generationId: ctx.id,
      contentParts: ctx.contentParts,
      usage: ctx.usage,
      lastRuntimeEventAt: ctx.lastRuntimeEventAt,
      deadlineAt: ctx.deadlineAt,
      remainingRunMs: ctx.remainingRunMs,
      suspendedAt: ctx.suspendedAt ?? null,
      resumeInterruptId: ctx.resumeInterruptId ?? null,
      recoveryAttempts: ctx.recoveryAttempts,
      completionReason: ctx.completionReason ?? null,
      debugInfo: ctx.debugInfo ?? null,
    });
  }

  async finishGeneration(ctx: GenerationContext, status: GenerationTerminalStatus): Promise<void> {
    if (ctx.isFinalizing) {
      return;
    }
    if (ctx.status === "completed" || ctx.status === "cancelled" || ctx.status === "error") {
      return;
    }
    ctx.isFinalizing = true;

    try {
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
      this.deps.stopExternalInterruptPolling(ctx);
      if (ctx.authTimeoutId) {
        clearTimeout(ctx.authTimeoutId);
      }
      await this.deps.releaseSandboxSlotLease(ctx);
      await getSandboxSlotManager().clearPendingRequest(ctx.id);

      this.deps.markPhase(ctx, "generation_completed");
      const terminalMessageTiming = buildMessageTiming(ctx);
      if (status === "completed" && ctx.sandbox && ctx.generationMarkerTime) {
        await this.collectAndExposeMentionedSandboxFiles(ctx, {
          summaryMessage: ({ discoveredCount, exposedCount }) =>
            `[GenerationManager] Found ${discoveredCount} new sandbox files; exposing ${exposedCount} based on final-answer mentions`,
          collectionErrorMessage: "[GenerationManager] Failed to collect new sandbox files:",
          uploadErrorMessage: (filePath) =>
            `[GenerationManager] Failed to upload collected file ${filePath}:`,
          warnOnUploadError: true,
        });
      }

      const finishResult = await this.deps.lifecycleStore.finishTurn({
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: ctx.runtimeId,
        sessionId: ctx.sessionId ?? null,
        coworkerRunId: ctx.coworkerRunId,
        status,
        contentParts: ctx.contentParts,
        assistantContent: ctx.assistantContent,
        terminalMessageTiming,
        isNewConversation: ctx.isNewConversation,
        userMessageContent: ctx.userMessageContent,
        uploadedSandboxFileIds: Array.from(ctx.uploadedSandboxFileIds || []),
        errorMessage: ctx.errorMessage,
        debugInfo: ctx.debugInfo ?? null,
        lastRuntimeEventAt: ctx.lastRuntimeEventAt,
        recoveryAttempts: ctx.recoveryAttempts,
        completionReason: ctx.completionReason ?? null,
        usage: ctx.usage,
        remainingRunMs: ctx.remainingRunMs,
        model: ctx.model,
        sandboxId: ctx.sandboxId ?? null,
        startedAt: ctx.startedAt,
      });
      ctx.contentParts = finishResult.contentParts;
      const messageId = finishResult.messageId;
      const completedAssistantContent = finishResult.assistantContent;

      if (status === "completed") {
        await this.deps.saveSessionSnapshotIfPossible(ctx, `finish:${status}`);
      }

      await this.deps.enqueueConversationQueuedMessageProcess(ctx.conversationId);

      if (status === "completed" && messageId) {
        const artifacts = await getDoneArtifacts(messageId);
        this.deps.broadcast(ctx, {
          type: "done",
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          messageId,
          usage: ctx.usage,
          artifacts,
        });

        try {
          await sendTaskDonePush({
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            messageId,
            content: completedAssistantContent,
          });
        } catch (error) {
          console.error("[GenerationManager] Failed to send task completion push", {
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            error,
          });
        }
      } else if (status === "cancelled") {
        this.deps.broadcast(ctx, {
          type: "cancelled",
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          messageId,
        });
      } else if (status === "error") {
        const diagnosticMessage = getGenerationDiagnosticMessage(ctx.debugInfo);
        this.deps.broadcast(ctx, {
          type: "error",
          message: formatGenerationErrorMessage(
            ctx.errorMessage || "Unknown error",
            diagnosticMessage,
          ),
          ...(diagnosticMessage ? { diagnosticMessage } : {}),
        });
      }

      logServerEvent(
        "info",
        "GENERATION_STREAM_PUBLISH_SUMMARY",
        {
          publishedCount: ctx.streamPublishedCount,
          lastCursor: ctx.streamLastCursor ?? null,
          lastSequence: ctx.streamSequence,
          firstVisiblePublishedAt: ctx.streamFirstVisiblePublishedAt
            ? new Date(ctx.streamFirstVisiblePublishedAt).toISOString()
            : null,
          terminalPublishedAt: ctx.streamTerminalPublishedAt
            ? new Date(ctx.streamTerminalPublishedAt).toISOString()
            : null,
          generationEventPublishMs:
            ctx.streamFirstVisiblePublishedAt && ctx.startedAt
              ? Math.max(0, ctx.streamFirstVisiblePublishedAt - ctx.startedAt.getTime())
              : undefined,
          generationTerminalPublishMs:
            ctx.streamTerminalPublishedAt && ctx.startedAt
              ? Math.max(0, ctx.streamTerminalPublishedAt - ctx.startedAt.getTime())
              : undefined,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );

      ctx.status = status;
      this.deps.evictActiveGenerationContext(ctx.id);
    } finally {
      ctx.isFinalizing = false;
    }
  }

  async collectAndExposeMentionedSandboxFiles(
    ctx: GenerationContext,
    options: SandboxFileExposureOptions,
  ): Promise<number> {
    if (!ctx.sandbox || !ctx.generationMarkerTime) {
      return 0;
    }

    try {
      const result = await collectMentionedSandboxFiles({
        sandbox: ctx.sandbox,
        markerTime: ctx.generationMarkerTime,
        conversationId: ctx.conversationId,
        assistantContent: ctx.assistantContent,
        contentParts: ctx.contentParts,
        excludePaths: Array.from(
          new Set([...(ctx.sentFilePaths ?? []), ...(ctx.userStagedFilePaths ?? [])]),
        ),
        onCollectionSummary: ({ discoveredCount, exposedCount }) => {
          console.log(options.summaryMessage({ discoveredCount, exposedCount }));
        },
        onUploadedFile: (fileRecord) => {
          ctx.uploadedSandboxFileIds?.add(fileRecord.id);
          this.deps.broadcast(ctx, {
            type: "sandbox_file",
            fileId: fileRecord.id,
            path: fileRecord.path,
            filename: fileRecord.filename,
            mimeType: fileRecord.mimeType,
            sizeBytes: fileRecord.sizeBytes,
          });
        },
        onUploadError: (filePath, error) => {
          if (options.warnOnUploadError) {
            console.warn(options.uploadErrorMessage(filePath), error);
            return;
          }
          console.error(options.uploadErrorMessage(filePath), error);
        },
      });
      return result.uploadedCount;
    } catch (error) {
      console.error(options.collectionErrorMessage, error);
      return 0;
    }
  }
}
