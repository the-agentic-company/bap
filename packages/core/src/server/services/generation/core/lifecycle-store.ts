import { db } from "@cmdclaw/db/client";
import {
  conversation,
  coworkerRun,
  generation,
  message,
  sandboxFile,
  type ContentPart,
  type MessageTiming,
} from "@cmdclaw/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { trackGenerationBilling } from "../../../billing/service";
import { captureGenerationFailureAlert } from "../../failure-alert-service";
import { generationInterruptService } from "../../generation-interrupt-service";
import { conversationRuntimeService } from "../../conversation-runtime-service";
import { generateConversationTitle } from "../../../utils/generate-title";
import type { ProviderAuthSource } from "../../../../lib/provider-auth-source";
import type {
  AppendProgressInput,
  LoadTurnInput,
  RequestCancellationInput,
  TurnRecord,
} from "./turn-record";
import type { GenerationCompletionReason } from "../../lifecycle-policy";

export type FinishTurnPersistenceInput = {
  generationId: string;
  conversationId: string;
  runtimeId?: string;
  sessionId?: string | null;
  coworkerRunId?: string;
  status: "completed" | "cancelled" | "error";
  contentParts: ContentPart[];
  assistantContent: string;
  terminalMessageTiming?: MessageTiming;
  isNewConversation?: boolean;
  userMessageContent?: string;
  uploadedSandboxFileIds?: string[];
  errorMessage?: string;
  debugInfo?: Record<string, unknown> | null;
  lastRuntimeEventAt: Date;
  recoveryAttempts: number;
  completionReason?: GenerationCompletionReason | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  remainingRunMs: number;
  model: string;
  sandboxId?: string | null;
  startedAt: Date;
};

export type FinishTurnPersistenceResult = {
  messageId?: string;
  assistantContent?: string;
  contentParts: ContentPart[];
};

export type FinalizeStaleGenerationsInput = {
  completedAt: Date;
  running: {
    ids: string[];
    message: string;
  };
  approval: {
    ids: string[];
    message: string;
  };
  auth: {
    ids: string[];
    message: string;
  };
};

export type ResumeAfterDecisionInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string;
  contentParts?: ContentPart[];
  clearPendingApproval?: boolean;
  clearPendingAuth?: boolean;
};

export type CancelAfterAuthFailureInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string;
};

export type ResumeGenerationRequestInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string;
  status: "running" | "awaiting_approval" | "awaiting_auth";
  executionPolicy: Record<string, unknown>;
};

export type PauseForRunDeadlineInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string;
  contentParts: ContentPart[];
  remainingRunMs: number;
  suspendedAt: Date;
  lastRuntimeEventAt: Date;
};

export type SuspendForInterruptInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string;
  status: "awaiting_approval" | "awaiting_auth";
  contentParts: ContentPart[];
  remainingRunMs: number;
  suspendedAt: Date;
  lastRuntimeEventAt: Date;
};

export type ResumeResolvedInterruptInput = {
  generationId: string;
  conversationId: string;
  coworkerRunId?: string | null;
  interruptId: string;
  deadlineAt: Date;
};

export type FinalizeDetachedGenerationErrorInput = {
  generationId: string;
  conversationId: string;
  runtimeId?: string;
  coworkerRunId?: string;
  message: string;
  completionReason: GenerationCompletionReason;
};

export type RuntimeMetadataInput = {
  sandboxProvider?: string | null;
  runtimeHarness?: string | null;
  runtimeProtocolVersion?: string | null;
};

export class GenerationLifecycleStore {
  async loadTurn(input: LoadTurnInput): Promise<TurnRecord | null> {
    const row = await db.query.generation.findFirst({
      where: eq(generation.id, input.generationId),
      with: { conversation: true },
    });

    if (!row) {
      return null;
    }
    if (!row.conversation.userId) {
      return null;
    }
    if (input.userId && row.conversation.userId !== input.userId) {
      return null;
    }

    return {
      generationId: row.id,
      conversationId: row.conversationId,
      userId: row.conversation.userId,
      kind: row.conversation.type === "coworker" ? "coworker" : "chat",
      status: row.status,
      runtimeBinding: row.runtimeId
        ? {
            runtimeId: row.runtimeId,
            turnSeq: 1,
            sandboxId: row.sandboxId,
          }
        : undefined,
      resumeInterruptId: row.resumeInterruptId,
      deadlineAt: row.deadlineAt,
      remainingRunMs: row.remainingRunMs,
      suspendedAt: row.suspendedAt,
      completionReason: row.completionReason as GenerationCompletionReason | null,
      contentParts: row.contentParts ?? [],
      usage: {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
    };
  }

  async requestCancellation(input: RequestCancellationInput): Promise<boolean> {
    const [updated] = await db
      .update(generation)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          eq(generation.id, input.generationId),
          inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
          sql`exists (
            select 1 from ${conversation}
            where ${conversation.id} = ${generation.conversationId}
            and ${conversation.userId} = ${input.userId}
          )`,
        ),
      )
      .returning({ id: generation.id });

    return Boolean(updated);
  }

  async appendProgress(input: AppendProgressInput): Promise<void> {
    await db
      .update(generation)
      .set({
        contentParts: input.contentParts.length > 0 ? input.contentParts : null,
        ...(input.usage
          ? {
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
            }
          : {}),
        lastRuntimeEventAt: input.lastRuntimeEventAt,
        ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
        ...(input.remainingRunMs !== undefined && input.remainingRunMs !== null
          ? { remainingRunMs: input.remainingRunMs }
          : {}),
        suspendedAt: input.suspendedAt ?? null,
        resumeInterruptId: input.resumeInterruptId ?? null,
        ...(input.recoveryAttempts !== undefined ? { recoveryAttempts: input.recoveryAttempts } : {}),
        completionReason: input.completionReason ?? null,
        debugInfo: (input.debugInfo ?? null) as Record<string, unknown> | null,
      })
      .where(eq(generation.id, input.generationId));
  }

  async persistDecisionContentParts(input: {
    generationId: string;
    contentParts: ContentPart[];
  }): Promise<void> {
    await db
      .update(generation)
      .set({
        contentParts: input.contentParts.length > 0 ? input.contentParts : null,
      })
      .where(eq(generation.id, input.generationId));
  }

  async resumeAfterDecision(input: ResumeAfterDecisionInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "running",
        ...(input.contentParts
          ? { contentParts: input.contentParts.length > 0 ? input.contentParts : null }
          : {}),
        ...(input.clearPendingApproval ? { pendingApproval: null } : {}),
        ...(input.clearPendingAuth ? { pendingAuth: null } : {}),
        isPaused: false,
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async cancelAfterAuthFailure(input: CancelAfterAuthFailureInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "cancelled",
        completedAt: new Date(),
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({ generationStatus: "idle" })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async resumeGenerationRequest(input: ResumeGenerationRequestInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: input.status,
        isPaused: false,
        executionPolicy: input.executionPolicy,
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus:
          input.status === "running"
            ? "generating"
            : input.status === "awaiting_approval"
              ? "awaiting_approval"
              : "awaiting_auth",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({
          status:
            input.status === "running"
              ? "running"
              : input.status === "awaiting_approval"
                ? "awaiting_approval"
                : "awaiting_auth",
        })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async markCoworkerRunAwaitingAuth(coworkerRunId: string): Promise<void> {
    await db
      .update(coworkerRun)
      .set({ status: "awaiting_auth" })
      .where(eq(coworkerRun.id, coworkerRunId));
  }

  async markCoworkerRunAwaitingApproval(coworkerRunId: string): Promise<void> {
    await db
      .update(coworkerRun)
      .set({ status: "awaiting_approval" })
      .where(eq(coworkerRun.id, coworkerRunId));
  }

  async failQueuedRunBeforeContext(input: {
    generationId: string;
    message: string;
  }): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "error",
        errorMessage: input.message,
        completionReason: "runtime_error",
        completedAt: new Date(),
      })
      .where(eq(generation.id, input.generationId));
  }

  async pauseForRunDeadline(input: PauseForRunDeadlineInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "paused",
        isPaused: true,
        completionReason: "run_deadline",
        remainingRunMs: input.remainingRunMs,
        suspendedAt: input.suspendedAt,
        resumeInterruptId: null,
        sandboxId: null,
        pendingApproval: null,
        pendingAuth: null,
        contentParts: input.contentParts.length > 0 ? input.contentParts : null,
        lastRuntimeEventAt: input.lastRuntimeEventAt,
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: "paused",
        sandboxLastUserVisibleActionAt: input.suspendedAt,
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "paused" })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async suspendForInterrupt(input: SuspendForInterruptInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: input.status,
        remainingRunMs: input.remainingRunMs,
        suspendedAt: input.suspendedAt,
        resumeInterruptId: null,
        sandboxId: null,
        pendingApproval: null,
        pendingAuth: null,
        contentParts: input.contentParts.length > 0 ? input.contentParts : null,
        lastRuntimeEventAt: input.lastRuntimeEventAt,
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: input.status,
        sandboxLastUserVisibleActionAt: input.suspendedAt,
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: input.status })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async resumeResolvedInterrupt(input: ResumeResolvedInterruptInput): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "running",
        resumeInterruptId: input.interruptId,
        deadlineAt: input.deadlineAt,
        suspendedAt: null,
        isPaused: false,
        pendingApproval: null,
        pendingAuth: null,
      })
      .where(eq(generation.id, input.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async touchConversationLastUserVisibleAction(conversationId: string): Promise<void> {
    await db
      .update(conversation)
      .set({ sandboxLastUserVisibleActionAt: new Date() })
      .where(eq(conversation.id, conversationId));
  }

  async recordRecoveryAttempt(input: {
    generationId: string;
    recoveryAttempts: number;
  }): Promise<void> {
    await db
      .update(generation)
      .set({
        recoveryAttempts: input.recoveryAttempts,
      })
      .where(eq(generation.id, input.generationId));
  }

  async finalizeDetachedGenerationError(
    input: FinalizeDetachedGenerationErrorInput,
  ): Promise<void> {
    await generationInterruptService.cancelInterruptsForGeneration(input.generationId);
    await db
      .update(generation)
      .set({
        status: "error",
        pendingApproval: null,
        pendingAuth: null,
        isPaused: false,
        resumeInterruptId: null,
        suspendedAt: null,
        cancelRequestedAt: null,
        errorMessage: input.message,
        completionReason: input.completionReason,
        completedAt: new Date(),
      })
      .where(eq(generation.id, input.generationId));
    await db
      .update(conversation)
      .set({
        generationStatus: "error",
      })
      .where(eq(conversation.id, input.conversationId));
    if (input.runtimeId) {
      await conversationRuntimeService.clearActiveGeneration({
        runtimeId: input.runtimeId,
        generationId: input.generationId,
      });
    }
    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: new Date(),
          errorMessage: input.message,
        })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }
  }

  async setSnapshotRestoreAllowance(input: {
    generationId: string;
    executionPolicy: Record<string, unknown>;
  }): Promise<void> {
    await db
      .update(generation)
      .set({
        executionPolicy: input.executionPolicy,
      })
      .where(eq(generation.id, input.generationId));
  }

  async bindRuntimeSandbox(input: {
    generationId: string;
    runtimeId?: string;
    sandboxId: string;
    sessionId?: string | null;
    runtimeMetadata?: RuntimeMetadataInput;
  }): Promise<void> {
    await db
      .update(generation)
      .set({ sandboxId: input.sandboxId })
      .where(eq(generation.id, input.generationId));

    if (!input.runtimeId) {
      return;
    }

    await conversationRuntimeService.updateRuntimeSession({
      runtimeId: input.runtimeId,
      sandboxId: input.sandboxId,
      sessionId: input.sessionId ?? null,
      sandboxProvider: input.runtimeMetadata?.sandboxProvider ?? undefined,
      runtimeHarness: input.runtimeMetadata?.runtimeHarness ?? undefined,
      runtimeProtocolVersion: input.runtimeMetadata?.runtimeProtocolVersion ?? undefined,
      status: "active",
    });
  }

  async bindRuntimeSession(input: {
    runtimeId?: string;
    sandboxId?: string | null;
    sessionId: string;
    runtimeMetadata?: RuntimeMetadataInput;
  }): Promise<void> {
    if (!input.runtimeId) {
      return;
    }

    await conversationRuntimeService.updateRuntimeSession({
      runtimeId: input.runtimeId,
      sandboxId: input.sandboxId ?? null,
      sessionId: input.sessionId,
      sandboxProvider: input.runtimeMetadata?.sandboxProvider ?? undefined,
      runtimeHarness: input.runtimeMetadata?.runtimeHarness ?? undefined,
      runtimeProtocolVersion: input.runtimeMetadata?.runtimeProtocolVersion ?? undefined,
      status: "active",
    });
  }

  async markSuspendedInterruptResumeRunning(input: {
    generationId: string;
    deadlineAt?: Date | null;
    resumeInterruptId: string | null;
  }): Promise<void> {
    await db
      .update(generation)
      .set({
        status: "running",
        ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
        suspendedAt: null,
        resumeInterruptId: input.resumeInterruptId,
      })
      .where(eq(generation.id, input.generationId));
  }

  async clearAppliedResumeInterrupt(generationId: string): Promise<void> {
    await db
      .update(generation)
      .set({
        resumeInterruptId: null,
        suspendedAt: null,
      })
      .where(eq(generation.id, generationId));
  }

  async updateConversationModelSelection(input: {
    conversationId: string;
    model: string;
    authSource: ProviderAuthSource | null;
  }): Promise<typeof conversation.$inferSelect | null> {
    const [updatedConversation] = await db
      .update(conversation)
      .set({
        model: input.model,
        authSource: input.authSource,
      })
      .where(eq(conversation.id, input.conversationId))
      .returning();

    return updatedConversation ?? null;
  }

  async markConversationGenerationStarted(input: {
    conversationId: string;
    generationId: string;
  }): Promise<void> {
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: input.generationId,
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, input.conversationId));
  }

  async finishTurn(input: FinishTurnPersistenceInput): Promise<FinishTurnPersistenceResult> {
    await generationInterruptService.cancelInterruptsForGeneration(input.generationId);
    const terminalMessage = await this.persistTerminalAssistantMessage(input);
    const contentParts = terminalMessage.contentParts;
    await db
      .update(generation)
      .set({
        status: input.status,
        messageId: terminalMessage.messageId,
        cancelRequestedAt: null,
        pendingApproval: null,
        pendingAuth: null,
        resumeInterruptId: null,
        suspendedAt: null,
        remainingRunMs: input.remainingRunMs,
        contentParts: contentParts.length > 0 ? contentParts : null,
        errorMessage: input.errorMessage,
        debugInfo: input.debugInfo ?? null,
        lastRuntimeEventAt: input.lastRuntimeEventAt,
        recoveryAttempts: input.recoveryAttempts,
        completionReason:
          input.completionReason ??
          (input.status === "completed"
            ? "completed"
            : input.status === "cancelled"
              ? "user_cancel"
              : "runtime_error"),
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        completedAt: new Date(),
      })
      .where(eq(generation.id, input.generationId));

    if (input.status === "error") {
      try {
        await captureGenerationFailureAlert({ generationId: input.generationId });
      } catch (error) {
        console.error("[GenerationLifecycleStore] Failed to capture failure alert", {
          generationId: input.generationId,
          conversationId: input.conversationId,
          error,
        });
      }
    }

    const assistantMessagePersisted = Boolean(terminalMessage.messageId);
    await db
      .update(conversation)
      .set({
        generationStatus:
          input.status === "completed" ? "complete" : input.status === "error" ? "error" : "idle",
        ...(assistantMessagePersisted
          ? {
              usageInputTokens: sql`${conversation.usageInputTokens} + ${input.usage.inputTokens}`,
              usageOutputTokens: sql`${conversation.usageOutputTokens} + ${input.usage.outputTokens}`,
              usageTotalTokens: sql`${conversation.usageTotalTokens} + ${input.usage.inputTokens + input.usage.outputTokens}`,
              usageAssistantMessageCount: sql`${conversation.usageAssistantMessageCount} + 1`,
            }
          : {}),
      })
      .where(eq(conversation.id, input.conversationId));

    if (input.runtimeId) {
      await conversationRuntimeService.clearActiveGeneration({
        runtimeId: input.runtimeId,
        generationId: input.generationId,
      });
    }

    if (input.status === "completed") {
      try {
        const sandboxRuntimeMs = input.sandboxId
          ? Math.max(0, Date.now() - input.startedAt.getTime())
          : 0;
        await trackGenerationBilling({
          generationId: input.generationId,
          conversationId: input.conversationId,
          model: input.model,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          sandboxRuntimeMs,
        });
      } catch (error) {
        console.error("[GenerationLifecycleStore] Failed to track billing:", error);
      }
    }

    if (input.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({
          status:
            input.status === "completed"
              ? "completed"
              : input.status === "cancelled"
                ? "cancelled"
                : "error",
          finishedAt: new Date(),
          errorMessage: input.errorMessage,
          debugInfo: input.debugInfo ?? null,
        })
        .where(eq(coworkerRun.id, input.coworkerRunId));
    }

    return terminalMessage;
  }

  private async persistTerminalAssistantMessage(
    input: FinishTurnPersistenceInput,
  ): Promise<FinishTurnPersistenceResult> {
    const shouldPersistErrorAssistantMessage = input.status === "error";
    if (
      input.status !== "completed" &&
      input.status !== "cancelled" &&
      !shouldPersistErrorAssistantMessage
    ) {
      return {
        contentParts: input.contentParts,
      };
    }

    if (input.status === "completed" && input.runtimeId) {
      await conversationRuntimeService.updateRuntimeSession({
        runtimeId: input.runtimeId,
        sessionId: input.sessionId ?? null,
        sandboxId: input.sandboxId ?? null,
      });
    }

    const interruptionText = "Interrupted by user";
    const contentParts =
      input.status === "cancelled"
        ? [
            ...input.contentParts,
            ...(input.contentParts.some(
              (part): part is ContentPart & { type: "system" } =>
                part.type === "system" && part.content === interruptionText,
            )
              ? []
              : ([{ type: "system", content: interruptionText }] as ContentPart[])),
          ]
        : input.contentParts;

    const [assistantMessage] = await db
      .insert(message)
      .values({
        conversationId: input.conversationId,
        role: "assistant",
        content:
          input.status === "cancelled"
            ? input.assistantContent || interruptionText
            : input.assistantContent ||
              input.errorMessage ||
              (input.status === "completed"
                ? "The run completed without producing any assistant output."
                : "The run failed before producing any assistant output."),
        contentParts: contentParts.length > 0 ? contentParts : null,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        timing: input.terminalMessageTiming,
      })
      .returning();

    const uploadedFileIds = input.uploadedSandboxFileIds ?? [];
    if (input.status === "completed" && uploadedFileIds.length > 0) {
      await db
        .update(sandboxFile)
        .set({ messageId: assistantMessage.id })
        .where(inArray(sandboxFile.id, uploadedFileIds));
    }

    if (
      input.status === "completed" &&
      input.isNewConversation &&
      input.assistantContent &&
      input.userMessageContent
    ) {
      try {
        const title = await generateConversationTitle(input.userMessageContent, input.assistantContent);
        if (title) {
          await db
            .update(conversation)
            .set({ title })
            .where(eq(conversation.id, input.conversationId));
        }
      } catch (err) {
        console.error("[GenerationLifecycleStore] Failed to generate title:", err);
      }
    }

    return {
      messageId: assistantMessage.id,
      assistantContent: assistantMessage.content,
      contentParts,
    };
  }

  async finalizeStaleGenerationsAsError(input: FinalizeStaleGenerationsInput): Promise<void> {
    if (input.running.ids.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: input.running.message,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completedAt: input.completedAt,
        })
        .where(inArray(generation.id, input.running.ids));
    }

    if (input.approval.ids.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: input.approval.message,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completionReason: "approval_timeout",
          completedAt: input.completedAt,
        })
        .where(inArray(generation.id, input.approval.ids));
    }

    if (input.auth.ids.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: input.auth.message,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completionReason: "auth_timeout",
          completedAt: input.completedAt,
        })
        .where(inArray(generation.id, input.auth.ids));
    }

    await this.finalizeStaleProductRows(input.running.ids, input.running.message, input.completedAt);
    await this.finalizeStaleProductRows(
      input.approval.ids,
      input.approval.message,
      input.completedAt,
    );
    await this.finalizeStaleProductRows(input.auth.ids, input.auth.message, input.completedAt);
  }

  private async finalizeStaleProductRows(
    generationIds: string[],
    errorMessage: string,
    finishedAt: Date,
  ): Promise<void> {
    if (generationIds.length === 0) {
      return;
    }

    await db
      .update(coworkerRun)
      .set({
        status: "error",
        finishedAt,
        errorMessage,
      })
      .where(inArray(coworkerRun.generationId, generationIds));
    await db
      .update(conversation)
      .set({ generationStatus: "error" })
      .where(inArray(conversation.currentGenerationId, generationIds));
  }
}
