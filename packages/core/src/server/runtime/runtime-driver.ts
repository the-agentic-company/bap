import type { ProviderAuthSource } from "../../lib/provider-auth-source";
import type { ExecutionEnvironment } from "../execution/execution-environment";

export interface RuntimeDriver {
  startTurn(input: RuntimeStartTurnInput): Promise<RuntimeTurn>;
  resumeTurn(input: RuntimeResumeTurnInput): Promise<RuntimeTurn>;
  reattachTurn(input: RuntimeReattachTurnInput): Promise<RuntimeTurn>;
  applyDecision(input: RuntimeApplyDecisionInput): Promise<void>;
  abortTurn(input: RuntimeAbortTurnInput): Promise<void>;
  captureUsage(input: RuntimeUsageInput): Promise<RuntimeUsage>;
}

export type RuntimeTurn = {
  session: RuntimeSessionRef;
  events: AsyncIterable<RuntimeTurnEvent>;
  completion: Promise<RuntimeCompletion>;
};

export type RuntimeStartTurnInput = {
  generationId: string;
  conversationId: string;
  userId: string;
  model: string;
  authSource: ProviderAuthSource | null;
  prompt: RuntimePrompt;
  environment: ExecutionEnvironment;
  runtimeBinding: RuntimeBindingRef;
};

export type RuntimeResumeTurnInput = {
  generationId: string;
  conversationId: string;
  userId: string;
  model: string;
  authSource: ProviderAuthSource | null;
  environment: ExecutionEnvironment;
  runtimeBinding: RuntimeBindingRef;
  reason: "decision_resolved" | "run_deadline_continue";
  continuationPrompt?: RuntimePrompt;
};

export type RuntimeReattachTurnInput = {
  generationId: string;
  conversationId: string;
  userId: string;
  environment: ExecutionEnvironment;
  runtimeBinding: RuntimeBindingRef;
  requireLiveSession: boolean;
  allowSnapshotRestore: boolean;
};

export type RuntimeApplyDecisionInput = {
  runtimeBinding: RuntimeBindingRef;
  resolution: RuntimeDecisionResolution;
};

export type RuntimeAbortTurnInput = {
  runtimeBinding?: RuntimeBindingRef;
  reason: "cancelled" | "run_deadline" | "decision_park" | "worker_shutdown";
};

export type RuntimeUsageInput = {
  runtimeBinding: RuntimeBindingRef;
};

export type RuntimePrompt = {
  user: string;
  system?: string;
  attachments?: RuntimeAttachment[];
  metadata?: Record<string, unknown>;
};

export type RuntimeAttachment = {
  name: string;
  mimeType: string;
  dataUrl?: string;
  path?: string;
};

export type RuntimeBindingRef = {
  runtimeId: string;
  turnSeq: number;
  sessionId?: string | null;
};

export type RuntimeSessionRef = RuntimeBindingRef & {
  sessionId: string;
};

export type RuntimeTurnEvent =
  | { type: "session_bound"; session: RuntimeSessionRef }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; id: string; text: string; fullText: string }
  | {
      type: "tool_started";
      id: string;
      name: string;
      input: Record<string, unknown>;
      metadata?: RuntimeToolMetadata;
    }
  | { type: "tool_finished"; id: string; name: string; output: unknown }
  | { type: "tool_failed"; id: string; name: string; error: string }
  | { type: "decision_requested"; request: RuntimeInterruptRequest }
  | { type: "idle" }
  | { type: "failed"; error: string; recoverable: boolean };

export type RuntimeCompletion =
  | { status: "completed"; assistantText?: string }
  | { status: "cancelled" }
  | { status: "failed"; error: string; recoverable: boolean }
  | { status: "deadline_reached" };

export type RuntimeUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type RuntimeToolMetadata = {
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type RuntimeInterruptRequest =
  | {
      kind: "runtime_permission";
      providerRequestId: string;
      providerToolUseId: string;
      title: string;
      integration?: string;
      operation?: string;
      command?: string;
      toolInput?: Record<string, unknown>;
    }
  | {
      kind: "runtime_question";
      providerRequestId: string;
      providerToolUseId: string;
      title: string;
      questions: RuntimeQuestion[];
      toolInput?: Record<string, unknown>;
    };

export type RuntimeQuestion = {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
};

export type RuntimeDecisionResolution =
  | {
      kind: "runtime_permission";
      providerRequestId: string;
      decision: "approve" | "deny";
    }
  | {
      kind: "runtime_question";
      providerRequestId: string;
      decision: "approve" | "deny";
      answers?: string[][];
    };
