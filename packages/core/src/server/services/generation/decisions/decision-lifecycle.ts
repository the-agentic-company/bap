import { db } from "@bap/db/client";
import type { ContentPart } from "@bap/db/schema";
import { coworkerRun, generation } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import type { RuntimeToolRef } from "../../../runtime/runtime-driver";
import { RUNTIME_INTERRUPT_PROVIDER } from "../../../runtime/runtime-decision-display";
import type { SandboxBackend } from "../../../sandbox/types";
import { conversationRuntimeService } from "../../conversation-runtime-service";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type { GenerationStatus } from "../types";
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
import {
  buildApprovalContentPart,
  normalizeQuestionAnswers,
  projectPendingDecisionEvent,
  projectResolvedDecisionEvent,
  upsertApprovalContentPart,
} from "./approval-projection";
import {
  computeExpiryIso,
  computeParkedInterruptExpiryDate,
  getRuntimeToolRefForInterrupt,
  hashStableProviderRequestPayload,
  type DecisionExecutionPolicy,
  type DecisionFlowDependencies,
  type ParkedPluginWriteApplicationResult,
} from "./decision-shared";
import { applyParkedPluginWrite } from "./parked-plugin-write";

const APPROVAL_TIMEOUT_MS = generationLifecyclePolicy.approvalTimeoutMs;
const AUTH_TIMEOUT_MS = generationLifecyclePolicy.authTimeoutMs;

/**
 * Owns the durable plugin-write, integration-auth, and user-approval decision
 * lifecycle for a Generation: creating the pending interrupt, polling/waiting
 * for the human's decision, persisting the resulting content part, resolving
 * the interrupt, and re-entering the run (or enqueuing a detached resume). The
 * interface is its public methods; all the database coordination and
 * lifecycle-store sequencing is hidden behind it.
 */
export class PluginAuthDecisionLifecycle {
  constructor(private readonly dependencies: DecisionFlowDependencies) {}

  async resumeGeneration(generationId: string, userId: string): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (
      !genRecord.conversation.userId ||
      genRecord.conversation.userId !== userId
    ) {
      throw new Error("Access denied");
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return false;
    }

    let pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(
        generationId,
      );
    if (pendingInterrupt) {
      pendingInterrupt =
        (await generationInterruptService.refreshInterruptExpiry(
          pendingInterrupt.id,
          new Date(
            pendingInterrupt.kind === "auth"
              ? computeExpiryIso(AUTH_TIMEOUT_MS)
              : computeExpiryIso(APPROVAL_TIMEOUT_MS),
          ),
        )) ?? pendingInterrupt;
    }
    const nextStatus: GenerationStatus = pendingInterrupt
      ? pendingInterrupt.kind === "auth"
        ? "awaiting_auth"
        : "awaiting_approval"
      : "running";
    let nextExecutionPolicy: DecisionExecutionPolicy =
      this.dependencies.getExecutionPolicy?.(
        genRecord,
        genRecord.conversation.autoApprove,
      ) ?? {};
    if (genRecord.status === "paused") {
      nextExecutionPolicy = {
        ...nextExecutionPolicy,
        allowSnapshotRestoreOnRun: true,
      };
    }

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    await this.dependencies.lifecycleStore.resumeGenerationRequest({
      generationId,
      conversationId: genRecord.conversationId,
      coworkerRunId: linkedRun?.id,
      status: nextStatus,
      executionPolicy: nextExecutionPolicy,
    });

    await this.enqueuePendingInterruptTimeout(generationId, pendingInterrupt);
    await this.dependencies.enqueueGenerationRun?.(
      generationId,
      linkedRun ? "coworker" : "chat",
    );
    return true;
  }

  async request(_input: RequestDecisionInput): Promise<RequestDecisionResult> {
    if (_input.request.kind === "plugin_write") {
      const result = await this.requestPluginApproval(_input.generationId, {
        ..._input.request,
        runtimeTool: _input.request.runtimeTool as RuntimeToolRef | undefined,
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
            event: projectPendingDecisionEvent(interrupt),
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
        event: projectPendingDecisionEvent(interrupt),
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
      provider: RUNTIME_INTERRUPT_PROVIDER,
      providerRequestId: request.providerRequestId,
      providerToolUseId: request.providerToolUseId,
      expiresAt: computeParkedInterruptExpiryDate(_input.now),
    });
    const event = projectPendingDecisionEvent(interrupt);
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
      runtimeTool?: RuntimeToolRef;
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

    const event = projectPendingDecisionEvent(interrupt);
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
      event: projectPendingDecisionEvent(interrupt),
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
    const approvalPart = buildApprovalContentPart({
      interrupt,
      decision: resolvedDecision,
      defaultIntegration: "plugin",
      defaultOperation: "unknown",
    });

    const activeCtx = this.dependencies.getActiveRuntimeContext?.(generationId);
    const baseContentParts =
      activeCtx?.contentParts ?? (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = upsertApprovalContentPart(baseContentParts, approvalPart);
    if (activeCtx) {
      activeCtx.contentParts = nextContentParts;
    }

    await this.dependencies.lifecycleStore.persistDecisionContentParts({
      generationId,
      contentParts: nextContentParts,
    });

    const event = projectResolvedDecisionEvent(interrupt);
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
    runtimeClient: unknown;
    runtimeTool: RuntimeToolRef;
  }): Promise<ParkedPluginWriteApplicationResult> {
    return applyParkedPluginWrite(
      { updateRuntimeToolPart: this.dependencies.updateRuntimeToolPart },
      input,
    );
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

    const normalizedQuestionAnswers = normalizeQuestionAnswers(input.questionAnswers);
    const approvalPart = buildApprovalContentPart({
      interrupt,
      decision: input.decision,
      defaultIntegration: "bap",
      defaultOperation: "question",
      questionAnswers: input.questionAnswers,
    });
    const activeCtx = this.dependencies.getActiveRuntimeContext?.(input.generationId);
    const baseContentParts =
      activeCtx?.contentParts ?? (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = upsertApprovalContentPart(baseContentParts, approvalPart);
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
        event: projectResolvedDecisionEvent(resolvedInterrupt),
      });
    }

    if (genRecord.status === "paused") {
      return await this.resumeGeneration(input.generationId, input.userId);
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
          event: projectResolvedDecisionEvent(resolvedInterrupt),
        });
      }
      return await this.resumeGeneration(input.generationId, input.userId);
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
        event: projectResolvedDecisionEvent(resolvedInterrupt),
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
        ? { questionAnswers: normalizeQuestionAnswers(_input.resolution.questionAnswers) }
        : _input.resolution.kind === "runtime_question"
          ? { questionAnswers: normalizeQuestionAnswers(_input.resolution.answers) }
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
      event: projectResolvedDecisionEvent(resolved),
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
      event: expired ? projectResolvedDecisionEvent(expired) : undefined,
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

  private async enqueuePendingInterruptTimeout(
    generationId: string,
    pendingInterrupt: GenerationInterruptRecord | null,
  ): Promise<void> {
    if (pendingInterrupt?.kind !== "auth" && pendingInterrupt?.expiresAt) {
      await this.dependencies.enqueueGenerationTimeout?.(
        generationId,
        "approval",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
    if (pendingInterrupt?.kind === "auth" && pendingInterrupt.expiresAt) {
      await this.dependencies.enqueueGenerationTimeout?.(
        generationId,
        "auth",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
  }
}
