import type { ContentPart } from "@bap/db/schema";
import {
  type RuntimeActionableEvent,
  type RuntimeApprovalRequest,
  type RuntimePermissionRequest,
  type RuntimeQuestionRequest,
} from "../../../runtime/runtime-driver";
import {
  buildRuntimePermissionPendingApproval,
  buildRuntimeQuestionPendingApproval,
  buildRuntimeQuestionToolUseEvent,
  isRuntimeInterruptProvider,
  RUNTIME_INTERRUPT_PROVIDER,
  type RuntimePendingApprovalDisplay,
} from "../../../runtime/runtime-decision-display";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import { GenerationSuspendedError } from "../core/turn-suspension";
import type { GenerationEvent } from "../types";
import {
  normalizeQuestionAnswers,
  projectPendingDecisionEvent,
  projectResolvedDecisionEvent,
  upsertApprovalContentPart,
} from "./approval-projection";
import { computeParkedInterruptExpiryDate, type ActiveDecisionContext } from "./decision-shared";

type RuntimeDecisionRelayDependencies = {
  lifecycleStore: Pick<
    GenerationLifecycleStore,
    "resumeAfterDecision" | "clearAppliedResumeInterrupt" | "markCoworkerRunAwaitingApproval"
  >;
  onPluginApprovalResolved?: (input: {
    generationId: string;
    interrupt: GenerationInterruptRecord;
    decision: "allow" | "deny";
    contentParts: ContentPart[];
    event: GenerationEvent;
  }) => Promise<void> | void;
  /**
   * The hot-wait used by `handleRuntimeActionableEvent`. Routed through the
   * owning facade so a caller that overrides the facade's
   * `waitForRuntimeApprovalDecision` (e.g. a test) is honoured. Defaults to this
   * relay's own `waitForRuntimeApprovalDecision`.
   */
  waitForDecision?: (
    interruptId: string,
    maxWaitMs: number,
    timeoutMs: number,
  ) => Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null>;
};

/**
 * Owns the runtime permission/question decision lifecycle for a Generation: it
 * requests a runtime approval, waits (hot) for the user's decision, parks or
 * applies that decision, relays it back to the runtime driver, and re-enters
 * the interrupted assistant turn. The interface is the small set of public
 * methods below; everything about content-part upserts, runtime reply shaping,
 * and expiry math is hidden behind it.
 */
export class RuntimeDecisionRelay {
  constructor(private readonly deps: RuntimeDecisionRelayDependencies) {}

  async waitForRuntimeApprovalDecision(
    interruptId: string,
    maxWaitMs: number,
    timeoutMs = generationLifecyclePolicy.approvalTimeoutMs,
  ): Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null> {
    const deadlineMs = Date.now() + maxWaitMs;
    while (true) {
      if (Date.now() >= deadlineMs) {
        return null;
      }
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      const latest = await generationInterruptService.getInterrupt(interruptId);
      if (!latest) {
        return { decision: "deny" };
      }

      const expiresAtMs = this.resolveExpiryMs(
        latest.expiresAt?.toISOString(),
        latest.requestedAt.toISOString(),
        timeoutMs,
      );
      if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
        return null;
      }

      if (latest.status === "accepted") {
        return {
          decision: "allow",
          questionAnswers: latest.responsePayload?.questionAnswers,
        };
      }
      if (
        latest.status === "rejected" ||
        latest.status === "cancelled" ||
        latest.status === "expired"
      ) {
        return { decision: "deny" };
      }
    }
  }

  private hotWaitForDecision(
    interruptId: string,
    maxWaitMs: number,
    timeoutMs: number,
  ): Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null> {
    return this.deps.waitForDecision
      ? this.deps.waitForDecision(interruptId, maxWaitMs, timeoutMs)
      : this.waitForRuntimeApprovalDecision(interruptId, maxWaitMs, timeoutMs);
  }

  async applyRuntimeApprovalDecision(input: {
    ctx: ActiveDecisionContext;
    interruptId: string;
    decision: "allow" | "deny";
    questionAnswers?: string[][];
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>;
  }): Promise<GenerationInterruptRecord | null> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    const toolUseId = interrupt?.providerToolUseId ?? `runtime-${input.ctx.id}`;
    const requestKind =
      interrupt?.kind === "runtime_permission"
        ? "permission"
        : interrupt?.kind === "runtime_question"
          ? "question"
          : undefined;
    const requestId = interrupt?.providerRequestId;
    if (!requestKind || !requestId) {
      return null;
    }

    const defaultAnswers = interrupt?.display.questionSpec?.questions.map((question) => [
      question.options[0]?.label ?? "default answer",
    ]) ?? [[]];

    if (requestKind === "permission") {
      await input.sendRuntimeDecision({
        kind: "permission",
        requestId,
        reply: input.decision === "allow" ? "always" : "reject",
      });
    } else if (input.decision === "allow") {
      await input.sendRuntimeDecision({
        kind: "question",
        requestId,
        answers:
          input.questionAnswers && input.questionAnswers.length > 0
            ? input.questionAnswers
            : defaultAnswers,
      });
    } else {
      await input.sendRuntimeDecision({
        kind: "question",
        requestId,
        reject: true,
      });
    }

    const normalizedQuestionAnswers = normalizeQuestionAnswers(input.questionAnswers);
    const resolvedQuestionAnswers =
      input.decision === "allow"
        ? normalizedQuestionAnswers.length > 0
          ? normalizedQuestionAnswers
          : defaultAnswers
        : undefined;
    const approvalPart: ContentPart = {
      type: "approval",
      tool_use_id: toolUseId,
      tool_name: interrupt?.display.title ?? "question",
      tool_input: interrupt?.display.toolInput ?? {},
      integration: interrupt?.display.integration ?? "runtime",
      operation: interrupt?.display.operation ?? "question",
      command: interrupt?.display.command,
      status: input.decision === "allow" ? "approved" : "denied",
      question_answers: resolvedQuestionAnswers,
    };
    input.ctx.contentParts = upsertApprovalContentPart(input.ctx.contentParts, approvalPart);

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: input.interruptId,
      status: input.decision === "allow" ? "accepted" : "rejected",
      responsePayload:
        input.decision === "allow" ? { questionAnswers: resolvedQuestionAnswers } : undefined,
    });

    await this.deps.lifecycleStore.resumeAfterDecision({
      generationId: input.ctx.id,
      conversationId: input.ctx.conversationId,
      coworkerRunId: input.ctx.coworkerRunId ?? undefined,
      contentParts: input.ctx.contentParts,
      clearPendingApproval: true,
    });

    input.ctx.currentInterruptId = undefined;
    input.ctx.status = "running";
    if (resolvedInterrupt) {
      await this.deps.onPluginApprovalResolved?.({
        generationId: input.ctx.id,
        interrupt: resolvedInterrupt,
        decision: input.decision,
        contentParts: input.ctx.contentParts,
        event: projectResolvedDecisionEvent(resolvedInterrupt),
      });
    }
    return resolvedInterrupt ?? null;
  }

  async applyResolvedInterruptToRuntime(input: {
    ctx: ActiveDecisionContext & {
      resumeInterruptId?: string | null;
      currentInterruptId?: string;
    };
    interruptId: string;
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>;
    broadcastResolvedEvent: (event: GenerationEvent) => void;
  }): Promise<void> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    if (!interrupt) {
      throw new Error(`Resume interrupt ${input.interruptId} was not found`);
    }
    if (interrupt.status === "pending") {
      throw new Error(`Resume interrupt ${input.interruptId} is still pending`);
    }

    if (isRuntimeInterruptProvider(interrupt.provider)) {
      await this.applyRuntimeApprovalDecision({
        ctx: input.ctx,
        interruptId: interrupt.id,
        decision: interrupt.status === "accepted" ? "allow" : "deny",
        questionAnswers: interrupt.responsePayload?.questionAnswers,
        sendRuntimeDecision: input.sendRuntimeDecision,
      });
      await generationInterruptService.markInterruptApplied(interrupt.id);
    } else {
      input.broadcastResolvedEvent(projectResolvedDecisionEvent(interrupt));
    }

    input.ctx.resumeInterruptId = null;
    input.ctx.currentInterruptId = undefined;
    await this.deps.lifecycleStore.clearAppliedResumeInterrupt(input.ctx.id);
  }

  async handleRuntimeActionableEvent(input: {
    ctx: ActiveDecisionContext & {
      runtimeId?: string | null;
      runtimeTurnSeq?: number | null;
      autoApprove?: boolean;
    };
    event: RuntimeActionableEvent;
    hotWaitMs: number;
    timeoutMs: number;
    saveProgress: () => Promise<void>;
    broadcast: (event: GenerationEvent) => void;
    parkForInterrupt: (interrupt: GenerationInterruptRecord) => Promise<void>;
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>;
  }): Promise<{ type: "none" | "permission" | "question" }> {
    if (input.event.type === "none") {
      return { type: "none" };
    }

    if (input.event.type === "permission") {
      const pendingApproval = buildRuntimePermissionPendingApproval(input.event.request);
      const interrupt = await this.requestRuntimeApproval({
        ctx: input.ctx,
        runtimeRequest: {
          kind: "permission",
          request: input.event.request,
        },
        pendingApproval,
      });
      input.broadcast(projectPendingDecisionEvent(interrupt));
      const resolved = await this.hotWaitForDecision(
        interrupt.id,
        input.hotWaitMs,
        input.timeoutMs,
        );
      if (!resolved) {
        await this.parkRuntimeInterruptOrApplyResolvedDecision({
          interrupt,
          ctx: input.ctx,
          parkForInterrupt: input.parkForInterrupt,
          sendRuntimeDecision: input.sendRuntimeDecision,
        });
      } else {
        await this.applyRuntimeApprovalDecision({
          ctx: input.ctx,
          interruptId: interrupt.id,
          decision: resolved.decision,
          questionAnswers: resolved.questionAnswers,
          sendRuntimeDecision: input.sendRuntimeDecision,
        });
      }
      return { type: "permission" };
    }

    const { display: pendingApproval, defaultAnswers } = buildRuntimeQuestionPendingApproval(
      input.event.request,
    );
    const toolUseId = pendingApproval.toolUseId;
    const toolInput = pendingApproval.toolInput;
    const existingToolUse = input.ctx.contentParts.find(
      (part): part is ContentPart & { type: "tool_use" } =>
        part.type === "tool_use" && part.id === toolUseId,
    );
    if (!existingToolUse) {
      input.broadcast({
        type: "tool_use",
        ...buildRuntimeQuestionToolUseEvent({ toolUseId, toolInput }),
      });

      input.ctx.contentParts.push({
        type: "tool_use",
        id: toolUseId,
        name: "question",
        input: toolInput,
        integration: pendingApproval.integration,
        operation: pendingApproval.operation,
      });
      await input.saveProgress();
    }

    const interrupt = await this.requestRuntimeApproval({
      ctx: input.ctx,
      runtimeRequest: {
        kind: "question",
        request: input.event.request,
        defaultAnswers,
      },
      pendingApproval,
    });
    input.broadcast(projectPendingDecisionEvent(interrupt));
    const resolved = await this.hotWaitForDecision(
      interrupt.id,
      input.hotWaitMs,
      input.timeoutMs,
      );
    if (!resolved) {
      await this.parkRuntimeInterruptOrApplyResolvedDecision({
        interrupt,
        ctx: input.ctx,
        parkForInterrupt: input.parkForInterrupt,
        sendRuntimeDecision: input.sendRuntimeDecision,
      });
    } else {
      await this.applyRuntimeApprovalDecision({
        ctx: input.ctx,
        interruptId: interrupt.id,
        decision: resolved.decision,
        questionAnswers: resolved.questionAnswers,
        sendRuntimeDecision: input.sendRuntimeDecision,
      });
    }
    return { type: "question" };
  }

  async requestRuntimeApproval(input: {
    ctx: ActiveDecisionContext & {
      runtimeId?: string | null;
      runtimeTurnSeq?: number | null;
    };
    runtimeRequest:
      | { kind: "permission"; request: RuntimePermissionRequest }
      | { kind: "question"; request: RuntimeQuestionRequest; defaultAnswers: string[][] };
    pendingApproval: RuntimePendingApprovalDisplay;
  }): Promise<GenerationInterruptRecord> {
    if (!input.ctx.runtimeId || !input.ctx.runtimeTurnSeq) {
      throw new Error(`Missing runtime binding for generation ${input.ctx.id}`);
    }
    const interrupt = await generationInterruptService.createInterrupt({
      generationId: input.ctx.id,
      runtimeId: input.ctx.runtimeId,
      conversationId: input.ctx.conversationId,
      turnSeq: input.ctx.runtimeTurnSeq,
      kind:
        input.runtimeRequest.kind === "question" ? "runtime_question" : "runtime_permission",
      display: {
        title: input.pendingApproval.toolName,
        integration: input.pendingApproval.integration,
        operation: input.pendingApproval.operation,
        command: input.pendingApproval.command,
        toolInput: input.pendingApproval.toolInput,
        questionSpec:
          input.runtimeRequest.kind === "question"
            ? {
                questions: input.runtimeRequest.request.questions.map((question) => ({
                  header: question.header,
                  question: question.question,
                  options: (question.options ?? []).map((option) => ({
                    label: option.label,
                    description: option.description,
                  })),
                  multiple: question.multiple === true ? true : undefined,
                  custom: question.custom === true ? true : undefined,
                })),
              }
            : undefined,
      },
      provider: RUNTIME_INTERRUPT_PROVIDER,
      providerRequestId: input.runtimeRequest.request.id,
      providerToolUseId: input.pendingApproval.toolUseId,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    input.ctx.status = "awaiting_approval";
    input.ctx.currentInterruptId = interrupt.id;

    if (input.ctx.coworkerRunId) {
      await this.deps.lifecycleStore.markCoworkerRunAwaitingApproval(input.ctx.coworkerRunId);
    }

    return interrupt;
  }

  private async parkRuntimeInterruptOrApplyResolvedDecision(input: {
    interrupt: GenerationInterruptRecord;
    ctx: ActiveDecisionContext;
    parkForInterrupt: (interrupt: GenerationInterruptRecord) => Promise<void>;
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>;
  }): Promise<void> {
    try {
      await input.parkForInterrupt(input.interrupt);
    } catch (error) {
      if (!(error instanceof GenerationSuspendedError)) {
        throw error;
      }

      const latest = await generationInterruptService.getInterrupt(input.interrupt.id);
      if (!latest || latest.status === "pending") {
        throw error;
      }

      await this.applyRuntimeApprovalDecision({
        ctx: input.ctx,
        interruptId: latest.id,
        decision: latest.status === "accepted" ? "allow" : "deny",
        questionAnswers: latest.responsePayload?.questionAnswers,
        sendRuntimeDecision: input.sendRuntimeDecision,
      });
    }
  }

  private resolveExpiryMs(
    expiresAt: string | undefined,
    requestedAt: string | undefined,
    timeoutMs: number,
  ): number {
    const explicit = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    if (Number.isFinite(explicit)) {
      return explicit;
    }
    const requested = requestedAt ? Date.parse(requestedAt) : Number.NaN;
    if (Number.isFinite(requested)) {
      return requested + timeoutMs;
    }
    return Date.now() + timeoutMs;
  }
}
