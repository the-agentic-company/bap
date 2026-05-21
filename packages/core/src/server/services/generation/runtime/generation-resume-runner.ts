import type { ContentPart } from "@cmdclaw/db/schema";
import { limitToolResultContent } from "../../../runtime/opencode/opencode-event-translator";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { DecisionFlow } from "../decisions/decision-flow";
import type { OpenCodeRecoveryReattachOptions } from "./opencode-recovery-runner";
import type { GenerationContext, GenerationEvent } from "../types";
import type { GenerationContextState } from "./generation-context-state";

type GenerationResumeRunnerDependencies = {
  lifecycleStore: GenerationLifecycleStore;
  decisionFlow: DecisionFlow;
  contextState: GenerationContextState;
  runOpenCodeGeneration(ctx: GenerationContext): Promise<void>;
  runRecoveryReattach(
    ctx: GenerationContext,
    options?: OpenCodeRecoveryReattachOptions,
  ): Promise<void>;
  finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error",
  ): Promise<void>;
  saveProgress(ctx: GenerationContext): Promise<void>;
  broadcast(ctx: GenerationContext, event: GenerationEvent): void;
};

export class GenerationResumeRunner {
  constructor(private readonly deps: GenerationResumeRunnerDependencies) {}

  async runSuspendedInterruptResume(ctx: GenerationContext): Promise<void> {
    const interruptId = ctx.resumeInterruptId;
    if (!interruptId) {
      await this.deps.runOpenCodeGeneration(ctx);
      return;
    }
    const interrupt =
      await generationInterruptService.getInterrupt(interruptId);

    this.deps.contextState.resumeDeadlineFromRemainingBudget(ctx);
    ctx.status = "running";
    ctx.suspendedAt = null;
    const shouldResumeOpenCodeInterrupt = interrupt?.provider === "opencode";
    if (!shouldResumeOpenCodeInterrupt) {
      ctx.resumeInterruptId = null;
    }
    await this.deps.lifecycleStore.markSuspendedInterruptResumeRunning({
      generationId: ctx.id,
      deadlineAt: ctx.deadlineAt,
      resumeInterruptId: shouldResumeOpenCodeInterrupt
        ? (ctx.resumeInterruptId ?? null)
        : null,
    });

    if (!shouldResumeOpenCodeInterrupt) {
      if (interrupt?.kind === "plugin_write") {
        await this.runParkedPluginWriteResume(ctx, interrupt);
        return;
      }
      await this.deps.runRecoveryReattach(ctx, {
        allowSnapshotRestore: true,
        requireLiveSession: false,
        resumeInterruptId: interruptId,
        modeLabel: "resume_interrupt",
        onRuntimeAttached:
          interrupt?.kind === "auth"
            ? async () =>
                this.deps.decisionFlow.buildResumedAuthContinuationPrompt(
                  interrupt,
                )
            : undefined,
      });
      return;
    }

    await this.deps.runRecoveryReattach(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      resumeInterruptId: interruptId,
      modeLabel: "resume_interrupt",
      onRuntimeAttached:
        interrupt?.kind === "runtime_question"
          ? async () =>
              this.deps.decisionFlow.buildResumedRuntimeQuestionContinuationPrompt(
                interrupt,
              )
          : undefined,
    });
  }

  private async runParkedPluginWriteResume(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<void> {
    const runtimeTool = interrupt.display.runtimeTool;
    if (!runtimeTool?.messageId || !runtimeTool.partId || !runtimeTool.callId) {
      this.deps.contextState.setCompletionReason(ctx, "broken_runtime_state");
      ctx.errorMessage =
        "The approved integration write could not be resumed because its runtime tool identity was not saved.";
      await this.deps.finishGeneration(ctx, "error");
      return;
    }

    await this.deps.runRecoveryReattach(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      modeLabel: "resume_plugin_write",
      onRuntimeAttached: async (runtimeClient) => {
        const application = await this.deps.decisionFlow.applyParkedPluginWrite(
          {
            runtimeClient,
            interrupt,
            sandbox: ctx.sandbox,
            runtimeTool,
          },
        );
        this.appendInjectedToolResult(ctx, application);
        await this.deps.saveProgress(ctx);
        return [
          {
            type: "text",
            text: application.continuationText,
          },
        ];
      },
    });
  }

  private appendInjectedToolResult(
    ctx: GenerationContext,
    params: {
      toolUseId: string;
      toolName: string;
      result: unknown;
    },
  ): void {
    const existingToolResult = ctx.contentParts.some(
      (part): part is ContentPart & { type: "tool_result" } =>
        part.type === "tool_result" && part.tool_use_id === params.toolUseId,
    );
    if (existingToolResult) {
      return;
    }

    const result = limitToolResultContent(params.result);
    this.deps.broadcast(ctx, {
      type: "tool_result",
      toolName: params.toolName,
      result,
      toolUseId: params.toolUseId,
    });
    ctx.contentParts.push({
      type: "tool_result",
      tool_use_id: params.toolUseId,
      content: result,
    });
  }
}
