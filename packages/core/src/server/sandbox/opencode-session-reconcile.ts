import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { eq } from "drizzle-orm";
import { db } from "@bap/db/client";
import { conversationRuntime } from "@bap/db/schema";
import { injectProviderAuth } from "./provider-auth-injection";
import { restoreConversationSessionSnapshot } from "../services/opencode-session-snapshot-service";
import type { OpenCodeMcpRuntimeWarning } from "./opencode-mcp-reconciliation";
import type {
  OpenCodeSandbox,
  OpenCodeSessionConfig,
  OpenCodeSessionOptions,
  OpenCodeSessionResult,
} from "./opencode-session-types";
import { getConversationRuntimeState, replayConversationHistory } from "./opencode-session-support";

// The "reconcile an OpenCode session inside a ready sandbox" algorithm.
//
// Given a connected runtime client and a wrapped sandbox (already booted),
// this resolves the session a turn should run against by walking the same
// precedence every provider uses: reuse a still-live session, else restore a
// persisted snapshot, else create a fresh session and replay history. This is
// the one place that decision tree lives; both the standalone-session path and
// the split sandbox-init/agent-connect path call it.

async function clearStoredSessionId(runtimeId: string | null): Promise<void> {
  if (!runtimeId) {
    return;
  }
  await db
    .update(conversationRuntime)
    .set({ sessionId: null })
    .where(eq(conversationRuntime.id, runtimeId));
}

export async function reconcileOpenCodeSession(input: {
  config: OpenCodeSessionConfig;
  options: OpenCodeSessionOptions | undefined;
  client: OpencodeClient;
  sandbox: OpenCodeSandbox;
  reused: boolean;
  mcpWarnings?: OpenCodeMcpRuntimeWarning[];
}): Promise<OpenCodeSessionResult> {
  const { config, options, client, sandbox, reused } = input;
  const mcpWarnings = input.mcpWarnings;
  const withWarnings = <T extends Omit<OpenCodeSessionResult, "mcpWarnings">>(
    result: T,
  ): OpenCodeSessionResult => (mcpWarnings === undefined ? result : { ...result, mcpWarnings });

  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const runtimeId = runtimeState?.runtimeId ?? null;
  const existingSessionId = runtimeState?.sessionId ?? null;

  if (existingSessionId && reused) {
    const existingSession = await client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: sandbox.sandboxId,
      });
      return withWarnings({
        client,
        sessionId: existingSessionId,
        sandbox,
        sessionSource: "live_session",
      });
    }

    await clearStoredSessionId(runtimeId);
  } else if (existingSessionId && !reused) {
    await clearStoredSessionId(runtimeId);
  }

  if (!reused && options?.allowSnapshotRestore !== false) {
    try {
      const restoredSnapshot = await restoreConversationSessionSnapshot({
        conversationId: config.conversationId,
        sandbox: {
          exec: (command, opts) =>
            sandbox.commands.run(command, {
              timeoutMs: opts?.timeoutMs,
              envs: opts?.env,
              background: opts?.background,
              onStderr: opts?.onStderr,
            }),
          writeFile: (path, content) => sandbox.files.write(path, content),
        },
        client,
      });
      if (restoredSnapshot) {
        if (config.userId) {
          await injectProviderAuth(client, config.userId, {
            openAIAuthSource: config.openAIAuthSource,
          });
        }

        options?.onLifecycle?.("session_reused", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          sandboxId: sandbox.sandboxId,
          restoredFromSnapshot: true,
        });
        options?.onLifecycle?.("session_init_completed", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          restoredFromSnapshot: true,
        });
        return withWarnings({
          client,
          sessionId: restoredSnapshot.sessionId,
          sandbox,
          sessionSource: "restored_snapshot",
        });
      }
    } catch (error) {
      console.warn(
        `[OpenCodeSession] Failed to restore snapshot for conversation ${config.conversationId}:`,
        error,
      );
    }
  }

  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
  });

  const sessionResult = await client.session.create({
    title: options?.title || "Conversation",
  });
  if (sessionResult.error || !sessionResult.data) {
    const details = sessionResult.error ? JSON.stringify(sessionResult.error) : "missing_data";
    throw new Error(`Failed to create OpenCode session: ${details}`);
  }
  const sessionId = sessionResult.data.id;
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: sandbox.sandboxId,
  });

  if (config.userId) {
    await injectProviderAuth(client, config.userId, {
      openAIAuthSource: config.openAIAuthSource,
    });
  }

  if (options?.replayHistory) {
    options.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    await replayConversationHistory(client, sessionId, config.conversationId);
    options.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
    });
  }

  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
  });

  return withWarnings({
    client,
    sessionId,
    sandbox,
    sessionSource: "created_session",
  });
}
