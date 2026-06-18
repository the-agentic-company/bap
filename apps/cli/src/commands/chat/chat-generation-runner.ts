import {
  runChatSession,
  type BapApiClient,
  type StatusChangeMetadata,
} from "@bap/client";
import type readline from "node:readline";
import { resolveServerUrl } from "../../lib/client";
import { resolveCliToolMetadata } from "../../lib/tool-metadata";
import { exportPerfettoTraceForCompletedRun } from "./perfetto-trace";
import { buildGenerationTimingLines, createGenerationTimingTracker } from "./stream-timing";
import { handleAuthNeeded, handlePendingApproval } from "./chat-interrupts";
import {
  printApprovalParked,
  printGenerationMarkers,
  printRunDeadlineParked,
  printRuntimeMetadata,
  writeTimingSummary,
  type PrintedGenerationMarkers,
  type PrintedRuntimeMetadata,
} from "./chat-output-markers";
import type {
  ActiveConversationGeneration,
  ChatGenerationTarget,
  ChatState,
} from "./chat-types";

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function isAttachableGenerationStatus(status: string | null): boolean {
  return status === "generating" || status === "awaiting_approval" || status === "awaiting_auth";
}

export function shouldAutoResumePausedRunDeadline(
  active: Pick<ActiveConversationGeneration, "status" | "pauseReason">,
): boolean {
  return active.status === "paused" && active.pauseReason === "run_deadline";
}

async function validatePersistedAssistantMessage(
  client: BapApiClient,
  conversationId: string,
  messageId: string,
  expected: { content: string; parts: Array<{ type: string }> },
): Promise<void> {
  const conversation = await client.conversation.get({ id: conversationId });
  const savedMessage = conversation.messages.find((message) => message.id === messageId);

  if (!savedMessage) {
    throw new Error(
      `Validation failed: assistant message ${messageId} was not saved in conversation ${conversationId}`,
    );
  }

  const persistedParts = Array.isArray(savedMessage.contentParts) ? savedMessage.contentParts : [];
  if (expected.parts.length > 0 && persistedParts.length === 0) {
    throw new Error(
      "Validation failed: stream produced activity/text but saved message has no contentParts",
    );
  }

  const normalizedStream = normalizeText(expected.content);
  if (normalizedStream.length === 0) {
    return;
  }

  const normalizedPersisted = normalizeText(savedMessage.content ?? "");
  if (!normalizedPersisted.includes(normalizedStream)) {
    throw new Error(
      "Validation failed: streamed assistant text does not match saved message content",
    );
  }
}

export async function runOneGeneration(
  stdout: NodeJS.WriteStream,
  client: BapApiClient,
  rl: readline.Interface | null,
  state: ChatState,
  target: ChatGenerationTarget,
): Promise<string | null> {
  const resolvedServerUrl = resolveServerUrl(state.server);
  const normalizedServerUrl = resolvedServerUrl.replace(/\/$/, "");
  const generationTiming = createGenerationTimingTracker();
  const printedRuntimeMetadata: PrintedRuntimeMetadata = {};
  const printedGenerationMarkers: PrintedGenerationMarkers = {};
  let attachRuntimeMetadataUnlocked =
    target.kind !== "attach" || !target.suppressReplayRuntimeMetadataUntilDecision;

  const result = await runChatSession({
    client,
    ...(target.kind === "start"
      ? {
          input: {
            conversationId: target.conversationId,
            content: target.content,
            model: state.model,
            authSource: state.authSource,
            sandboxProvider: state.sandbox,
            autoApprove: state.autoApprove,
            resumePausedGenerationId: target.resumePausedGenerationId,
            debugRunDeadlineMs: target.debugRunDeadlineMsOverride ?? state.debugRunDeadlineMs,
            debugApprovalHotWaitMs: state.debugApprovalHotWaitMs,
            debugRuntimeNoProgressTimeoutMs:
              state.debugRuntimeNoProgressTimeoutMs,
            debugForceRuntimeNoProgressAfterPrompt:
              state.debugForceRuntimeNoProgressAfterPrompt,
            fileAttachments: target.attachments?.length ? target.attachments : undefined,
          },
        }
      : { generationId: target.generationId }),
    onStarted: (generationId, conversationId) => {
      printGenerationMarkers(stdout, printedGenerationMarkers, { generationId, conversationId });
    },
    ...(target.kind === "attach"
      ? {
          onStatusChange: (status: string, metadata?: StatusChangeMetadata) => {
            printGenerationMarkers(stdout, printedGenerationMarkers, {
              generationId: target.generationId,
            });
            if (attachRuntimeMetadataUnlocked) {
              printRuntimeMetadata(stdout, printedRuntimeMetadata, metadata);
            }
            printRunDeadlineParked(stdout, status, target.generationId, metadata);
          },
        }
      : {
          onStatusChange: (status: string, metadata?: StatusChangeMetadata) => {
            printRuntimeMetadata(stdout, printedRuntimeMetadata, metadata);
            printApprovalParked(stdout, status, metadata);
            printRunDeadlineParked(stdout, status, printedGenerationMarkers.generationId, metadata);
          },
        }),
    onText: (text) => {
      if (text.length > 0) {
        generationTiming.noteVisibleOutput();
      }
      stdout.write(text);
    },
    onThinking: (thinking) => {
      if (thinking.length > 0) {
        generationTiming.noteVisibleOutput();
      }
      stdout.write(`\n[thinking] ${thinking}\n`);
    },
    onToolUse: (toolUse) => {
      generationTiming.noteVisibleOutput();
      const metadata = resolveCliToolMetadata(toolUse);
      stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
      if (metadata.integration) {
        stdout.write(`[tool_integration] ${metadata.integration}\n`);
      }
      if (typeof metadata.isWrite === "boolean") {
        stdout.write(`[tool_is_write] ${metadata.isWrite}\n`);
      }
      stdout.write(`[tool_input] ${JSON.stringify(toolUse.toolInput)}\n`);
    },
    onToolResult: (toolName, resultValue) => {
      generationTiming.noteVisibleOutput();
      stdout.write(`\n[tool_result] ${toolName}\n`);
      stdout.write(
        `[tool_result_data] ${typeof resultValue === "string" ? resultValue : JSON.stringify(resultValue)}\n`,
      );
    },
    onApprovalResult: () => {
      attachRuntimeMetadataUnlocked = true;
    },
    onAuthResult: () => {
      attachRuntimeMetadataUnlocked = true;
    },
    onPendingApproval: (approval, apiClient) =>
      handlePendingApproval({
        stdout,
        rl,
        approval,
        apiClient,
        printedGenerationMarkers,
        noteVisibleOutput: () => generationTiming.noteVisibleOutput(),
        chaosApproval: state.chaosApproval,
        autoApprove: state.autoApprove,
        questionAnswer: state.questionAnswer,
        debugApprovalHotWaitMs: state.debugApprovalHotWaitMs,
      }),
    onAuthNeeded: (auth, apiClient) =>
      handleAuthNeeded({
        stdout,
        rl,
        auth,
        apiClient,
        noteVisibleOutput: () => generationTiming.noteVisibleOutput(),
        normalizedServerUrl,
        open: state.open,
      }),
  });

  switch (result.status) {
    case "completed":
      generationTiming.noteCompleted();
      stdout.write("\n");
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      if (state.validate) {
        await validatePersistedAssistantMessage(client, result.conversationId, result.messageId, {
          content: result.assistant.content,
          parts: result.assistant.parts.map((part) => ({ type: part.type })),
        });
      }
      if (state.perfettoTrace) {
        const traceResult = exportPerfettoTraceForCompletedRun({
          cwd: process.cwd(),
          conversationId: result.conversationId,
          generationId: result.generationId,
          artifacts: result.artifacts,
        });
        if (traceResult.status === "written") {
          stdout.write(`[perfetto_trace] ${traceResult.path}\n`);
        } else {
          stdout.write("[warning] Perfetto trace export skipped: phase timestamps unavailable.\n");
        }
      }
      if (state.timing) {
        writeTimingSummary(stdout, result.artifacts);
        for (const line of buildGenerationTimingLines(generationTiming.snapshot())) {
          stdout.write(`${line}\n`);
        }
      }
      return result.conversationId;
    case "needs_auth":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "needs_approval":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "cancelled":
      stdout.write("\n[cancelled]\n");
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "paused":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId ?? null;
    case "failed":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      stdout.write(`\n[error] ${result.error.message}\n`);
      if (
        result.error.diagnosticMessage &&
        result.error.diagnosticMessage !== result.error.message
      ) {
        stdout.write(`[diagnostic] ${result.error.diagnosticMessage}\n`);
      }
      return null;
  }
}
