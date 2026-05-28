import type { ContentPart, GenerationExecutionPolicy } from "@cmdclaw/db/schema";
import type { GenerationCompletionReason } from "../../lifecycle-policy";
import type {
  GenerationEvent,
  GenerationStatus,
  GenerationTerminalStatus,
  GenerationTurnKind,
  StartedGeneration,
} from "../types";

export type RuntimeBinding = {
  runtimeId: string;
  turnSeq: number;
  sessionId?: string | null;
  sandboxId?: string | null;
};

export type RuntimeSnapshotRef = {
  conversationId: string;
  sessionId: string;
  provider?: string;
};

export type TurnRecord = {
  generationId: string;
  conversationId: string;
  userId: string;
  kind: GenerationTurnKind;
  status: GenerationStatus;
  runtimeBinding?: RuntimeBinding;
  currentInterruptId?: string | null;
  resumeInterruptId?: string | null;
  deadlineAt?: Date | null;
  remainingRunMs?: number | null;
  suspendedAt?: Date | null;
  completionReason?: GenerationCompletionReason | null;
  contentParts: ContentPart[];
  usage: { inputTokens: number; outputTokens: number; totalCostUsd?: number };
};

export type ClaimedTurn = TurnRecord & {
  leaseToken: string;
};

export type CreateRunningTurnInput = {
  kind: GenerationTurnKind;
  conversationId: string;
  userId: string;
  userMessageId: string;
  executionPolicy: GenerationExecutionPolicy;
  runtimeBinding: RuntimeBinding;
  deadlineAt: Date;
  runBudgetMs: number;
  debugInfo?: unknown;
};

export type LoadTurnInput = {
  generationId: string;
  userId?: string;
};

export type ClaimTurnForRunInput = {
  generationId: string;
  workerId: string;
};

export type MarkAwaitingDecisionInput = {
  generationId: string;
  interruptId: string;
  decisionKind: "approval" | "auth" | "runtime_question" | "plugin_write";
  remainingRunMs: number;
  suspendedAt: Date;
  runtimeSnapshot?: RuntimeSnapshotRef;
};

export type MarkPausedForDeadlineInput = {
  generationId: string;
  remainingRunMs: number;
  suspendedAt: Date;
  runtimeSnapshot?: RuntimeSnapshotRef;
};

export type ResumeAfterDecisionInput = {
  generationId: string;
  interruptId: string;
  deadlineAt: Date;
};

export type RequestCancellationInput = {
  generationId: string;
  userId: string;
};

export type AppendProgressInput = {
  generationId: string;
  contentParts: ContentPart[];
  usage?: { inputTokens: number; outputTokens: number; totalCostUsd?: number };
  deadlineAt?: Date;
  remainingRunMs?: number | null;
  suspendedAt?: Date | null;
  resumeInterruptId?: string | null;
  recoveryAttempts?: number;
  completionReason?: GenerationCompletionReason | null;
  lastRuntimeProgressAt: Date;
  debugInfo?: unknown;
};

export type FinishTurnInput = {
  generationId: string;
  status: GenerationTerminalStatus;
  completionReason: GenerationCompletionReason;
  assistantContent?: string;
  contentParts: ContentPart[];
  usage: { inputTokens: number; outputTokens: number; totalCostUsd?: number };
  errorMessage?: string | null;
  debugInfo?: unknown;
  completedAt: Date;
  generatedSandboxFileIds?: string[];
};

export type FinishDetachedTurnInput = {
  generationId: string;
  status: "error" | "cancelled";
  completionReason: GenerationCompletionReason;
  errorMessage?: string | null;
  completedAt: Date;
};

export type FinishedTurn = StartedGeneration & {
  userId: string;
  status: GenerationTerminalStatus;
  messageId?: string;
  terminalEvent: GenerationEvent;
};
