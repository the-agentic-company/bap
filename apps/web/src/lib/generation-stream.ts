import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import type { RouterClient } from "@orpc/server";
import { GENERATION_ERROR_PHASES } from "@cmdclaw/core/lib/generation-errors";
import { normalizeGenerationError, type NormalizedGenerationError } from "@/lib/generation-errors";
import type { AppRouter } from "../server/orpc";

export type ToolUseData = {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type ThinkingData = {
  content: string;
  thinkingId: string;
};

export type GenerationPendingApprovalData = {
  interruptId: string;
  generationId: string;
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type GenerationApprovalData = {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  status: "approved" | "denied";
  questionAnswers?: string[][];
};

export type AuthNeededData = {
  interruptId: string;
  generationId: string;
  conversationId: string;
  integrations: string[];
  reason?: string;
};

export type SandboxFileData = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type StatusChangeMetadata = {
  sandboxProvider?: "e2b" | "daytona" | "docker";
  runtimeId?: string;
  runtimeHarness?: "opencode" | "agent-sdk";
  runtimeProtocolVersion?: "opencode-v2" | "sandbox-agent-v1";
  sandboxId?: string;
  sessionId?: string;
  parkedInterruptId?: string;
  releasedSandboxId?: string;
};

export type DoneArtifactsData = {
  timing?: {
    sandboxStartupDurationMs?: number;
    sandboxStartupMode?: "created" | "reused" | "unknown";
    generationDurationMs?: number;
    phaseDurationsMs?: {
      sandboxConnectOrCreateMs?: number;
      opencodeReadyMs?: number;
      sessionReadyMs?: number;
      agentInitMs?: number;
      prePromptSetupMs?: number;
      waitForFirstEventMs?: number;
      promptToFirstTokenMs?: number;
      generationToFirstTokenMs?: number;
      promptToFirstVisibleOutputMs?: number;
      generationToFirstVisibleOutputMs?: number;
      modelStreamMs?: number;
      postProcessingMs?: number;
    };
    phaseTimestamps?: Array<{
      phase: string;
      at: string;
      elapsedMs: number;
    }>;
  };
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles: SandboxFileData[];
};

type GenerationStartInput = {
  conversationId?: string;
  content: string;
  model?: string;
  authSource?: ProviderAuthSource | null;
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  resumePausedGenerationId?: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  selectedPlatformSkillSlugs?: string[];
  fileAttachments?: { name: string; mimeType: string; dataUrl: string }[];
};

export type GenerationCallbacks = {
  onText?: (content: string) => void | Promise<void>;
  onSystem?: (data: { content: string; coworkerId?: string }) => void | Promise<void>;
  onThinking?: (data: ThinkingData) => void | Promise<void>;
  onToolUse?: (data: ToolUseData) => void | Promise<void>;
  onToolResult?: (toolName: string, result: unknown, toolUseId?: string) => void | Promise<void>;
  onPendingApproval?: (data: GenerationPendingApprovalData) => void | Promise<void>;
  onApprovalResult?: (toolUseId: string, decision: "approved" | "denied") => void | Promise<void>;
  onApproval?: (data: GenerationApprovalData) => void | Promise<void>;
  onAuthNeeded?: (data: AuthNeededData) => void | Promise<void>;
  onAuthProgress?: (connected: string, remaining: string[]) => void | Promise<void>;
  onAuthResult?: (success: boolean, integrations?: string[]) => void | Promise<void>;
  onSandboxFile?: (data: SandboxFileData) => void | Promise<void>;
  onDone?: (
    generationId: string,
    conversationId: string,
    messageId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalCostUsd: number;
    },
    artifacts?: DoneArtifactsData,
  ) => void | Promise<void>;
  onStarted?: (generationId: string, conversationId: string) => void | Promise<void>;
  onError?: (error: NormalizedGenerationError) => void | Promise<void>;
  onCancelled?: (data: {
    generationId: string;
    conversationId: string;
    messageId?: string;
  }) => void | Promise<void>;
  onStatusChange?: (status: string, metadata?: StatusChangeMetadata) => void | Promise<void>;
};

type RunGenerationStreamParams = {
  client: RouterClient<AppRouter>;
  input?: GenerationStartInput;
  generationId?: string;
  signal?: AbortSignal;
  callbacks: GenerationCallbacks;
};

function shouldReconnectWithCursor(event: {
  type: string;
  message?: string;
  cursor?: string;
}): event is { type: "error"; message: string; cursor: string } {
  return (
    event.type === "error" &&
    typeof event.cursor === "string" &&
    event.cursor.length > 0 &&
    typeof event.message === "string" &&
    event.message.includes("Reconnect with the returned cursor")
  );
}

export async function runGenerationStream(
  params: RunGenerationStreamParams,
): Promise<{ generationId: string; conversationId: string } | null> {
  const { client, input, callbacks, signal } = params;
  let generationId = params.generationId;
  let conversationId: string | undefined;
  let cursor: string | undefined;

  if (input) {
    const started = await client.generation.startGeneration(input);
    generationId = started.generationId;
    conversationId = started.conversationId;
    await callbacks.onStarted?.(started.generationId, started.conversationId);
  }

  if (!generationId) {
    throw new Error("runGenerationStream requires either input or generationId");
  }

  let shouldReconnect = false;
  while (true) {
    if (signal?.aborted) {
      break;
    }
    shouldReconnect = false;
    const subscriptionInput = cursor ? { generationId, cursor } : { generationId };
    let iterator:
      | Awaited<ReturnType<RouterClient<AppRouter>["generation"]["subscribeGeneration"]>>
      | undefined;
    if (signal) {
      // eslint-disable-next-line no-await-in-loop
      iterator = await client.generation.subscribeGeneration(subscriptionInput, { signal });
    } else {
      // eslint-disable-next-line no-await-in-loop
      iterator = await client.generation.subscribeGeneration(subscriptionInput);
    }

    // eslint-disable-next-line no-await-in-loop
    for await (const event of iterator) {
      if (signal?.aborted) {
        break;
      }
      if ("cursor" in event && typeof event.cursor === "string" && event.cursor.length > 0) {
        cursor = event.cursor;
      }

      switch (event.type) {
        case "text":
          await callbacks.onText?.(event.content);
          break;
        case "system":
          await callbacks.onSystem?.({
            content: event.content,
            coworkerId: event.coworkerId,
          });
          break;
        case "thinking":
          await callbacks.onThinking?.({
            content: event.content,
            thinkingId: event.thinkingId,
          });
          break;
        case "tool_use":
          await callbacks.onToolUse?.({
            toolName: event.toolName,
            toolInput: event.toolInput,
            toolUseId: event.toolUseId,
            integration: event.integration,
            operation: event.operation,
            isWrite: event.isWrite,
          });
          break;
        case "tool_result":
          await callbacks.onToolResult?.(event.toolName, event.result, event.toolUseId);
          break;
        case "interrupt_pending":
          conversationId = event.conversationId;
          if (event.kind === "auth") {
            await callbacks.onAuthNeeded?.({
              interruptId: event.interruptId,
              generationId: event.generationId,
              conversationId: event.conversationId,
              integrations: event.display.authSpec?.integrations ?? [],
              reason: event.display.authSpec?.reason,
            });
          } else {
            await callbacks.onPendingApproval?.({
              interruptId: event.interruptId,
              generationId: event.generationId,
              conversationId: event.conversationId,
              toolUseId: event.providerToolUseId,
              toolName: event.display.title,
              toolInput: event.display.toolInput ?? {},
              integration: event.display.integration ?? "cmdclaw",
              operation: event.display.operation ?? "unknown",
              command: event.display.command,
            });
          }
          break;
        case "interrupt_resolved":
          if (event.kind === "auth") {
            const connectedIntegrations = event.responsePayload?.connectedIntegrations ?? [];
            const remaining = (event.display.authSpec?.integrations ?? []).filter(
              (integration) => !connectedIntegrations.includes(integration),
            );
            await Promise.all(
              connectedIntegrations.map((connected) =>
                callbacks.onAuthProgress?.(connected, remaining),
              ),
            );
            await callbacks.onAuthResult?.(
              event.status === "accepted",
              event.display.authSpec?.integrations,
            );
          } else {
            const toolUseId = event.providerToolUseId;
            const decision = event.status === "accepted" ? "approved" : "denied";
            await callbacks.onApprovalResult?.(toolUseId, decision);
            await callbacks.onApproval?.({
              toolUseId,
              toolName: event.display.title,
              toolInput: event.display.toolInput ?? {},
              integration: event.display.integration ?? "cmdclaw",
              operation: event.display.operation ?? "unknown",
              command: event.display.command,
              status: decision,
              questionAnswers: event.responsePayload?.questionAnswers,
            });
          }
          break;
        case "sandbox_file":
          await callbacks.onSandboxFile?.({
            fileId: event.fileId,
            path: event.path,
            filename: event.filename,
            mimeType: event.mimeType,
            sizeBytes: event.sizeBytes,
          });
          break;
        case "done":
          conversationId = event.conversationId;
          await callbacks.onDone?.(
            event.generationId,
            event.conversationId,
            event.messageId,
            event.usage,
            event.artifacts,
          );
          break;
        case "error":
          if (!signal?.aborted && shouldReconnectWithCursor(event)) {
            shouldReconnect = true;
            break;
          }
          await callbacks.onError?.(
            normalizeGenerationError(event.message, GENERATION_ERROR_PHASES.STREAM),
          );
          break;
        case "cancelled":
          await callbacks.onCancelled?.({
            generationId: event.generationId,
            conversationId: event.conversationId,
            messageId: event.messageId,
          });
          break;
        case "status_change":
          await callbacks.onStatusChange?.(event.status, event.metadata);
          break;
      }

      if (shouldReconnect) {
        break;
      }
    }

    if (!shouldReconnect) {
      break;
    }
  }

  return conversationId && generationId ? { generationId, conversationId } : null;
}
