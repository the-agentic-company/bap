import { createHash } from "node:crypto";
import { db } from "@bap/db/client";
import type { ContentPart } from "@bap/db/schema";
import {
  type RuntimeToolRef,
} from "../../../runtime/runtime-driver";
import { extractRuntimeCallIdFromProviderRequestId } from "../../../runtime/runtime-decision-display";
import type { GenerationInterruptRecord } from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { GenerationEvent } from "../types";

const PARKED_INTERRUPT_TIMEOUT_MS = generationLifecyclePolicy.explicitPauseRetentionMs;

export function computeExpiryIso(timeoutMs: number): string {
  return new Date(Date.now() + timeoutMs).toISOString();
}

export function computeParkedInterruptExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + PARKED_INTERRUPT_TIMEOUT_MS);
}

export type DecisionGenerationRecord = NonNullable<
  Awaited<ReturnType<typeof db.query.generation.findFirst>>
>;

export type ActiveDecisionContext = {
  id: string;
  conversationId: string;
  coworkerRunId?: string | null;
  status?: string;
  currentInterruptId?: string;
  contentParts: ContentPart[];
  runtimeTools: Map<string, RuntimeToolRef>;
  sessionId?: string;
};

export type DecisionExecutionPolicy = Record<string, unknown> & {
  autoApprove?: boolean | null;
  allowSnapshotRestoreOnRun?: boolean;
};

export type ParkedPluginWriteApplicationResult = {
  toolUseId: string;
  toolName: string;
  result: unknown;
  continuationText: string;
};

export type DecisionFlowDependencies = {
  lifecycleStore: Pick<
    GenerationLifecycleStore,
    | "persistDecisionContentParts"
    | "resumeAfterDecision"
    | "cancelAfterAuthFailure"
    | "markCoworkerRunAwaitingAuth"
    | "markCoworkerRunAwaitingApproval"
    | "clearAppliedResumeInterrupt"
    | "resumeGenerationRequest"
  >;
  getActiveRuntimeContext?: (generationId: string) => ActiveDecisionContext | null | undefined;
  getExecutionPolicy?: (
    generationRecord: DecisionGenerationRecord,
    defaultAutoApprove: boolean,
  ) => DecisionExecutionPolicy;
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
  enqueueResolvedInterruptResume?: (input: {
    generationId: string;
    conversationId: string;
    interrupt: GenerationInterruptRecord;
    runType: "chat" | "coworker";
    coworkerRunId?: string;
    remainingRunMs?: number | null;
  }) => Promise<void>;
  enqueueConversationQueuedMessageProcess?: (conversationId: string) => Promise<void>;
  enqueueGenerationRun?: (
    generationId: string,
    runType: "chat" | "coworker",
  ) => Promise<void>;
  enqueueGenerationTimeout?: (
    generationId: string,
    kind: "approval" | "auth",
    expiresAtIso: string,
  ) => Promise<void>;
  touchConversationLastUserVisibleAction?: (conversationId: string) => Promise<void>;
  processGenerationTimeout?: (
    generationId: string,
    kind: "approval" | "auth",
  ) => Promise<void>;
  updateRuntimeToolPart?: (
    runtimeClient: unknown,
    runtimeTool: RuntimeToolRef,
    patch:
      | { status: "completed"; input: Record<string, unknown>; output: string }
      | { status: "error"; input: Record<string, unknown>; error: string },
  ) => Promise<void>;
};

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

export function hashStableProviderRequestPayload(payload: unknown): string {
  return createHash("sha256").update(stableJsonStringify(payload)).digest("hex").slice(0, 24);
}

export function getRuntimeToolRefForInterrupt(
  ctx: ActiveDecisionContext | null | undefined,
  params: {
    providerRequestId?: string | null;
    runtimeTool?: RuntimeToolRef;
    command: string;
  },
): RuntimeToolRef | undefined {
  if (params.runtimeTool) {
    return params.runtimeTool;
  }
  const callId = extractRuntimeCallIdFromProviderRequestId(params.providerRequestId);
  if (callId) {
    const fromMap = ctx?.runtimeTools?.get(callId);
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
  return ctx?.runtimeTools?.get(matchingToolUse.id);
}
