import { createHash } from "node:crypto";
import { db } from "@cmdclaw/db/client";
import type { ContentPart } from "@cmdclaw/db/schema";
import { coworkerRun, generation } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import type {
  RuntimeHarnessClient,
  RuntimePermissionRequest,
  RuntimePromptPart,
  RuntimeQuestionRequest,
} from "../../../sandbox/core/types";
import type {
  OpenCodeActionableEvent,
  OpenCodeRuntimeToolRef,
} from "../../../runtime/opencode/opencode-event-translator";
import {
  handleOpenCodeActionableEvent as handleOpenCodeRuntimeActionableEvent,
  sendOpenCodeApprovalRuntimeDecision,
  updateOpenCodeToolPart,
  type OpenCodeApprovalCapableClient,
  type OpenCodeApprovalRuntimeRequest,
} from "../../../runtime/opencode/opencode-runtime-driver";
import { buildRuntimeEnvSourcedCommand } from "../../../execution/runtime-env";
import type { SandboxBackend } from "../../../sandbox/types";
import { conversationRuntimeService } from "../../conversation-runtime-service";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { GenerationEvent } from "../types";
import type {
  ApplyDecisionResult,
  ApplyDecisionToRuntimeInput,
  ExpireDecisionInput,
  ExpireDecisionResult,
  RequestDecisionInput,
  RequestDecisionResult,
  ResolveDecisionInput,
  ResolveDecisionResult,
} from "./decision-types";

const PARKED_INTERRUPT_TIMEOUT_MS = generationLifecyclePolicy.explicitPauseRetentionMs;

type DecisionGenerationRecord = NonNullable<
  Awaited<ReturnType<typeof db.query.generation.findFirst>>
>;

export type ActiveDecisionContext = {
  id: string;
  conversationId: string;
  coworkerRunId?: string | null;
  status?: string;
  currentInterruptId?: string;
  contentParts: ContentPart[];
  openCodeRuntimeTools: Map<string, OpenCodeRuntimeToolRef>;
  sessionId?: string;
};

type ParkedPluginWriteExecution =
  | { status: "completed"; output: string }
  | { status: "error"; error: string; outputForStream: unknown };

export type ParkedPluginWriteApplicationResult = {
  toolUseId: string;
  toolName: string;
  result: unknown;
  continuationText: string;
};

type DecisionFlowDependencies = {
  lifecycleStore: Pick<
    GenerationLifecycleStore,
    | "persistDecisionContentParts"
    | "resumeAfterDecision"
    | "cancelAfterAuthFailure"
    | "markCoworkerRunAwaitingAuth"
    | "markCoworkerRunAwaitingApproval"
    | "clearAppliedResumeInterrupt"
  >;
  getActiveRuntimeContext?: (generationId: string) => ActiveDecisionContext | null | undefined;
  getExecutionPolicy?: (
    generationRecord: DecisionGenerationRecord,
    defaultAutoApprove: boolean,
  ) => { autoApprove?: boolean | null };
  onPendingInterrupt?: (input: {
    generationId: string;
    conversationId: string;
    interrupt: GenerationInterruptRecord;
    event: GenerationEvent;
    kind: "approval" | "auth";
  }) => Promise<void> | void;
  onPluginApprovalResolved?: (input: {
    generationId: string;
    interrupt: GenerationInterruptRecord;
    decision: "allow" | "deny";
    contentParts: ContentPart[];
    event: GenerationEvent;
  }) => Promise<void> | void;
  onAuthResolved?: (input: {
    generationId: string;
    interrupt: GenerationInterruptRecord;
    event: GenerationEvent;
  }) => Promise<void> | void;
  resumeGeneration?: (generationId: string, userId: string) => Promise<boolean>;
  enqueueResolvedInterruptResume?: (input: {
    generationId: string;
    conversationId: string;
    interrupt: GenerationInterruptRecord;
    runType: "chat" | "coworker";
    coworkerRunId?: string;
    remainingRunMs?: number | null;
  }) => Promise<void>;
  enqueueConversationQueuedMessageProcess?: (conversationId: string) => Promise<void>;
  touchConversationLastUserVisibleAction?: (conversationId: string) => Promise<void>;
  processGenerationTimeout?: (
    generationId: string,
    kind: "approval" | "auth",
  ) => Promise<void>;
};

function computeParkedInterruptExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + PARKED_INTERRUPT_TIMEOUT_MS);
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function hashStableProviderRequestPayload(payload: unknown): string {
  return createHash("sha256").update(stableJsonStringify(payload)).digest("hex").slice(0, 24);
}

function extractOpenCodeCallIdFromProviderRequestId(
  providerRequestId: string | null | undefined,
): string | null {
  const marker = ":opencode:";
  if (!providerRequestId?.includes(marker)) {
    return null;
  }
  const callId = providerRequestId.slice(providerRequestId.lastIndexOf(marker) + marker.length);
  return callId.length > 0 ? callId : null;
}

export function getRuntimeToolRefForInterrupt(
  ctx: ActiveDecisionContext | null | undefined,
  params: {
    providerRequestId?: string | null;
    runtimeTool?: OpenCodeRuntimeToolRef;
    command: string;
  },
): OpenCodeRuntimeToolRef | undefined {
  if (params.runtimeTool) {
    return params.runtimeTool;
  }
  const callId = extractOpenCodeCallIdFromProviderRequestId(params.providerRequestId);
  if (callId) {
    const fromMap = ctx?.openCodeRuntimeTools.get(callId);
    if (fromMap) {
      return fromMap;
    }
  }
  const matchingToolUse = ctx?.contentParts.find(
    (part): part is ContentPart & { type: "tool_use" } =>
      part.type === "tool_use" &&
      typeof part.input.command === "string" &&
      part.input.command === params.command,
  );
  if (!matchingToolUse) {
    return undefined;
  }
  return ctx?.openCodeRuntimeTools.get(matchingToolUse.id);
}

export class DecisionFlow {
  constructor(private readonly dependencies: DecisionFlowDependencies) {}

  normalizeQuestionAnswers(questionAnswers?: string[][]): string[][] {
    return (
      questionAnswers
        ?.map((answers) =>
          answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
        )
        .filter((answers) => answers.length > 0) ?? []
    );
  }

  buildApprovalContentPart(input: {
    interrupt: GenerationInterruptRecord;
    decision: "approve" | "deny" | "allow";
    defaultIntegration: string;
    defaultOperation: string;
    questionAnswers?: string[][];
  }): Extract<ContentPart, { type: "approval" }> {
    const normalizedQuestionAnswers = this.normalizeQuestionAnswers(input.questionAnswers);
    return {
      type: "approval",
      tool_use_id: input.interrupt.providerToolUseId,
      tool_name: input.interrupt.display.title,
      tool_input: input.interrupt.display.toolInput ?? {},
      integration: input.interrupt.display.integration ?? input.defaultIntegration,
      operation: input.interrupt.display.operation ?? input.defaultOperation,
      command: input.interrupt.display.command,
      status: input.decision === "approve" || input.decision === "allow" ? "approved" : "denied",
      question_answers:
        normalizedQuestionAnswers.length > 0
          ? normalizedQuestionAnswers
          : input.interrupt.responsePayload?.questionAnswers,
    };
  }

  upsertApprovalContentPart(
    contentParts: ContentPart[],
    approvalPart: Extract<ContentPart, { type: "approval" }>,
  ): ContentPart[] {
    const nextContentParts = [...contentParts];
    const existingApprovalIndex = nextContentParts.findIndex(
      (part): part is ContentPart & { type: "approval" } =>
        part.type === "approval" && part.tool_use_id === approvalPart.tool_use_id,
    );
    if (existingApprovalIndex >= 0) {
      nextContentParts[existingApprovalIndex] = approvalPart;
    } else {
      nextContentParts.push(approvalPart);
    }
    return nextContentParts;
  }

  projectPendingEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return {
      type: "interrupt_pending",
      ...generationInterruptService.projectInterruptEvent(interrupt),
    };
  }

  projectResolvedEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return {
      type: "interrupt_resolved",
      ...generationInterruptService.projectInterruptEvent(interrupt),
    };
  }

  async request(_input: RequestDecisionInput): Promise<RequestDecisionResult> {
    if (_input.request.kind === "plugin_write") {
      const result = await this.requestPluginApproval(_input.generationId, {
        ..._input.request,
        runtimeTool: _input.request.runtimeTool as OpenCodeRuntimeToolRef | undefined,
      });
      if (result.decision === "allow") {
        return { outcome: "accepted" };
      }
      if (result.decision === "pending" && result.interruptId) {
        const interrupt = await generationInterruptService.getInterrupt(result.interruptId);
        if (interrupt) {
          return {
            outcome: "pending",
            interruptId: interrupt.id,
            expiresAt: interrupt.expiresAt ?? undefined,
            event: this.projectPendingEvent(interrupt),
          };
        }
      }
      return { outcome: "rejected", reason: "plugin_write_denied" };
    }

    if (_input.request.kind === "auth") {
      const result = await this.requestAuthInterrupt(_input.generationId, _input.request);
      if (result.status === "accepted") {
        return { outcome: "accepted" };
      }
      const interrupt = await generationInterruptService.getInterrupt(result.interruptId);
      if (!interrupt) {
        return { outcome: "rejected", reason: "interrupt_not_found" };
      }
      return {
        outcome: "pending",
        interruptId: interrupt.id,
        expiresAt: interrupt.expiresAt ?? undefined,
        event: this.projectPendingEvent(interrupt),
      };
    }

    if (_input.autoApprove) {
      return { outcome: "accepted" };
    }

    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, _input.generationId),
      with: { conversation: true },
    });
    if (!genRecord?.runtimeId) {
      return { outcome: "rejected", reason: "generation_runtime_missing" };
    }
    const runtimeRecord = await conversationRuntimeService.getRuntime(genRecord.runtimeId);
    if (!runtimeRecord) {
      return { outcome: "rejected", reason: "runtime_missing" };
    }

    const request = _input.request;
    const isQuestion = request.kind === "runtime_question";
    const interrupt = await generationInterruptService.createInterrupt({
      generationId: _input.generationId,
      runtimeId: runtimeRecord.id,
      conversationId: genRecord.conversationId,
      turnSeq: runtimeRecord.activeTurnSeq,
      kind: isQuestion ? "runtime_question" : "runtime_permission",
      display: {
        title: request.title,
        integration: request.kind === "runtime_permission" ? request.integration : undefined,
        operation: request.kind === "runtime_permission" ? request.operation : undefined,
        command: request.kind === "runtime_permission" ? request.command : undefined,
        toolInput: request.toolInput,
        questionSpec: request.kind === "runtime_question" ? { questions: request.questions } : undefined,
      },
      provider: "opencode",
      providerRequestId: request.providerRequestId,
      providerToolUseId: request.providerToolUseId,
      expiresAt: computeParkedInterruptExpiryDate(_input.now),
    });
    const event = this.projectPendingEvent(interrupt);
    await this.dependencies.onPendingInterrupt?.({
      generationId: _input.generationId,
      conversationId: genRecord.conversationId,
      interrupt,
      event,
      kind: "approval",
    });

    return {
      outcome: "pending",
      interruptId: interrupt.id,
      expiresAt: interrupt.expiresAt ?? undefined,
      event,
    };
  }

  async requestPluginApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
      providerRequestId?: string;
      runtimeTool?: OpenCodeRuntimeToolRef;
    },
  ): Promise<{
    decision: "allow" | "deny" | "pending";
    toolUseId?: string;
    interruptId?: string;
    expiresAt?: string;
  }> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord?.runtimeId) {
      return { decision: "deny" };
    }

    const policy = this.dependencies.getExecutionPolicy?.(
      genRecord,
      genRecord.conversation.autoApprove,
    );
    if (policy?.autoApprove ?? genRecord.conversation.autoApprove) {
      return { decision: "allow" };
    }
    const runtimeRecord = await conversationRuntimeService.getRuntime(genRecord.runtimeId);
    if (!runtimeRecord) {
      return { decision: "deny" };
    }

    const providerRequestId =
      request.providerRequestId ??
      `plugin-write:${runtimeRecord.id}:${runtimeRecord.activeTurnSeq}:${hashStableProviderRequestPayload(
        {
          integration: request.integration,
          operation: request.operation,
          command: request.command,
        },
      )}`;
    const existing = await generationInterruptService.findInterruptByProviderRequestId({
      generationId,
      providerRequestId,
    });
    if (existing) {
      if (existing.status === "accepted") {
        await generationInterruptService.markInterruptApplied(existing.id);
        return { decision: "allow" };
      }
      if (existing.status === "pending") {
        return {
          decision: "pending",
          toolUseId: existing.providerToolUseId,
          interruptId: existing.id,
          expiresAt: existing.expiresAt?.toISOString(),
        };
      }
      return { decision: "deny" };
    }

    const toolUseId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const activeCtx = this.dependencies.getActiveRuntimeContext?.(generationId);
    const runtimeTool = getRuntimeToolRefForInterrupt(activeCtx, {
      providerRequestId,
      runtimeTool: request.runtimeTool,
      command: request.command,
    });
    const interrupt = await generationInterruptService.createInterrupt({
      generationId,
      runtimeId: runtimeRecord.id,
      conversationId: genRecord.conversationId,
      turnSeq: runtimeRecord.activeTurnSeq,
      kind: "plugin_write",
      display: {
        title: "Bash",
        integration: request.integration,
        operation: request.operation,
        command: request.command,
        toolInput: request.toolInput,
        runtimeTool,
      },
      provider: "plugin",
      providerRequestId,
      providerToolUseId: toolUseId,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    const event = this.projectPendingEvent(interrupt);
    await this.dependencies.onPendingInterrupt?.({
      generationId,
      conversationId: genRecord.conversationId,
      interrupt,
      event,
      kind: "approval",
    });

    return {
      decision: "pending",
      toolUseId,
      interruptId: interrupt.id,
      expiresAt: interrupt.expiresAt?.toISOString(),
    };
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
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord?.runtimeId) {
      return { status: "accepted" };
    }

    const existing = await generationInterruptService.findPendingAuthInterruptByIntegration({
      generationId,
      integration: request.integration,
    });
    if (existing) {
      return {
        interruptId: existing.id,
        status: "pending",
        expiresAt: existing.expiresAt?.toISOString(),
      };
    }
    const runtimeRecord = await conversationRuntimeService.getRuntime(genRecord.runtimeId);
    if (!runtimeRecord) {
      return { status: "accepted" };
    }

    const interrupt = await generationInterruptService.createInterrupt({
      generationId,
      runtimeId: runtimeRecord.id,
      conversationId: genRecord.conversationId,
      turnSeq: runtimeRecord.activeTurnSeq,
      kind: "auth",
      display: {
        title: "Connection Required",
        authSpec: {
          integrations: [request.integration],
          reason: request.reason,
        },
      },
      provider: "plugin",
      providerToolUseId: `auth-${Date.now()}-${request.integration}`,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    if (linkedCoworkerRun?.id) {
      await this.dependencies.lifecycleStore.markCoworkerRunAwaitingAuth(linkedCoworkerRun.id);
    }

    await this.dependencies.onPendingInterrupt?.({
      generationId,
      conversationId: genRecord.conversationId,
      interrupt,
      event: this.projectPendingEvent(interrupt),
      kind: "auth",
    });

    return {
      interruptId: interrupt.id,
      status: "pending",
      expiresAt: interrupt.expiresAt?.toISOString(),
    };
  }

  async getPluginApprovalStatus(
    generationId: string,
    interruptId: string,
  ): Promise<"pending" | "allow" | "deny"> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    if (!genRecord || !interrupt || interrupt.generationId !== generationId) {
      return "deny";
    }

    if (interrupt.status === "pending") {
      if (interrupt.expiresAt) {
        const expiresAtMs = Date.parse(interrupt.expiresAt.toISOString());
        if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
          await this.dependencies.processGenerationTimeout?.(generationId, "approval");
          return "deny";
        }
      }
      return "pending";
    }

    const resolvedDecision = interrupt.status === "accepted" ? "allow" : "deny";
    const approvalPart = this.buildApprovalContentPart({
      interrupt,
      decision: resolvedDecision,
      defaultIntegration: "plugin",
      defaultOperation: "unknown",
    });

    const activeCtx = this.dependencies.getActiveRuntimeContext?.(generationId);
    const baseContentParts =
      activeCtx?.contentParts ?? (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = this.upsertApprovalContentPart(baseContentParts, approvalPart);
    if (activeCtx) {
      activeCtx.contentParts = nextContentParts;
    }

    await this.dependencies.lifecycleStore.persistDecisionContentParts({
      generationId,
      contentParts: nextContentParts,
    });

    const event = this.projectResolvedEvent(interrupt);
    await this.dependencies.onPluginApprovalResolved?.({
      generationId,
      interrupt,
      decision: resolvedDecision,
      contentParts: nextContentParts,
      event,
    });
    if (resolvedDecision === "allow") {
      await generationInterruptService.markInterruptApplied(interrupt.id);
    }

    return resolvedDecision;
  }

  async applyParkedPluginWrite(input: {
    interrupt: GenerationInterruptRecord;
    sandbox?: SandboxBackend;
    runtimeClient: RuntimeHarnessClient;
    runtimeTool: OpenCodeRuntimeToolRef;
  }): Promise<ParkedPluginWriteApplicationResult> {
    const execution = await this.executeApprovedParkedPluginWriteCommand({
      interrupt: input.interrupt,
      sandbox: input.sandbox,
    });
    const toolInput =
      input.interrupt.display.toolInput && typeof input.interrupt.display.toolInput === "object"
        ? (input.interrupt.display.toolInput as Record<string, unknown>)
        : input.runtimeTool.input;

    if (execution.status === "completed") {
      await updateOpenCodeToolPart(input.runtimeClient, input.runtimeTool, {
        status: "completed",
        input: toolInput,
        output: execution.output,
      });
      await generationInterruptService.markInterruptApplied(input.interrupt.id);
      return {
        toolUseId: input.runtimeTool.callId,
        toolName: input.runtimeTool.toolName,
        result: execution.output,
        continuationText:
          "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
      };
    }

    await updateOpenCodeToolPart(input.runtimeClient, input.runtimeTool, {
      status: "error",
      input: toolInput,
      error: execution.error,
    });
    await generationInterruptService.markInterruptApplied(input.interrupt.id);
    return {
      toolUseId: input.runtimeTool.callId,
      toolName: input.runtimeTool.toolName,
      result: execution.outputForStream,
      continuationText:
        "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
    };
  }

  private async executeApprovedParkedPluginWriteCommand(input: {
    interrupt: GenerationInterruptRecord;
    sandbox?: SandboxBackend;
  }): Promise<ParkedPluginWriteExecution> {
    if (input.interrupt.status !== "accepted") {
      const error = "User denied this integration write.";
      return { status: "error", error, outputForStream: { error } };
    }
    if (!input.sandbox) {
      const error =
        "Approved integration write could not run because the sandbox was not attached.";
      return { status: "error", error, outputForStream: { error } };
    }

    const command = input.interrupt.display.command;
    if (!command) {
      const error =
        "Approved integration write could not run because the saved command is missing.";
      return { status: "error", error, outputForStream: { error } };
    }
    const toolInput =
      input.interrupt.display.toolInput && typeof input.interrupt.display.toolInput === "object"
        ? (input.interrupt.display.toolInput as Record<string, unknown>)
        : {};
    const workdir = typeof toolInput.workdir === "string" ? toolInput.workdir : undefined;
    const result = await input.sandbox.execute(
      buildRuntimeEnvSourcedCommand({ command, workdir }),
      {
        timeout: 120_000,
      },
    );
    if (result.exitCode !== 0) {
      const errorText =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Approved command exited with status ${result.exitCode}`;
      return {
        status: "error",
        error: errorText,
        outputForStream: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    }

    return {
      status: "completed",
      output: result.stdout,
    };
  }

  async submitApproval(input: {
    generationId: string;
    toolUseId: string;
    decision: "approve" | "deny";
    userId: string;
    questionAnswers?: string[][];
  }): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, input.generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (genRecord.conversation.userId !== input.userId) {
      throw new Error("Access denied");
    }

    const interrupt = await generationInterruptService.findPendingInterruptByToolUseId({
      generationId: input.generationId,
      providerToolUseId: input.toolUseId,
    });
    if (!interrupt) {
      return false;
    }

    const normalizedQuestionAnswers = this.normalizeQuestionAnswers(input.questionAnswers);
    const approvalPart = this.buildApprovalContentPart({
      interrupt,
      decision: input.decision,
      defaultIntegration: "cmdclaw",
      defaultOperation: "question",
      questionAnswers: input.questionAnswers,
    });
    const activeCtx = this.dependencies.getActiveRuntimeContext?.(input.generationId);
    const baseContentParts =
      activeCtx?.contentParts ?? (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = this.upsertApprovalContentPart(baseContentParts, approvalPart);
    if (activeCtx) {
      activeCtx.contentParts = nextContentParts;
    }

    await this.dependencies.lifecycleStore.persistDecisionContentParts({
      generationId: input.generationId,
      contentParts: nextContentParts,
    });
    await this.dependencies.touchConversationLastUserVisibleAction?.(genRecord.conversationId);

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: interrupt.id,
      status: input.decision === "approve" ? "accepted" : "rejected",
      responsePayload:
        normalizedQuestionAnswers.length > 0
          ? { questionAnswers: normalizedQuestionAnswers }
          : undefined,
      resolvedByUserId: input.userId,
    });

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, input.generationId),
      columns: { id: true },
    });

    if (resolvedInterrupt) {
      await this.dependencies.onPluginApprovalResolved?.({
        generationId: input.generationId,
        interrupt: resolvedInterrupt,
        decision: input.decision === "approve" ? "allow" : "deny",
        contentParts: nextContentParts,
        event: this.projectResolvedEvent(resolvedInterrupt),
      });
    }

    if (genRecord.status === "paused") {
      return (await this.dependencies.resumeGeneration?.(input.generationId, input.userId)) ?? false;
    }

    if (!activeCtx && resolvedInterrupt) {
      await this.dependencies.enqueueResolvedInterruptResume?.({
        generationId: input.generationId,
        conversationId: genRecord.conversationId,
        interrupt: resolvedInterrupt,
        runType: linkedRun?.id ? "coworker" : "chat",
        coworkerRunId: linkedRun?.id,
        remainingRunMs: genRecord.remainingRunMs,
      });
      return true;
    }

    await this.dependencies.lifecycleStore.resumeAfterDecision({
      generationId: input.generationId,
      conversationId: genRecord.conversationId,
      coworkerRunId: linkedRun?.id,
      contentParts: nextContentParts,
      clearPendingApproval: true,
      clearPendingAuth: true,
    });

    return true;
  }

  async submitApprovalByInterrupt(input: {
    interruptId: string;
    decision: "approve" | "deny";
    userId: string;
    questionAnswers?: string[][];
  }): Promise<boolean> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    if (!interrupt || interrupt.kind === "auth" || interrupt.status !== "pending") {
      return false;
    }

    return this.submitApproval({
      generationId: interrupt.generationId,
      toolUseId: interrupt.providerToolUseId,
      decision: input.decision,
      userId: input.userId,
      questionAnswers: input.questionAnswers,
    });
  }

  async submitAuthResult(input: {
    generationId: string;
    integration: string;
    success: boolean;
    userId: string;
  }): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, input.generationId),
      with: { conversation: true },
    });

    if (!genRecord) {
      return false;
    }

    if (genRecord.conversation.userId !== input.userId) {
      throw new Error("Access denied");
    }

    const pendingInterrupt = await generationInterruptService.findPendingAuthInterruptByIntegration(
      {
        generationId: input.generationId,
        integration: input.integration,
      },
    );
    if (!pendingInterrupt) {
      return false;
    }

    const conversationId = genRecord.conversationId;
    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, input.generationId),
      columns: { id: true },
    });
    await this.dependencies.touchConversationLastUserVisibleAction?.(conversationId);

    if (!input.success) {
      await generationInterruptService.resolveInterrupt({
        interruptId: pendingInterrupt.id,
        status: "cancelled",
        responsePayload: { integration: input.integration },
        resolvedByUserId: input.userId,
      });
      await this.dependencies.lifecycleStore.cancelAfterAuthFailure({
        generationId: input.generationId,
        conversationId,
        coworkerRunId: linkedCoworkerRun?.id,
      });

      await this.dependencies.enqueueConversationQueuedMessageProcess?.(conversationId);

      return true;
    }

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: pendingInterrupt.id,
      status: "accepted",
      responsePayload: {
        connectedIntegrations: [input.integration],
        integration: input.integration,
      },
      resolvedByUserId: input.userId,
    });

    if (genRecord.status === "paused") {
      await this.dependencies.lifecycleStore.resumeAfterDecision({
        generationId: input.generationId,
        conversationId,
        coworkerRunId: linkedCoworkerRun?.id,
        clearPendingAuth: true,
      });
      if (resolvedInterrupt) {
        await this.dependencies.onAuthResolved?.({
          generationId: input.generationId,
          interrupt: resolvedInterrupt,
          event: this.projectResolvedEvent(resolvedInterrupt),
        });
      }
      return (await this.dependencies.resumeGeneration?.(input.generationId, input.userId)) ?? false;
    }

    const activeCtx = this.dependencies.getActiveRuntimeContext?.(input.generationId);
    if (!activeCtx && resolvedInterrupt) {
      await this.dependencies.enqueueResolvedInterruptResume?.({
        generationId: input.generationId,
        conversationId,
        interrupt: resolvedInterrupt,
        runType: linkedCoworkerRun?.id ? "coworker" : "chat",
        coworkerRunId: linkedCoworkerRun?.id,
        remainingRunMs: genRecord.remainingRunMs,
      });
      return true;
    }

    await this.dependencies.lifecycleStore.resumeAfterDecision({
      generationId: input.generationId,
      conversationId,
      coworkerRunId: linkedCoworkerRun?.id,
      clearPendingAuth: true,
    });

    if (resolvedInterrupt) {
      await this.dependencies.onAuthResolved?.({
        generationId: input.generationId,
        interrupt: resolvedInterrupt,
        event: this.projectResolvedEvent(resolvedInterrupt),
      });
    }

    return true;
  }

  async submitAuthResultByInterrupt(input: {
    interruptId: string;
    integration: string;
    success: boolean;
    userId: string;
  }): Promise<boolean> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    if (!interrupt || interrupt.kind !== "auth" || interrupt.status !== "pending") {
      return false;
    }

    return this.submitAuthResult({
      generationId: interrupt.generationId,
      integration: input.integration,
      success: input.success,
      userId: input.userId,
    });
  }

  async waitForApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
    },
  ): Promise<"allow" | "deny"> {
    const approvalRequest = await this.requestPluginApproval(generationId, request);
    if (approvalRequest.decision !== "pending") {
      return approvalRequest.decision;
    }
    if (!approvalRequest.toolUseId || !approvalRequest.interruptId) {
      return "deny";
    }

    let resolved: "allow" | "deny" | null = null;
    while (resolved === null) {
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      // eslint-disable-next-line no-await-in-loop -- polling by design
      const status = await this.getPluginApprovalStatus(generationId, approvalRequest.interruptId);
      if (status !== "pending") {
        resolved = status;
      }
    }

    return resolved ?? "deny";
  }

  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; userId?: string }> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return { success: false };
    }

    const authRequest = await this.requestAuthInterrupt(generationId, request);
    if (authRequest.status === "accepted") {
      return genRecord.conversation.userId
        ? { success: true, userId: genRecord.conversation.userId }
        : { success: false };
    }
    const interrupt = await generationInterruptService.getInterrupt(authRequest.interruptId);
    if (!interrupt) {
      return { success: false };
    }
    const expiresAt = authRequest.expiresAt;

    let resolved: { success: boolean; userId?: string } | null = null;
    while (resolved === null) {
      if (expiresAt && Date.now() >= Date.parse(expiresAt)) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));

      // eslint-disable-next-line no-await-in-loop -- polling by design
      const latest = await generationInterruptService.getInterrupt(interrupt.id);
      if (!latest) {
        resolved = { success: false };
        break;
      }
      if (latest.status === "accepted") {
        resolved = genRecord.conversation.userId
          ? { success: true, userId: genRecord.conversation.userId }
          : { success: false };
        break;
      }
      if (
        latest.status === "rejected" ||
        latest.status === "expired" ||
        latest.status === "cancelled"
      ) {
        resolved = { success: false };
        break;
      }
    }

    return resolved ?? { success: false };
  }

  async resolve(_input: ResolveDecisionInput): Promise<ResolveDecisionResult> {
    const interrupt = await generationInterruptService.getInterrupt(_input.interruptId);
    if (!interrupt || interrupt.status !== "pending") {
      return {
        generationId: interrupt?.generationId ?? "",
        conversationId: interrupt?.conversationId ?? "",
        resolved: false,
        shouldResume: false,
      };
    }

    const accepted =
      (_input.resolution.kind === "approval" && _input.resolution.decision === "approve") ||
      (_input.resolution.kind === "runtime_question" &&
        _input.resolution.decision === "approve") ||
      (_input.resolution.kind === "plugin_write" && _input.resolution.decision === "approve") ||
      (_input.resolution.kind === "auth" && _input.resolution.success);
    const responsePayload =
      _input.resolution.kind === "approval"
        ? { questionAnswers: this.normalizeQuestionAnswers(_input.resolution.questionAnswers) }
        : _input.resolution.kind === "runtime_question"
          ? { questionAnswers: this.normalizeQuestionAnswers(_input.resolution.answers) }
          : _input.resolution.kind === "auth"
            ? {
                connectedIntegrations: [_input.resolution.integration],
                integration: _input.resolution.integration,
              }
            : undefined;
    const resolved = await generationInterruptService.resolveInterrupt({
      interruptId: interrupt.id,
      status: accepted ? "accepted" : "rejected",
      responsePayload: accepted ? responsePayload : undefined,
      resolvedByUserId: _input.userId,
    });
    if (!resolved) {
      return {
        generationId: interrupt.generationId,
        conversationId: interrupt.conversationId,
        resolved: false,
        shouldResume: false,
      };
    }
    return {
      generationId: resolved.generationId,
      conversationId: resolved.conversationId,
      resolved: true,
      shouldResume: accepted,
      event: this.projectResolvedEvent(resolved),
    };
  }

  async expire(_input: ExpireDecisionInput): Promise<ExpireDecisionResult> {
    let interrupt: GenerationInterruptRecord | null = null;
    if (_input.interruptId) {
      interrupt = await generationInterruptService.getInterrupt(_input.interruptId);
    } else {
      const pending = await generationInterruptService.listPendingInterruptsForGeneration(
        _input.generationId,
      );
      interrupt =
        pending.find((candidate) => {
          if (!_input.kind) {
            return true;
          }
          if (_input.kind === "approval") {
            return (
              candidate.kind === "plugin_write" ||
              candidate.kind === "runtime_permission" ||
              candidate.kind === "runtime_question"
            );
          }
          return candidate.kind === _input.kind;
        }) ?? null;
    }

    if (!interrupt || interrupt.status !== "pending") {
      return { expired: false, shouldFinalize: false };
    }
    const expired = await generationInterruptService.resolveInterrupt({
      interruptId: interrupt.id,
      status: "expired",
    });
    return {
      expired: !!expired,
      generationId: expired?.generationId,
      shouldFinalize: !!expired,
      event: expired ? this.projectResolvedEvent(expired) : undefined,
    };
  }

  async applyToRuntime(_input: ApplyDecisionToRuntimeInput): Promise<ApplyDecisionResult> {
    const interrupt = await generationInterruptService.getInterrupt(_input.interruptId);
    if (!interrupt || interrupt.status === "pending") {
      return { applied: false };
    }
    await generationInterruptService.markInterruptApplied(interrupt.id);
    return { applied: true };
  }

  async waitForOpenCodeApprovalDecision(
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

  async applyOpenCodeApprovalDecision(input: {
    ctx: ActiveDecisionContext;
    interruptId: string;
    decision: "allow" | "deny";
    questionAnswers?: string[][];
    sendRuntimeDecision: (request: OpenCodeApprovalRuntimeRequest) => Promise<void>;
  }): Promise<GenerationInterruptRecord | null> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    const toolUseId = interrupt?.providerToolUseId ?? `opencode-${input.ctx.id}`;
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

    const normalizedQuestionAnswers = this.normalizeQuestionAnswers(input.questionAnswers);
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
      integration: interrupt?.display.integration ?? "opencode",
      operation: interrupt?.display.operation ?? "question",
      command: interrupt?.display.command,
      status: input.decision === "allow" ? "approved" : "denied",
      question_answers: resolvedQuestionAnswers,
    };
    input.ctx.contentParts = this.upsertApprovalContentPart(
      input.ctx.contentParts,
      approvalPart,
    );

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: input.interruptId,
      status: input.decision === "allow" ? "accepted" : "rejected",
      responsePayload:
        input.decision === "allow" ? { questionAnswers: resolvedQuestionAnswers } : undefined,
    });

    await this.dependencies.lifecycleStore.resumeAfterDecision({
      generationId: input.ctx.id,
      conversationId: input.ctx.conversationId,
      coworkerRunId: input.ctx.coworkerRunId ?? undefined,
      contentParts: input.ctx.contentParts,
      clearPendingApproval: true,
    });

    input.ctx.currentInterruptId = undefined;
    input.ctx.status = "running";
    if (resolvedInterrupt) {
      await this.dependencies.onPluginApprovalResolved?.({
        generationId: input.ctx.id,
        interrupt: resolvedInterrupt,
        decision: input.decision,
        contentParts: input.ctx.contentParts,
        event: this.projectResolvedEvent(resolvedInterrupt),
      });
    }
    return resolvedInterrupt ?? null;
  }

  buildResumedAuthContinuationPrompt(interrupt: GenerationInterruptRecord): RuntimePromptPart[] {
    const integration = interrupt.display.authSpec?.integrations?.[0] ?? "the required";
    return [
      {
        type: "text",
        text: `Continue the interrupted assistant turn. Authentication for ${integration} is now complete.`,
      },
    ];
  }

  buildResumedRuntimeQuestionContinuationPrompt(
    interrupt: GenerationInterruptRecord,
  ): RuntimePromptPart[] {
    const flattenedAnswers =
      interrupt.responsePayload?.questionAnswers?.flatMap((answers) =>
        answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
      ) ?? [];
    const answerSummary =
      flattenedAnswers.length > 0
        ? ` The resolved answer was: ${flattenedAnswers.join(", ")}.`
        : "";
    return [
      {
        type: "text",
        text: `Continue the interrupted assistant turn. The pending question has been answered.${answerSummary}`,
      },
    ];
  }

  async applyResolvedInterruptToRuntime(input: {
    ctx: ActiveDecisionContext & {
      resumeInterruptId?: string | null;
      currentInterruptId?: string;
    };
    interruptId: string;
    sendOpenCodeDecision: (request: OpenCodeApprovalRuntimeRequest) => Promise<void>;
    broadcastResolvedEvent: (event: GenerationEvent) => void;
  }): Promise<void> {
    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    if (!interrupt) {
      throw new Error(`Resume interrupt ${input.interruptId} was not found`);
    }
    if (interrupt.status === "pending") {
      throw new Error(`Resume interrupt ${input.interruptId} is still pending`);
    }

    if (interrupt.provider === "opencode") {
      await this.applyOpenCodeApprovalDecision({
        ctx: input.ctx,
        interruptId: interrupt.id,
        decision: interrupt.status === "accepted" ? "allow" : "deny",
        questionAnswers: interrupt.responsePayload?.questionAnswers,
        sendRuntimeDecision: input.sendOpenCodeDecision,
      });
      await generationInterruptService.markInterruptApplied(interrupt.id);
    } else {
      input.broadcastResolvedEvent(this.projectResolvedEvent(interrupt));
    }

    input.ctx.resumeInterruptId = null;
    input.ctx.currentInterruptId = undefined;
    await this.dependencies.lifecycleStore.clearAppliedResumeInterrupt(input.ctx.id);
  }

  async handleOpenCodeActionableEvent(input: {
    ctx: ActiveDecisionContext & {
      runtimeId?: string | null;
      runtimeTurnSeq?: number | null;
      autoApprove?: boolean;
    };
    client: OpenCodeApprovalCapableClient;
    event: OpenCodeActionableEvent;
    hotWaitMs: number;
    timeoutMs: number;
    saveProgress: () => Promise<void>;
    broadcast: (event: GenerationEvent) => void;
    parkForInterrupt: (interrupt: GenerationInterruptRecord) => Promise<void>;
  }): Promise<{ type: "none" | "permission" | "question" }> {
    const result = await handleOpenCodeRuntimeActionableEvent({
      event: input.event,
      client: input.client,
      autoApprove: input.ctx.autoApprove ?? false,
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

    if (result.type === "none") {
      return { type: "none" };
    }

    if (result.type === "permission") {
      if (result.action === "queue") {
        const interrupt = await this.requestOpenCodeApproval({
          ctx: input.ctx,
          openCodeRequest: {
            kind: "permission",
            request: result.request,
          },
          pendingApproval: result.pendingApproval,
        });
        input.broadcast(this.projectPendingEvent(interrupt));
        const resolved = await this.waitForOpenCodeApprovalDecision(
          interrupt.id,
          input.hotWaitMs,
          input.timeoutMs,
        );
        if (!resolved) {
          await input.parkForInterrupt(interrupt);
        } else {
          await this.applyOpenCodeApprovalDecision({
            ctx: input.ctx,
            interruptId: interrupt.id,
            decision: resolved.decision,
            questionAnswers: resolved.questionAnswers,
            sendRuntimeDecision: (request) =>
              sendOpenCodeApprovalRuntimeDecision(input.client, request),
          });
        }
      }
      return { type: "permission" };
    }

    const existingToolUse = input.ctx.contentParts.find(
      (part): part is ContentPart & { type: "tool_use" } =>
        part.type === "tool_use" && part.id === result.toolUseId,
    );
    if (!existingToolUse) {
      input.broadcast({
        type: "tool_use",
        toolName: "question",
        toolInput: result.toolInput,
        toolUseId: result.toolUseId,
        integration: "cmdclaw",
        operation: "question",
      });

      input.ctx.contentParts.push({
        type: "tool_use",
        id: result.toolUseId,
        name: "question",
        input: result.toolInput,
        integration: "cmdclaw",
        operation: "question",
      });
      await input.saveProgress();
    }

    const interrupt = await this.requestOpenCodeApproval({
      ctx: input.ctx,
      openCodeRequest: {
        kind: "question",
        request: result.request,
        defaultAnswers: result.defaultAnswers,
      },
      pendingApproval: result.pendingApproval,
    });
    input.broadcast(this.projectPendingEvent(interrupt));
    const resolved = await this.waitForOpenCodeApprovalDecision(
      interrupt.id,
      input.hotWaitMs,
      input.timeoutMs,
    );
    if (!resolved) {
      await input.parkForInterrupt(interrupt);
    } else {
      await this.applyOpenCodeApprovalDecision({
        ctx: input.ctx,
        interruptId: interrupt.id,
        decision: resolved.decision,
        questionAnswers: resolved.questionAnswers,
        sendRuntimeDecision: (request) => sendOpenCodeApprovalRuntimeDecision(input.client, request),
      });
    }
    return { type: "question" };
  }

  async requestOpenCodeApproval(input: {
    ctx: ActiveDecisionContext & {
      runtimeId?: string | null;
      runtimeTurnSeq?: number | null;
    };
    openCodeRequest:
      | { kind: "permission"; request: RuntimePermissionRequest }
      | { kind: "question"; request: RuntimeQuestionRequest; defaultAnswers: string[][] };
    pendingApproval: {
      toolUseId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      integration?: string;
      operation?: string;
      command?: string;
    };
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
        input.openCodeRequest.kind === "question"
          ? "runtime_question"
          : "runtime_permission",
      display: {
        title: input.pendingApproval.toolName,
        integration: input.pendingApproval.integration,
        operation: input.pendingApproval.operation,
        command: input.pendingApproval.command,
        toolInput: input.pendingApproval.toolInput,
        questionSpec:
          input.openCodeRequest.kind === "question"
            ? {
                questions: input.openCodeRequest.request.questions.map((question) => ({
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
      provider: "opencode",
      providerRequestId: input.openCodeRequest.request.id,
      providerToolUseId: input.pendingApproval.toolUseId,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    input.ctx.status = "awaiting_approval";
    input.ctx.currentInterruptId = interrupt.id;

    if (input.ctx.coworkerRunId) {
      await this.dependencies.lifecycleStore.markCoworkerRunAwaitingApproval(
        input.ctx.coworkerRunId,
      );
    }

    return interrupt;
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
