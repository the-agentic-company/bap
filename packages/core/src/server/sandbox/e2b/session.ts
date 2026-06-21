import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { eq, asc } from "drizzle-orm";
import { Sandbox } from "e2b";
import { db } from "@bap/db/client";
import { message, conversationRuntime } from "@bap/db/schema";
import { restoreConversationSessionSnapshot } from "../../services/opencode-session-snapshot-service";
import { COMPACTION_SUMMARY_PREFIX, SESSION_BOUNDARY_PREFIX } from "../../services/session-constants";
import type { ObservabilityContext } from "../../utils/observability";
import { injectProviderAuth } from "../provider-auth-injection";
import { getOrCreateSandbox } from "./provisioning";
import {
  getConversationRuntimeState,
  logLifecycle,
  type SandboxConfig,
  type SessionInitLifecycleCallback,
} from "./runtime";

/**
 * Get or create an OpenCode session within a sandbox.
 * Handles conversation replay for session recovery.
 */
export async function getOrCreateSession(
  config: SandboxConfig,
  options?: {
    title?: string;
    replayHistory?: boolean;
    allowSnapshotRestore?: boolean;
    onLifecycle?: SessionInitLifecycleCallback;
    telemetry?: ObservabilityContext;
  },
): Promise<{
  client: OpencodeClient;
  sessionId: string;
  sandbox: Sandbox;
  sessionSource: "live_session" | "restored_snapshot" | "created_session";
}> {
  const telemetryContext: ObservabilityContext = {
    ...options?.telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  const sessionInitStartedAt = Date.now();
  logLifecycle(
    "SESSION_INIT_STARTED",
    {
      conversationId: config.conversationId,
      replayHistory: Boolean(options?.replayHistory),
    },
    telemetryContext,
  );

  const state = await getOrCreateSandbox(config, options?.onLifecycle, telemetryContext);
  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const runtimeId = runtimeState?.runtimeId ?? null;
  const existingSessionId = runtimeState?.sessionId ?? null;

  // Reuse existing session only if we also reused the sandbox that owns it,
  // and the session ID is still valid on that sandbox's OpenCode server.
  if (existingSessionId && state.reused) {
    const existingSession = await state.client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      });
      logLifecycle(
        "SESSION_REUSED",
        {
          conversationId: config.conversationId,
          sessionId: existingSessionId,
          sandboxId: state.sandbox.sandboxId,
          durationMs: Date.now() - sessionInitStartedAt,
        },
        {
          ...telemetryContext,
          sandboxId: state.sandbox.sandboxId,
          sessionId: existingSessionId,
        },
      );
      return {
        client: state.client,
        sessionId: existingSessionId,
        sandbox: state.sandbox,
        sessionSource: "live_session",
      };
    }

    logLifecycle(
      "SESSION_REUSE_INVALID",
      {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      },
      {
        ...telemetryContext,
        sandboxId: state.sandbox.sandboxId,
        sessionId: existingSessionId,
      },
    );
    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  } else if (existingSessionId && !state.reused) {
    logLifecycle(
      "SESSION_REUSE_SKIPPED_SANDBOX_REPLACED",
      {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      },
      {
        ...telemetryContext,
        sandboxId: state.sandbox.sandboxId,
        sessionId: existingSessionId,
      },
    );
    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  }

  if (!state.reused && options?.allowSnapshotRestore !== false) {
    try {
      const restoredSnapshot = await restoreConversationSessionSnapshot({
        conversationId: config.conversationId,
        sandbox: {
          exec: async (command, opts) => {
            const result = await state.sandbox.commands.run(command, {
              timeoutMs: opts?.timeoutMs,
              envs: opts?.env,
              background: opts?.background,
              onStderr: opts?.onStderr,
            });
            return {
              exitCode: result.exitCode ?? 0,
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
            };
          },
          writeFile: async (path, content) => {
            await state.sandbox.files.write(path, content);
          },
        },
        client: state.client,
      });
      if (restoredSnapshot) {
        if (config.userId) {
          await injectProviderAuth(state.client, config.userId, {
            openAIAuthSource: config.openAIAuthSource,
          });
        }
        options?.onLifecycle?.("session_reused", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          sandboxId: state.sandbox.sandboxId,
          restoredFromSnapshot: true,
        });
        logLifecycle(
          "SESSION_RESTORED_FROM_SNAPSHOT",
          {
            conversationId: config.conversationId,
            sessionId: restoredSnapshot.sessionId,
            sandboxId: state.sandbox.sandboxId,
            durationMs: Date.now() - sessionInitStartedAt,
          },
          {
            ...telemetryContext,
            sandboxId: state.sandbox.sandboxId,
            sessionId: restoredSnapshot.sessionId,
          },
        );
        options?.onLifecycle?.("session_init_completed", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          durationMs: Date.now() - sessionInitStartedAt,
          restoredFromSnapshot: true,
        });
        return {
          client: state.client,
          sessionId: restoredSnapshot.sessionId,
          sandbox: state.sandbox,
          sessionSource: "restored_snapshot",
        };
      }
    } catch (error) {
      console.warn(
        `[E2B] Failed to restore snapshot for conversation ${config.conversationId}:`,
        error,
      );
    }
  }

  // Create a new session
  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: state.sandbox.sandboxId,
  });
  const sessionCreateStartedAt = Date.now();
  logLifecycle(
    "SESSION_CREATE_REQUESTED",
    {
      conversationId: config.conversationId,
      sandboxId: state.sandbox.sandboxId,
    },
    { ...telemetryContext, sandboxId: state.sandbox.sandboxId },
  );
  const sessionResult = await state.client.session.create({
    title: options?.title || "Conversation",
  });
  if (sessionResult.error || !sessionResult.data) {
    throw new Error("Failed to create OpenCode session");
  }
  const sessionId = sessionResult.data.id;
  logLifecycle(
    "SESSION_CREATED",
    {
      conversationId: config.conversationId,
      sessionId,
      sandboxId: state.sandbox.sandboxId,
      durationMs: Date.now() - sessionCreateStartedAt,
    },
    { ...telemetryContext, sandboxId: state.sandbox.sandboxId, sessionId },
  );
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: state.sandbox.sandboxId,
    durationMs: Date.now() - sessionCreateStartedAt,
  });

  // Inject subscription provider tokens if userId is available
  if (config.userId) {
    await injectProviderAuth(state.client, config.userId, {
      openAIAuthSource: config.openAIAuthSource,
    });
  }

  // Replay conversation history if needed
  if (options?.replayHistory) {
    options?.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    const replayStartedAt = Date.now();
    logLifecycle(
      "SESSION_REPLAY_STARTED",
      {
        conversationId: config.conversationId,
        sessionId,
      },
      { ...telemetryContext, sessionId },
    );
    await replayConversationHistory(state.client, sessionId, config.conversationId);
    logLifecycle(
      "SESSION_REPLAY_COMPLETED",
      {
        conversationId: config.conversationId,
        sessionId,
        durationMs: Date.now() - replayStartedAt,
      },
      { ...telemetryContext, sessionId },
    );
    options?.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
      durationMs: Date.now() - replayStartedAt,
    });
  }

  logLifecycle(
    "SESSION_INIT_COMPLETED",
    {
      conversationId: config.conversationId,
      sessionId,
      durationMs: Date.now() - sessionInitStartedAt,
    },
    { ...telemetryContext, sessionId, sandboxId: state.sandbox.sandboxId },
  );
  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
    durationMs: Date.now() - sessionInitStartedAt,
  });
  return {
    client: state.client,
    sessionId,
    sandbox: state.sandbox,
    sessionSource: "created_session",
  };
}

/**
 * Replay conversation history to a new OpenCode session.
 * Uses noReply: true to inject context without generating a response.
 */
async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
): Promise<void> {
  // Fetch all messages for this conversation
  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) {
    return;
  }

  const boundaryIndex = messages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX),
  );

  const sessionMessages = boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : messages;

  const summaryIndex = sessionMessages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(COMPACTION_SUMMARY_PREFIX),
  );

  const summaryMessage = summaryIndex >= 0 ? sessionMessages[summaryIndex] : undefined;
  const summaryText = summaryMessage
    ? summaryMessage.content.replace(COMPACTION_SUMMARY_PREFIX, "").trim()
    : null;

  const messagesAfterSummary =
    summaryIndex >= 0 ? sessionMessages.slice(summaryIndex + 1) : sessionMessages;

  // Build conversation context
  const historyContext = messagesAfterSummary
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      } else if (m.role === "assistant") {
        // Include tool uses and results for context
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              if (p.type === "text") {
                return p.text;
              }
              if (p.type === "tool_use") {
                return `[Used ${p.name}]`;
              }
              if (p.type === "tool_result") {
                return `[Result received]`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
          return `Assistant: ${parts}`;
        }
        return `Assistant: ${m.content}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  const summaryBlock = summaryText ? `Summary of previous conversation:\n${summaryText}\n\n` : "";

  // Inject history as context using noReply: true
  await client.session.prompt({
    sessionID: sessionId,
    parts: [
      {
        type: "text",
        text: `<conversation_history>\n${summaryBlock}${historyContext}\n</conversation_history>\n\nContinue this conversation. The user's next message follows.`,
      },
    ],
    noReply: true,
  });
}

export { injectProviderAuth };
