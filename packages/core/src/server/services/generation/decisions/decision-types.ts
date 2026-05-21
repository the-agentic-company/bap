import type { GenerationEvent } from "../types";
import type { RuntimeDecisionResolution, RuntimeInterruptRequest } from "../../../runtime/runtime-driver";

export type PluginWriteDecisionRequest = {
  kind: "plugin_write";
  providerRequestId: string;
  title: string;
  integration: string;
  operation: string;
  command: string;
  toolInput: Record<string, unknown>;
  runtimeTool?: unknown;
};

export type AuthDecisionRequest = {
  kind: "auth";
  providerRequestId: string;
  integration: string;
  reason?: string;
};

export type RequestDecisionInput = {
  generationId: string;
  request: RuntimeInterruptRequest | PluginWriteDecisionRequest | AuthDecisionRequest;
  autoApprove: boolean;
  now: Date;
};

export type RequestDecisionResult =
  | { outcome: "accepted" }
  | {
      outcome: "pending";
      interruptId: string;
      expiresAt?: Date;
      event: GenerationEvent;
    }
  | { outcome: "rejected"; reason: string };

export type DecisionResolution =
  | { kind: "approval"; decision: "approve" | "deny"; questionAnswers?: string[][] }
  | { kind: "runtime_question"; decision: "approve" | "deny"; answers?: string[][] }
  | { kind: "plugin_write"; decision: "approve" | "deny" }
  | { kind: "auth"; success: boolean; integration: string };

export type ResolveDecisionInput = {
  interruptId: string;
  userId: string;
  resolution: DecisionResolution;
  now: Date;
};

export type ResolveDecisionResult = {
  generationId: string;
  conversationId: string;
  resolved: boolean;
  shouldResume: boolean;
  event?: GenerationEvent;
};

export type ExpireDecisionInput = {
  generationId: string;
  interruptId?: string;
  kind?: "approval" | "auth" | "runtime_question" | "plugin_write";
  now: Date;
};

export type ExpireDecisionResult = {
  expired: boolean;
  generationId?: string;
  shouldFinalize: boolean;
  event?: GenerationEvent;
};

export type ApplyDecisionToRuntimeInput = {
  generationId: string;
  interruptId: string;
  resolution: RuntimeDecisionResolution;
};

export type ApplyDecisionResult = {
  applied: boolean;
  continuationPrompt?: string;
};
