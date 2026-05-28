import {
  OpenCodeEventTranslator,
  type OpenCodeTrackedEvent,
} from "./opencode-event-translator";
import {
  OpenCodeRuntimeEventLoop,
  type OpenCodeApprovalCapableClient,
} from "./opencode-runtime-driver";
import type { RuntimeProgressKind } from "../../services/lifecycle-policy";
import {
  normalizeOpenCodeActionableEvent,
  sendOpenCodeRuntimeDecision,
} from "./opencode-runtime-actions";
import {
  parseCoworkerEditApplyEnvelope,
  parseCoworkerInvocationEnvelope,
} from "../../../lib/coworker-runtime-cli";
import { logServerEvent } from "../../utils/observability";
import { getToolUseMetadata } from "../../services/generation/streams/replay-events";
import type { GenerationContext, GenerationEvent } from "../../services/generation/types";
import type {
  RuntimeActionableEvent,
  RuntimeApprovalRequest,
} from "../runtime-driver";

export type OpenCodeTurnEventLoopMode = "normal" | "recovery_reattach";

type OpenCodeTurnEventBridgeCallbacks = {
  markPhase: (ctx: GenerationContext, phase: string) => void;
  broadcast: (ctx: GenerationContext, event: GenerationEvent) => void;
  scheduleSave: (ctx: GenerationContext) => void;
  saveProgress: (ctx: GenerationContext) => Promise<void>;
  markRuntimeProgress: (ctx: GenerationContext, kind: RuntimeProgressKind) => void;
  refreshCancellationSignal: (ctx: GenerationContext) => Promise<boolean>;
  handleActionableEvent: (
    ctx: GenerationContext,
    event: RuntimeActionableEvent,
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>,
  ) => Promise<{ type: "none" | "permission" | "question" }>;
};

export type CreateOpenCodeTurnEventLoopInput = {
  ctx: GenerationContext;
  client: OpenCodeApprovalCapableClient;
  mode: OpenCodeTurnEventLoopMode;
  verboseEventLogs?: boolean;
  pollExternalInterruptAndSuspendIfNeeded?: () => Promise<void>;
  onIdle?: () => void;
  onSessionError?: (errorMessage: string) => void;
};

export class OpenCodeTurnEventBridge {
  private readonly translator: OpenCodeEventTranslator<GenerationContext>;

  constructor(private readonly callbacks: OpenCodeTurnEventBridgeCallbacks) {
    this.translator = new OpenCodeEventTranslator<GenerationContext>({
      markPhase: (ctx, phase) => this.callbacks.markPhase(ctx, phase),
      broadcast: (ctx, event) => this.callbacks.broadcast(ctx, event),
      scheduleSave: (ctx) => this.callbacks.scheduleSave(ctx),
      saveProgress: (ctx) => this.callbacks.saveProgress(ctx),
      getToolUseMetadata,
      appendToolResultDerivedContentParts: ({ ctx, toolName, toolInput, toolResult }) => {
        const coworkerInvocation = parseCoworkerInvocationEnvelope({
          toolName,
          toolInput,
          toolResult,
        });
        if (coworkerInvocation) {
          ctx.contentParts.push({
            type: "coworker_invocation",
            coworker_id: coworkerInvocation.coworkerId,
            username: coworkerInvocation.username,
            name: coworkerInvocation.name,
            run_id: coworkerInvocation.runId,
            conversation_id: coworkerInvocation.conversationId,
            generation_id: coworkerInvocation.generationId,
            status: coworkerInvocation.status,
            attachment_names: coworkerInvocation.attachmentNames,
            message: coworkerInvocation.message,
          });
        }
        const coworkerEditApply = parseCoworkerEditApplyEnvelope({
          toolName,
          toolInput,
          toolResult,
        });
        if (coworkerEditApply) {
          this.applyCoworkerEditEnvelope(ctx, coworkerEditApply);
        }
      },
    });
  }

  createEventLoop(input: CreateOpenCodeTurnEventLoopInput): OpenCodeRuntimeEventLoop {
    const { ctx, client, mode } = input;
    return new OpenCodeRuntimeEventLoop({
      markFirstEvent: () => {
        if (!ctx.phaseMarks?.first_event_received) {
          this.callbacks.markPhase(ctx, "first_event_received");
        }
      },
      markRuntimeProgress: (kind) => this.callbacks.markRuntimeProgress(ctx, kind),
      refreshCancellationSignal: () => this.callbacks.refreshCancellationSignal(ctx),
      pollExternalInterruptAndSuspendIfNeeded: input.pollExternalInterruptAndSuspendIfNeeded,
      logEvent: ({ event, inspection }) => {
        if (input.verboseEventLogs) {
          const eventJson = JSON.stringify(event.properties || {});
          console.log("[OpenCode Event]", event.type, eventJson.slice(0, 200));
          return;
        }
        if (inspection.logEvent) {
          const modeSuffix = mode === "recovery_reattach" ? " mode=recovery_reattach" : "";
          console.info(
            `[OpenCode][EVENT] type=${event.type} generationId=${ctx.id} conversationId=${ctx.conversationId}${modeSuffix}`,
          );
        }
      },
      processTrackedEvent: async ({
        event,
        currentTextPart,
        currentTextPartId,
        setCurrentTextPart,
      }) => {
        return await this.processTrackedEvent({
          ctx,
          event,
          currentTextPart,
          currentTextPartId,
          setCurrentTextPart,
        });
      },
      handleActionableEvent: async (event) => {
        const normalized = await normalizeOpenCodeActionableEvent({
          event,
          client,
          autoApprove: ctx.autoApprove ?? false,
          logAutoApprove: ({ requestId, permissionType, patterns, reason }) => {
            console.log(
              "[GenerationManager] Auto-approving sandbox permission:",
              requestId,
              permissionType,
              patterns,
              reason === "conversation_auto_approve"
                ? "(conversation auto-approve enabled)"
                : "(allowlisted path)",
            );
          },
          logPermissionApproveError: (error) => {
            console.error("[GenerationManager] Failed to approve permission:", error);
          },
          logPermissionQueued: ({ requestId, permission, patterns }) => {
            console.log(
              "[GenerationManager] Surfacing permission request to UI:",
              requestId,
              permission,
              patterns,
            );
          },
        });
        return this.callbacks.handleActionableEvent(ctx, normalized, (request) =>
          sendOpenCodeRuntimeDecision(client, request),
        );
      },
      onIdle: input.onIdle,
      onSessionError: input.onSessionError,
    });
  }

  private async processTrackedEvent(input: {
    ctx: GenerationContext;
    event: OpenCodeTrackedEvent;
    currentTextPart: { type: "text"; text: string } | null;
    currentTextPartId: string | null;
    setCurrentTextPart: (
      part: { type: "text"; text: string } | null,
      partId: string | null,
    ) => void;
  }): Promise<RuntimeProgressKind | null> {
    return await this.translator.processEvent(input);
  }

  private appendSystemEvent(
    ctx: GenerationContext,
    event: { content: string; coworkerId?: string },
  ): void {
    ctx.contentParts.push({
      type: "system",
      content: event.content,
    });
    this.callbacks.broadcast(ctx, {
      type: "system",
      content: event.content,
      coworkerId: event.coworkerId,
    });
  }

  private applyCoworkerEditEnvelope(
    ctx: GenerationContext,
    envelope: NonNullable<ReturnType<typeof parseCoworkerEditApplyEnvelope>>,
  ): void {
    const coworkerId = envelope.coworkerId;

    if (envelope.status === "applied") {
      ctx.builderCoworkerContext = envelope.coworker;
      this.appendSystemEvent(ctx, { content: envelope.message, coworkerId });
      logServerEvent(
        "info",
        "COWORKER_EDIT_APPLIED",
        {
          coworkerId,
          changedFields: envelope.appliedChanges,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      return;
    }

    if (envelope.status === "conflict") {
      ctx.builderCoworkerContext = envelope.coworker;
      this.appendSystemEvent(ctx, { content: envelope.message, coworkerId });
      logServerEvent(
        "warn",
        "COWORKER_EDIT_CONFLICT",
        { coworkerId },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      return;
    }

    this.appendSystemEvent(ctx, {
      content: `${envelope.message}: ${envelope.details.join("; ")}`,
      coworkerId,
    });
    logServerEvent(
      "warn",
      "COWORKER_EDIT_VALIDATION_FAILED",
      { coworkerId, details: envelope.details },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );
  }
}
