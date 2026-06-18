import type { ContentPart } from "@bap/db/schema";
import type { RuntimePromptPart } from "../../../sandbox/core/types";
import {
  type RuntimeActionableEvent,
  type RuntimeApprovalRequest,
  type RuntimePermissionRequest,
  type RuntimeQuestionRequest,
  type RuntimeToolRef,
} from "../../../runtime/runtime-driver";
import type { RuntimePendingApprovalDisplay } from "../../../runtime/runtime-decision-display";
import type { SandboxBackend } from "../../../sandbox/types";
import type { GenerationInterruptRecord } from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
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
import {
  buildApprovalContentPart,
  buildResumedAuthContinuationPrompt,
  buildResumedRuntimeQuestionContinuationPrompt,
  normalizeQuestionAnswers,
  projectPendingDecisionEvent,
  projectResolvedDecisionEvent,
  upsertApprovalContentPart,
} from "./approval-projection";
import type {
  ActiveDecisionContext,
  DecisionFlowDependencies,
  ParkedPluginWriteApplicationResult,
} from "./decision-shared";
import { PluginAuthDecisionLifecycle } from "./decision-lifecycle";
import { RuntimeDecisionRelay } from "./runtime-decision-relay";

export { InterruptParking } from "./interrupt-parking";
export { getRuntimeToolRefForInterrupt } from "./decision-shared";
export type { ActiveDecisionContext, ParkedPluginWriteApplicationResult } from "./decision-shared";

/**
 * The deep facade for every Generation decision: durable plugin-write/auth/
 * approval interrupts (delegated to `PluginAuthDecisionLifecycle`) and the
 * live runtime permission/question relay (delegated to `RuntimeDecisionRelay`).
 * Its public methods are the seam crossed by callers and tests; the collaborators
 * behind it concentrate the database and lifecycle-store coordination.
 */
export class DecisionFlow {
  private readonly lifecycle: PluginAuthDecisionLifecycle;
  private readonly runtimeRelay: RuntimeDecisionRelay;

  constructor(dependencies: DecisionFlowDependencies) {
    this.lifecycle = new PluginAuthDecisionLifecycle(dependencies);
    this.runtimeRelay = new RuntimeDecisionRelay({
      lifecycleStore: dependencies.lifecycleStore,
      onPluginApprovalResolved: dependencies.onPluginApprovalResolved,
      waitForDecision: (interruptId, maxWaitMs, timeoutMs) =>
        this.waitForRuntimeApprovalDecision(interruptId, maxWaitMs, timeoutMs),
    });
  }

  async resumeGeneration(generationId: string, userId: string): Promise<boolean> {
    return this.lifecycle.resumeGeneration(generationId, userId);
  }

  normalizeQuestionAnswers(questionAnswers?: string[][]): string[][] {
    return normalizeQuestionAnswers(questionAnswers);
  }

  buildApprovalContentPart(input: {
    interrupt: GenerationInterruptRecord;
    decision: "approve" | "deny" | "allow";
    defaultIntegration: string;
    defaultOperation: string;
    questionAnswers?: string[][];
  }): Extract<ContentPart, { type: "approval" }> {
    return buildApprovalContentPart(input);
  }

  upsertApprovalContentPart(
    contentParts: ContentPart[],
    approvalPart: Extract<ContentPart, { type: "approval" }>,
  ): ContentPart[] {
    return upsertApprovalContentPart(contentParts, approvalPart);
  }

  projectPendingEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return projectPendingDecisionEvent(interrupt);
  }

  projectResolvedEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return projectResolvedDecisionEvent(interrupt);
  }

  async request(input: RequestDecisionInput): Promise<RequestDecisionResult> {
    return this.lifecycle.request(input);
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
    return this.lifecycle.requestPluginApproval(generationId, request);
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
    return this.lifecycle.requestAuthInterrupt(generationId, request);
  }

  async getPluginApprovalStatus(
    generationId: string,
    interruptId: string,
  ): Promise<"pending" | "allow" | "deny"> {
    return this.lifecycle.getPluginApprovalStatus(generationId, interruptId);
  }

  async applyParkedPluginWrite(input: {
    interrupt: GenerationInterruptRecord;
    sandbox?: SandboxBackend;
    runtimeClient: unknown;
    runtimeTool: RuntimeToolRef;
  }): Promise<ParkedPluginWriteApplicationResult> {
    return this.lifecycle.applyParkedPluginWrite(input);
  }

  async submitApproval(input: {
    generationId: string;
    toolUseId: string;
    decision: "approve" | "deny";
    userId: string;
    questionAnswers?: string[][];
  }): Promise<boolean> {
    return this.lifecycle.submitApproval(input);
  }

  async submitApprovalByInterrupt(input: {
    interruptId: string;
    decision: "approve" | "deny";
    userId: string;
    questionAnswers?: string[][];
  }): Promise<boolean> {
    return this.lifecycle.submitApprovalByInterrupt(input);
  }

  async submitAuthResult(input: {
    generationId: string;
    integration: string;
    success: boolean;
    userId: string;
  }): Promise<boolean> {
    return this.lifecycle.submitAuthResult(input);
  }

  async submitAuthResultByInterrupt(input: {
    interruptId: string;
    integration: string;
    success: boolean;
    userId: string;
  }): Promise<boolean> {
    return this.lifecycle.submitAuthResultByInterrupt(input);
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
    return this.lifecycle.waitForApproval(generationId, request);
  }

  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; userId?: string }> {
    return this.lifecycle.waitForAuth(generationId, request);
  }

  async resolve(input: ResolveDecisionInput): Promise<ResolveDecisionResult> {
    return this.lifecycle.resolve(input);
  }

  async expire(input: ExpireDecisionInput): Promise<ExpireDecisionResult> {
    return this.lifecycle.expire(input);
  }

  async applyToRuntime(input: ApplyDecisionToRuntimeInput): Promise<ApplyDecisionResult> {
    return this.lifecycle.applyToRuntime(input);
  }

  async waitForRuntimeApprovalDecision(
    interruptId: string,
    maxWaitMs: number,
    timeoutMs = generationLifecyclePolicy.approvalTimeoutMs,
  ): Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null> {
    return this.runtimeRelay.waitForRuntimeApprovalDecision(interruptId, maxWaitMs, timeoutMs);
  }

  async applyRuntimeApprovalDecision(input: {
    ctx: ActiveDecisionContext;
    interruptId: string;
    decision: "allow" | "deny";
    questionAnswers?: string[][];
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>;
  }): Promise<GenerationInterruptRecord | null> {
    return this.runtimeRelay.applyRuntimeApprovalDecision(input);
  }

  buildResumedAuthContinuationPrompt(interrupt: GenerationInterruptRecord): RuntimePromptPart[] {
    return buildResumedAuthContinuationPrompt(interrupt);
  }

  buildResumedRuntimeQuestionContinuationPrompt(
    interrupt: GenerationInterruptRecord,
  ): RuntimePromptPart[] {
    return buildResumedRuntimeQuestionContinuationPrompt(interrupt);
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
    return this.runtimeRelay.applyResolvedInterruptToRuntime(input);
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
    return this.runtimeRelay.handleRuntimeActionableEvent(input);
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
    return this.runtimeRelay.requestRuntimeApproval(input);
  }
}
