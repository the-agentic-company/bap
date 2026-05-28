import { db } from "@cmdclaw/db/client";
import { conversation, generation, message, type ContentPart } from "@cmdclaw/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { parseModelReference } from "../../../../lib/model-reference";
import {
  emitCanonicalServiceEvent,
  recordCounter,
  recordHistogram,
} from "../../../utils/observability";
import { emitGenerationSloTerminalEvent } from "../../slo-journey";

type GenerationTerminalOutcome = "completed" | "failed" | "cancelled" | "timed_out";

type ToolSummary = {
  toolCallCount: number;
  toolWriteCount: number;
  approvalCount: number;
  authInterruptionCount: number;
  toolCallMetrics: Array<{
    integration_type: string;
    operation: string;
    access: "read" | "write";
    count: number;
  }>;
  summaries: Array<{
    integration_type: string;
    tool_name: string;
    operation: string;
    access: "read" | "write";
  }>;
};

const UNKNOWN = "unknown";

function resolveTerminalOutcome(
  status: string,
  completionReason: string | null | undefined,
): GenerationTerminalOutcome {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (
    completionReason === "run_deadline" ||
    completionReason === "approval_timeout" ||
    completionReason === "auth_timeout" ||
    completionReason === "bootstrap_timeout" ||
    completionReason === "runtime_no_progress_after_prompt"
  ) {
    return "timed_out";
  }
  return "failed";
}

function resolveFailurePhase(completionReason: string | null | undefined): string {
  switch (completionReason) {
    case "approval_timeout":
      return "approval";
    case "auth_timeout":
      return "auth";
    case "bootstrap_timeout":
      return "bootstrap";
    case "run_deadline":
      return "run_deadline";
    case "runtime_no_progress_after_prompt":
      return "prompt_sent";
    case "user_cancel":
      return "user_cancel";
    case "runtime_error":
      return "runtime";
    case "completed":
      return "none";
    default:
      return completionReason ? "runtime" : "unknown";
  }
}

function normalizeErrorCode(args: {
  outcome: GenerationTerminalOutcome;
  completionReason?: string | null;
  errorMessage?: string | null;
}): string {
  if (args.outcome === "completed" || args.outcome === "cancelled") {
    return "none";
  }
  if (args.completionReason) {
    return args.completionReason;
  }

  const message = args.errorMessage?.toLowerCase() ?? "";
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }
  if (message.includes("auth") || message.includes("401") || message.includes("403")) {
    return "auth_error";
  }
  if (message.includes("rate limit")) {
    return "rate_limited";
  }
  return "unknown_error";
}

function summarizeTools(contentParts: ContentPart[] | null | undefined): ToolSummary {
  const summary: ToolSummary = {
    toolCallCount: 0,
    toolWriteCount: 0,
    approvalCount: 0,
    authInterruptionCount: 0,
    toolCallMetrics: [],
    summaries: [],
  };

  for (const part of contentParts ?? []) {
    if (part.type === "tool_use") {
      summary.toolCallCount += 1;
      const access = classifyOperationAccess(part.operation);
      if (access === "write") {
        summary.toolWriteCount += 1;
      }
      incrementToolCallMetric(summary, {
        integration_type: part.integration ?? UNKNOWN,
        operation: part.operation ?? UNKNOWN,
        access,
      });
      summary.summaries.push({
        integration_type: part.integration ?? UNKNOWN,
        tool_name: part.name,
        operation: part.operation ?? UNKNOWN,
        access,
      });
    } else if (part.type === "approval") {
      summary.approvalCount += 1;
      const access = classifyOperationAccess(part.operation);
      if (access === "write") {
        summary.toolWriteCount += 1;
      }
      summary.summaries.push({
        integration_type: part.integration,
        tool_name: part.tool_name,
        operation: part.operation,
        access,
      });
    } else if (part.type === "system" && /auth/i.test(part.content)) {
      summary.authInterruptionCount += 1;
    }
  }

  return summary;
}

function incrementToolCallMetric(
  summary: ToolSummary,
  metric: {
    integration_type: string;
    operation: string;
    access: "read" | "write";
  },
): void {
  const existing = summary.toolCallMetrics.find(
    (entry) =>
      entry.integration_type === metric.integration_type &&
      entry.operation === metric.operation &&
      entry.access === metric.access,
  );
  if (existing) {
    existing.count += 1;
    return;
  }
  summary.toolCallMetrics.push({ ...metric, count: 1 });
}

function isWriteOperation(operation: string | null | undefined): boolean {
  return /write|create|update|delete|send|post|patch|put|remove/i.test(operation ?? "");
}

function classifyOperationAccess(operation: string | null | undefined): "read" | "write" {
  return isWriteOperation(operation) ? "write" : "read";
}

function getGenerationDurationMs(args: {
  startedAt: Date | null;
  completedAt: Date | null;
  timing?: { generationDurationMs?: number } | null;
}): number | undefined {
  if (typeof args.timing?.generationDurationMs === "number") {
    return Math.max(0, args.timing.generationDurationMs);
  }
  if (args.startedAt && args.completedAt) {
    return Math.max(0, args.completedAt.getTime() - args.startedAt.getTime());
  }
  return undefined;
}

function getProviderFromModel(model: string | null | undefined): string {
  if (!model) {
    return UNKNOWN;
  }
  try {
    return parseModelReference(model).providerID;
  } catch {
    return model.includes("/") ? model.split("/")[0] || UNKNOWN : UNKNOWN;
  }
}

function recordGenerationTerminalMetrics(args: {
  outcome: GenerationTerminalOutcome;
  modelProvider: string;
  sandboxProvider: string;
  failurePhase: string;
  normalizedErrorCode: string;
  durationMs?: number;
  toolCallMetrics: ToolSummary["toolCallMetrics"];
  inputTokens: number;
  outputTokens: number;
}): void {
  const labels = {
    outcome: args.outcome,
    model_provider: args.modelProvider,
    sandbox_provider: args.sandboxProvider,
    failure_phase: args.failurePhase,
    normalized_error_code: args.normalizedErrorCode,
  };

  recordCounter(
    "cmdclaw_generation_terminal_total",
    1,
    labels,
    "Terminal Generation outcomes by bounded operational dimensions.",
  );
  if (args.durationMs !== undefined) {
    recordHistogram(
      "cmdclaw_generation_terminal_duration_ms",
      args.durationMs,
      labels,
      "Terminal Generation duration in milliseconds.",
    );
  }
  for (const toolCallMetric of args.toolCallMetrics) {
    recordHistogram(
      "cmdclaw_generation_terminal_tool_calls",
      toolCallMetric.count,
      {
        ...labels,
        integration_type: toolCallMetric.integration_type,
        operation: toolCallMetric.operation,
        access: toolCallMetric.access,
      },
      "Tool call count per terminal Generation, grouped by bounded tool dimensions.",
    );
  }
  recordHistogram(
    "cmdclaw_generation_terminal_input_tokens",
    args.inputTokens,
    labels,
    "Input token usage per terminal Generation.",
  );
  recordHistogram(
    "cmdclaw_generation_terminal_output_tokens",
    args.outputTokens,
    labels,
    "Output token usage per terminal Generation.",
  );
  recordHistogram(
    "cmdclaw_generation_terminal_total_tokens",
    args.inputTokens + args.outputTokens,
    labels,
    "Total token usage per terminal Generation.",
  );
}

export async function emitGenerationTerminalCanonicalEvent(generationId: string): Promise<boolean> {
  const claimed = await db
    .update(generation)
    .set({ terminalCanonicalEventEmittedAt: new Date() })
    .where(and(eq(generation.id, generationId), isNull(generation.terminalCanonicalEventEmittedAt)))
    .returning({ id: generation.id });

  if (claimed.length === 0) {
    return false;
  }

  const genRecord = await db.query.generation.findFirst({
    where: eq(generation.id, generationId),
    with: { conversation: true },
  });

  if (!genRecord) {
    return false;
  }

  const messageRecord = genRecord.messageId
    ? await db.query.message.findFirst({
        where: eq(message.id, genRecord.messageId),
        columns: { timing: true },
      })
    : null;
  const conv =
    genRecord.conversation ??
    (await db.query.conversation.findFirst({
      where: eq(conversation.id, genRecord.conversationId),
    }));

  const outcome = resolveTerminalOutcome(genRecord.status, genRecord.completionReason);
  const failurePhase = resolveFailurePhase(genRecord.completionReason);
  const normalizedErrorCode = normalizeErrorCode({
    outcome,
    completionReason: genRecord.completionReason,
    errorMessage: genRecord.errorMessage,
  });
  const modelProvider = getProviderFromModel(conv?.model);
  const sandboxProvider =
    genRecord.sandboxProvider ??
    genRecord.executionPolicy?.sandboxProvider ??
    conv?.lastSandboxProvider ??
    UNKNOWN;
  const durationMs = getGenerationDurationMs({
    startedAt: genRecord.startedAt,
    completedAt: genRecord.completedAt,
    timing: messageRecord?.timing,
  });
  const toolSummary = summarizeTools(genRecord.contentParts);
  const timing = messageRecord?.timing;
  const phaseDurationsMs = timing?.phaseDurationsMs ?? {};
  const modelName = conv?.model ?? UNKNOWN;
  const selectedSkillCount =
    genRecord.executionPolicy?.selectedPlatformSkillSlugs?.length ??
    genRecord.executionPolicy?.allowedSkillSlugs?.length ??
    0;
  const attachmentCount = genRecord.executionPolicy?.queuedFileAttachments?.length ?? 0;
  const authSource = conv?.authSource ?? UNKNOWN;
  const autoApproveEnabled = genRecord.executionPolicy?.autoApprove ?? conv?.autoApprove ?? false;
  const runtimeDiagnosticSnapshot =
    genRecord.debugInfo &&
    typeof genRecord.debugInfo === "object" &&
    "runtimeDiagnosticSnapshot" in genRecord.debugInfo
      ? (genRecord.debugInfo.runtimeDiagnosticSnapshot as
          | {
              id?: unknown;
              storageKey?: unknown;
              uploadSucceeded?: unknown;
              timeoutMs?: unknown;
            }
          | null
          | undefined)
      : null;

  try {
    emitCanonicalServiceEvent({
      level: outcome === "failed" || outcome === "timed_out" ? "error" : "info",
      eventName: "cmdclaw.generation.terminal",
      operationName: "generation.terminal",
      eventId: `generation:${generationId}:terminal`,
      outcome,
      context: {
        source: "generation-lifecycle",
        traceId: genRecord.traceId ?? undefined,
        generationId,
        conversationId: genRecord.conversationId,
        userId: conv?.userId ?? undefined,
        sandboxId: genRecord.sandboxId ?? undefined,
        sessionId: genRecord.runtimeId ?? undefined,
      },
      attributes: {
        "cmdclaw.generation.id": generationId,
        "cmdclaw.conversation.id": genRecord.conversationId,
        "cmdclaw.user.id": conv?.userId ?? undefined,
        "cmdclaw.workspace.id": conv?.workspaceId ?? undefined,
        "cmdclaw.generation.outcome": outcome,
        "cmdclaw.generation.status": genRecord.status,
        "cmdclaw.generation.completion_reason": genRecord.completionReason ?? UNKNOWN,
        "cmdclaw.failure.phase": failurePhase,
        "cmdclaw.error.normalized_code": normalizedErrorCode,
        "cmdclaw.model.provider": modelProvider,
        "cmdclaw.model.name": modelName,
        "cmdclaw.sandbox.provider": sandboxProvider,
        "cmdclaw.auth.source": authSource,
        "cmdclaw.auto_approve.enabled": autoApproveEnabled,
        "cmdclaw.skills.selected_count": selectedSkillCount,
        "cmdclaw.attachments.count": attachmentCount,
        "cmdclaw.sandbox.id": genRecord.sandboxId ?? undefined,
        "cmdclaw.runtime.id": genRecord.runtimeId ?? undefined,
        "cmdclaw.runtime.harness": genRecord.runtimeHarness ?? undefined,
        "cmdclaw.runtime.protocol_version": genRecord.runtimeProtocolVersion ?? undefined,
        "cmdclaw.runtime.diagnostic_snapshot.id":
          typeof runtimeDiagnosticSnapshot?.id === "string"
            ? runtimeDiagnosticSnapshot.id
            : undefined,
        "cmdclaw.runtime.diagnostic_snapshot.storage_key":
          typeof runtimeDiagnosticSnapshot?.storageKey === "string"
            ? runtimeDiagnosticSnapshot.storageKey
            : undefined,
        "cmdclaw.runtime.diagnostic_snapshot.upload_succeeded":
          typeof runtimeDiagnosticSnapshot?.uploadSucceeded === "boolean"
            ? runtimeDiagnosticSnapshot.uploadSucceeded
            : undefined,
        "cmdclaw.runtime.no_progress.timeout_ms":
          typeof runtimeDiagnosticSnapshot?.timeoutMs === "number"
            ? runtimeDiagnosticSnapshot.timeoutMs
            : undefined,
        "cmdclaw.generation.duration_ms": durationMs,
        "cmdclaw.phase.sandbox_startup_ms": timing?.sandboxStartupDurationMs,
        "cmdclaw.phase.sandbox_startup_mode": timing?.sandboxStartupMode,
        "cmdclaw.phase.sandbox_connect_or_create_ms": phaseDurationsMs.sandboxConnectOrCreateMs,
        "cmdclaw.phase.opencode_ready_ms": phaseDurationsMs.opencodeReadyMs,
        "cmdclaw.phase.session_ready_ms": phaseDurationsMs.sessionReadyMs,
        "cmdclaw.phase.agent_init_ms": phaseDurationsMs.agentInitMs,
        "cmdclaw.phase.pre_prompt_setup_ms": phaseDurationsMs.prePromptSetupMs,
        "cmdclaw.phase.pre_prompt_memory_sync_ms": phaseDurationsMs.prePromptMemorySyncMs,
        "cmdclaw.phase.pre_prompt_runtime_context_write_ms":
          phaseDurationsMs.prePromptRuntimeContextWriteMs,
        "cmdclaw.phase.pre_prompt_executor_prepare_ms": phaseDurationsMs.prePromptExecutorPrepareMs,
        "cmdclaw.phase.pre_prompt_executor_bootstrap_load_ms":
          phaseDurationsMs.prePromptExecutorBootstrapLoadMs,
        "cmdclaw.phase.pre_prompt_executor_config_write_ms":
          phaseDurationsMs.prePromptExecutorConfigWriteMs,
        "cmdclaw.phase.pre_prompt_executor_server_probe_ms":
          phaseDurationsMs.prePromptExecutorServerProbeMs,
        "cmdclaw.phase.pre_prompt_executor_server_wait_ready_ms":
          phaseDurationsMs.prePromptExecutorServerWaitReadyMs,
        "cmdclaw.phase.pre_prompt_executor_status_check_ms":
          phaseDurationsMs.prePromptExecutorStatusCheckMs,
        "cmdclaw.phase.pre_prompt_executor_oauth_reconcile_ms":
          phaseDurationsMs.prePromptExecutorOauthReconcileMs,
        "cmdclaw.phase.pre_prompt_skills_and_creds_load_ms":
          phaseDurationsMs.prePromptSkillsAndCredsLoadMs,
        "cmdclaw.phase.pre_prompt_cache_read_ms": phaseDurationsMs.prePromptCacheReadMs,
        "cmdclaw.phase.pre_prompt_skills_write_ms": phaseDurationsMs.prePromptSkillsWriteMs,
        "cmdclaw.phase.pre_prompt_custom_integration_cli_write_ms":
          phaseDurationsMs.prePromptCustomIntegrationCliWriteMs,
        "cmdclaw.phase.pre_prompt_custom_integration_permissions_write_ms":
          phaseDurationsMs.prePromptCustomIntegrationPermissionsWriteMs,
        "cmdclaw.phase.pre_prompt_integration_skills_write_ms":
          phaseDurationsMs.prePromptIntegrationSkillsWriteMs,
        "cmdclaw.phase.pre_prompt_cache_write_ms": phaseDurationsMs.prePromptCacheWriteMs,
        "cmdclaw.phase.pre_prompt_prompt_spec_compose_ms":
          phaseDurationsMs.prePromptPromptSpecComposeMs,
        "cmdclaw.phase.pre_prompt_event_stream_subscribe_ms":
          phaseDurationsMs.prePromptEventStreamSubscribeMs,
        "cmdclaw.phase.pre_prompt_coworker_docs_stage_ms":
          phaseDurationsMs.prePromptCoworkerDocsStageMs,
        "cmdclaw.phase.pre_prompt_attachments_stage_ms":
          phaseDurationsMs.prePromptAttachmentsStageMs,
        "cmdclaw.phase.wait_for_first_event_ms": phaseDurationsMs.waitForFirstEventMs,
        "cmdclaw.phase.prompt_to_first_token_ms": phaseDurationsMs.promptToFirstTokenMs,
        "cmdclaw.phase.generation_to_first_token_ms": phaseDurationsMs.generationToFirstTokenMs,
        "cmdclaw.phase.prompt_to_first_visible_output_ms":
          phaseDurationsMs.promptToFirstVisibleOutputMs,
        "cmdclaw.phase.generation_to_first_visible_output_ms":
          phaseDurationsMs.generationToFirstVisibleOutputMs,
        "cmdclaw.phase.model_stream_ms": phaseDurationsMs.modelStreamMs,
        "cmdclaw.phase.post_processing_ms": phaseDurationsMs.postProcessingMs,
        "cmdclaw.tool.call_count": toolSummary.toolCallCount,
        "cmdclaw.tool.write_count": toolSummary.toolWriteCount,
        "cmdclaw.tool.summary_json": JSON.stringify(toolSummary.summaries.slice(0, 25)),
        "cmdclaw.approval.count": toolSummary.approvalCount,
        "cmdclaw.auth_interrupt.count": toolSummary.authInterruptionCount,
        "cmdclaw.usage.input_tokens": genRecord.inputTokens,
        "cmdclaw.usage.output_tokens": genRecord.outputTokens,
        "cmdclaw.usage.total_tokens": genRecord.inputTokens + genRecord.outputTokens,
        "cmdclaw.generation.started_at": genRecord.startedAt,
        "cmdclaw.generation.completed_at": genRecord.completedAt ?? undefined,
      },
    });

    recordGenerationTerminalMetrics({
      outcome,
      modelProvider,
      sandboxProvider,
      failurePhase,
      normalizedErrorCode,
      durationMs,
      toolCallMetrics: toolSummary.toolCallMetrics,
      inputTokens: genRecord.inputTokens,
      outputTokens: genRecord.outputTokens,
    });
    await emitGenerationSloTerminalEvent({
      generationId,
      conversationId: genRecord.conversationId,
      conversationType: conv?.type,
      status: genRecord.status,
      completionReason: genRecord.completionReason,
      syntheticKind: conv?.syntheticKind,
    });
  } catch (error) {
    await db
      .update(generation)
      .set({ terminalCanonicalEventEmittedAt: null })
      .where(eq(generation.id, generationId));
    throw error;
  }
  return true;
}
