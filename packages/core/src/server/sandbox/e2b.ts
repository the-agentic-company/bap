import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { eq, asc, isNotNull } from "drizzle-orm";
import { Sandbox } from "e2b";
import { env } from "../../env";
import { resolvePublicCallbackBaseUrl } from "../../lib/worktree-routing";
import { db } from "@cmdclaw/db/client";
import { message, conversation, conversationRuntime } from "@cmdclaw/db/schema";
import type { ProviderAuthSource } from "../../lib/provider-auth-source";
import { getResolvedProviderAuth } from "../control-plane/subscription-providers";
import { resolvePreferredCommunitySkillsForUser } from "../services/integration-skill-service";
import { listAccessibleEnabledSkillsForUser } from "../services/workspace-skill-service";
import { conversationRuntimeService } from "../services/conversation-runtime-service";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";
import { restoreConversationSessionSnapshot } from "../services/opencode-session-snapshot-service";
import { COMPACTION_SUMMARY_PREFIX, SESSION_BOUNDARY_PREFIX } from "../services/session-constants";
import { downloadFromS3 } from "../storage/s3-client";
import { logger, type ObservabilityContext } from "../utils/observability";
import type { SandboxBackend, ExecuteResult } from "./types";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
} from "./opencode-runtime";
import { toRuntimeProviderAuthPayload } from "./provider-auth-runtime";

// Use custom template with OpenCode pre-installed
const TEMPLATE_NAME = env.E2B_DAYTONA_SANDBOX_NAME || "cmdclaw-agent-dev";
const SANDBOX_TIMEOUT_MS = generationLifecyclePolicy.activeSandboxTimeoutMs;

function resolveSandboxAppUrl(): string {
  return resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    nextPublicAppUrl: env.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

interface SandboxState {
  sandbox: Sandbox;
  client: OpencodeClient;
  serverUrl: string;
  reused: boolean;
}

async function getConversationRuntimeState(conversationId: string): Promise<{
  runtimeId: string;
  sandboxId: string | null;
  sessionId: string | null;
  model: string;
} | null> {
  const row = await db
    .select({
      runtimeId: conversationRuntime.id,
      sandboxId: conversationRuntime.sandboxId,
      sessionId: conversationRuntime.sessionId,
      model: conversation.model,
    })
    .from(conversationRuntime)
    .innerJoin(conversation, eq(conversation.id, conversationRuntime.conversationId))
    .where(eq(conversationRuntime.conversationId, conversationId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!row) {
    return null;
  }

  return {
    runtimeId: row.runtimeId,
    sandboxId: row.sandboxId,
    sessionId: row.sessionId,
    model: row.model ?? "anthropic/claude-sonnet-4-6",
  };
}

async function connectSandboxById(sandboxId: string): Promise<Sandbox | null> {
  const sandboxApi = Sandbox as unknown as {
    connect?: (
      id: string,
      options?: {
        timeoutMs?: number;
      },
    ) => Promise<Sandbox>;
  };
  if (!sandboxApi.connect) {
    return null;
  }
  try {
    const sandbox = await sandboxApi.connect(sandboxId, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
    });
    await applySandboxTimeout(sandbox);
    return sandbox;
  } catch {
    return null;
  }
}

async function applySandboxTimeout(sandbox: Sandbox): Promise<void> {
  const timeoutApi = sandbox as Sandbox & {
    setTimeout?: (timeoutMs: number) => Promise<unknown>;
  };
  if (typeof timeoutApi.setTimeout === "function") {
    await timeoutApi.setTimeout(SANDBOX_TIMEOUT_MS);
  }
}

function logLifecycle(
  event: string,
  details: Record<string, unknown>,
  context: ObservabilityContext = {},
): void {
  const enrichedContext: ObservabilityContext = { source: "e2b", ...context };
  logger.info({
    event: event,
    ...enrichedContext,
    ...details,
  });
}

export interface SandboxConfig {
  conversationId: string;
  generationId?: string;
  userId?: string;
  model: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
  openAIAuthSource?: "user" | "shared" | null;
}

type SessionInitStage =
  | "sandbox_checking_cache"
  | "sandbox_reused"
  | "sandbox_creating"
  | "sandbox_created"
  | "opencode_starting"
  | "opencode_waiting_ready"
  | "opencode_ready"
  | "session_reused"
  | "session_creating"
  | "session_created"
  | "session_replay_started"
  | "session_replay_completed"
  | "session_init_completed";

type SessionInitLifecycleCallback = (
  stage: SessionInitStage,
  details?: Record<string, unknown>,
) => void;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Get or create a sandbox without waiting for the OpenCode runtime to be ready.
 */
export async function getOrCreateBareSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<{
  sandbox: Sandbox;
  reused: boolean;
}> {
  const telemetryContext: ObservabilityContext = {
    ...telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });

  const runtimeState = await getConversationRuntimeState(config.conversationId);

  if (runtimeState?.sandboxId) {
    const connected = await connectSandboxById(runtimeState.sandboxId);
    if (connected) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: connected.sandboxId,
      });
      return {
        sandbox: connected,
        reused: true,
      };
    }

    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  const hasApiKey = !!config.anthropicApiKey;
  const vmCreateStart = Date.now();
  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: TEMPLATE_NAME,
  });
  logLifecycle(
    "VM_START_REQUESTED",
    {
      conversationId: config.conversationId,
      template: TEMPLATE_NAME,
      hasAnthropicApiKey: hasApiKey,
      timeoutMs: SANDBOX_TIMEOUT_MS,
    },
    telemetryContext,
  );

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(TEMPLATE_NAME, {
      metadata: {
        conversationId: config.conversationId,
        userId: config.userId || "",
      },
      envs: {
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANVIL_API_KEY: env.ANVIL_API_KEY || "",
        APP_URL: resolveSandboxAppUrl(),
        CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
        CONVERSATION_ID: config.conversationId,
        ...config.integrationEnvs,
      },
      timeoutMs: SANDBOX_TIMEOUT_MS,
      lifecycle: {
        onTimeout: "kill",
        autoResume: false,
      },
    });
    await applySandboxTimeout(sandbox);
  } catch (error) {
    logger.error({
      event: "VM_START_FAILED",
      ...telemetryContext,
      ...{
        conversationId: config.conversationId,
        template: TEMPLATE_NAME,
        durationMs: Date.now() - vmCreateStart,
        error: formatErrorMessage(error),
        hasAnthropicApiKey: hasApiKey,
        hasE2BApiKey: Boolean(env.E2B_API_KEY),
        integrationEnvCount: Object.keys(config.integrationEnvs || {}).length,
      },
    });
    throw error;
  }
  logLifecycle(
    "VM_STARTED",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      template: TEMPLATE_NAME,
      durationMs: Date.now() - vmCreateStart,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    durationMs: Date.now() - vmCreateStart,
  });

  try {
    await sandbox.commands.run(`echo "export SANDBOX_ID=${sandbox.sandboxId}" >> ~/.bashrc`);
  } catch (error) {
    logger.warn({
      event: "VM_SET_SANDBOX_ID_FAILED",
      ...{ ...telemetryContext, sandboxId: sandbox.sandboxId },
      ...{
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        error: formatErrorMessage(error),
      },
    });
  }

  return { sandbox, reused: false };
}

/**
 * Get or create a sandbox with OpenCode server running inside
 */
async function getOrCreateSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<SandboxState> {
  const telemetryContext: ObservabilityContext = {
    ...telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });

  const runtimeState = await getConversationRuntimeState(config.conversationId);

  if (runtimeState?.sandboxId) {
    const connected = await connectSandboxById(runtimeState.sandboxId);
    if (connected) {
      const serverPort = getSandboxServerPort(config.model);
      const serverUrl = `https://${connected.getHost(serverPort)}`;
      const health = await fetch(getSandboxReadinessUrl(serverUrl, config.model), {
        method: "GET",
      }).catch(() => null);
      if (health?.ok) {
        onLifecycle?.("sandbox_reused", {
          conversationId: config.conversationId,
          sandboxId: connected.sandboxId,
        });
        const client = await createSandboxRuntimeClient({ serverUrl, model: config.model });
        return {
          sandbox: connected,
          client,
          serverUrl,
          reused: true,
        };
      }
    }

    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  // Create new sandbox
  const hasApiKey = !!config.anthropicApiKey;
  const vmCreateStart = Date.now();
  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: TEMPLATE_NAME,
  });
  logLifecycle(
    "VM_START_REQUESTED",
    {
      conversationId: config.conversationId,
      template: TEMPLATE_NAME,
      hasAnthropicApiKey: hasApiKey,
      timeoutMs: SANDBOX_TIMEOUT_MS,
    },
    telemetryContext,
  );

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(TEMPLATE_NAME, {
      metadata: {
        conversationId: config.conversationId,
        userId: config.userId || "",
      },
      envs: {
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANVIL_API_KEY: env.ANVIL_API_KEY || "",
        APP_URL: resolveSandboxAppUrl(),
        CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
        CONVERSATION_ID: config.conversationId,
        ...config.integrationEnvs,
      },
      timeoutMs: SANDBOX_TIMEOUT_MS,
      lifecycle: {
        onTimeout: "kill",
        autoResume: false,
      },
    });
    await applySandboxTimeout(sandbox);
  } catch (error) {
    logger.error({
      event: "VM_START_FAILED",
      ...telemetryContext,
      ...{
        conversationId: config.conversationId,
        template: TEMPLATE_NAME,
        durationMs: Date.now() - vmCreateStart,
        error: formatErrorMessage(error),
        hasAnthropicApiKey: hasApiKey,
        hasE2BApiKey: Boolean(env.E2B_API_KEY),
        integrationEnvCount: Object.keys(config.integrationEnvs || {}).length,
      },
    });
    throw error;
  }
  logLifecycle(
    "VM_STARTED",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      template: TEMPLATE_NAME,
      durationMs: Date.now() - vmCreateStart,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    durationMs: Date.now() - vmCreateStart,
  });

  // Set SANDBOX_ID env var (needed by plugin)
  try {
    await sandbox.commands.run(`echo "export SANDBOX_ID=${sandbox.sandboxId}" >> ~/.bashrc`);
  } catch (error) {
    logger.warn({
      event: "VM_SET_SANDBOX_ID_FAILED",
      ...{ ...telemetryContext, sandboxId: sandbox.sandboxId },
      ...{
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        error: formatErrorMessage(error),
      },
    });
  }

  const serverPort = getSandboxServerPort(config.model);
  const serverUrl = `https://${sandbox.getHost(serverPort)}`;

  // Create SDK client pointing to sandbox's OpenCode server
  const client = await createSandboxRuntimeClient({ serverUrl, model: config.model });
  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    serverUrl,
  });
  return { sandbox, client, serverUrl, reused: false };
}

/**
 * Get the OpenCode client for a conversation's sandbox
 */
export async function getSandboxStateDurable(
  conversationId: string,
): Promise<SandboxState | undefined> {
  const runtimeState = await getConversationRuntimeState(conversationId);
  const model = runtimeState?.model ?? "anthropic/claude-sonnet-4-6";
  if (runtimeState?.sandboxId) {
    const connectedByConversation = await connectSandboxById(runtimeState.sandboxId);
    if (connectedByConversation) {
      const serverPort = getSandboxServerPort(model);
      const serverUrl = `https://${connectedByConversation.getHost(serverPort)}`;
      const health = await fetch(getSandboxReadinessUrl(serverUrl, model), {
        method: "GET",
      }).catch(() => null);
      if (health?.ok) {
        return {
          sandbox: connectedByConversation,
          client: await createSandboxRuntimeClient({ serverUrl, model }),
          serverUrl,
          reused: true,
        };
      }
    }

    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
    return undefined;
  }

  if (!runtimeState?.sandboxId) {
    return undefined;
  }

  const connected = await connectSandboxById(runtimeState.sandboxId);
  if (!connected) {
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
    return undefined;
  }
  const serverPort = getSandboxServerPort(model);
  const serverUrl = `https://${connected.getHost(serverPort)}`;
  const health = await fetch(getSandboxReadinessUrl(serverUrl, model), {
    method: "GET",
  }).catch(() => null);
  if (!health?.ok) {
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
    return undefined;
  }

  const hydrated: SandboxState = {
    sandbox: connected,
    client: await createSandboxRuntimeClient({ serverUrl, model }),
    serverUrl,
    reused: true,
  };
  return hydrated;
}

/**
 * Get or create an OpenCode session within a sandbox
 * Handles conversation replay for session recovery
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
 * Replay conversation history to a new OpenCode session
 * Uses noReply: true to inject context without generating a response
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

/**
 * Inject stored subscription provider OAuth tokens into an OpenCode server.
 * Called after sandbox creation to give OpenCode access to the user's
 * ChatGPT/Gemini/Kimi subscriptions.
 */
export async function injectProviderAuth(
  client: OpencodeClient,
  userId: string,
  options?: { openAIAuthSource?: ProviderAuthSource | null },
): Promise<void> {
  try {
    const [openaiAuth, googleAuth, kimiAuth] = await Promise.all([
      getResolvedProviderAuth({
        userId,
        provider: "openai",
        authSource: options?.openAIAuthSource,
      }),
      getResolvedProviderAuth({
        userId,
        provider: "google",
        authSource: "shared",
      }),
      getResolvedProviderAuth({
        userId,
        provider: "kimi",
        authSource: "user",
      }),
    ]);

    const auths = [openaiAuth, googleAuth, kimiAuth]
      .filter((auth): auth is NonNullable<typeof auth> => Boolean(auth))
      .map(toRuntimeProviderAuthPayload);
    await Promise.all(
      auths.map(async (auth) => {
        try {
          await client.auth.set(auth);
          console.log(`[E2B] Injected ${auth.providerID} auth for user ${userId}`);
        } catch (err) {
          console.error(`[E2B] Failed to inject ${auth.providerID} auth:`, err);
        }
      }),
    );
  } catch (err) {
    console.error("[E2B] Failed to load provider auths:", err);
  }
}

async function killConnectedSandbox(
  runtimeId: string,
  conversationId: string,
  sandbox: Sandbox,
  reason: "manual_kill" | "paused_cleanup",
): Promise<void> {
  try {
    await sandbox.kill();
    await conversationRuntimeService.markRuntimeDead(runtimeId);
    logLifecycle(
      "VM_TERMINATED",
      {
        conversationId,
        sandboxId: sandbox.sandboxId,
        reason,
      },
      { source: "e2b", conversationId, sandboxId: sandbox.sandboxId },
    );
  } catch (error) {
    console.error("[E2B] Failed to kill sandbox:", error);
  }
}

/**
 * Kill a sandbox for a conversation
 */
export async function killSandbox(
  conversationId: string,
  reason: "manual_kill" | "paused_cleanup" = "manual_kill",
): Promise<void> {
  const runtimeState = await getConversationRuntimeState(conversationId);
  const sandboxId = runtimeState?.sandboxId ?? null;

  if (!sandboxId) {
    return;
  }

  const sandbox = await connectSandboxById(sandboxId);
  if (!sandbox) {
    if (runtimeState) {
      await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
    }
    return;
  }

  if (!runtimeState) {
    return;
  }

  await killConnectedSandbox(runtimeState.runtimeId, conversationId, sandbox, reason);
}

/**
 * Cleanup all sandboxes (call on server shutdown)
 */
async function cleanupAllSandboxes(): Promise<void> {
  const knownSandboxes = await db.query.conversationRuntime.findMany({
    where: isNotNull(conversationRuntime.sandboxId),
    columns: { sandboxId: true },
  });
  const uniqueSandboxIds = Array.from(
    new Set(
      knownSandboxes
        .map((row) => row.sandboxId)
        .filter((sandboxId): sandboxId is string => !!sandboxId),
    ),
  );
  const promises = uniqueSandboxIds.map(async (sandboxId) => {
    const sandbox = await connectSandboxById(sandboxId);
    if (!sandbox) {
      return;
    }
    await sandbox.kill().catch(console.error);
  });
  await Promise.all(promises);
}

/**
 * Check if E2B is configured
 */
export function isE2BConfigured(): boolean {
  return !!env.E2B_API_KEY;
}

/**
 * Write user's skills to the sandbox as AGENTS.md format
 */
async function writeSkillsToSandbox(sandbox: Sandbox, userId: string): Promise<string[]> {
  const skills = await listAccessibleEnabledSkillsForUser(userId);

  if (skills.length === 0) {
    return [];
  }

  console.log(`[E2B] Writing ${skills.length} skills to sandbox`);

  // Create skills directory
  await sandbox.commands.run("mkdir -p /app/.opencode/skills");

  const writtenSkills: string[] = [];
  let agentsContent = "# Custom Skills\n\n";

  await skills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    // Add skill to AGENTS.md
    agentsContent += `## ${s.displayName}\n\n`;
    agentsContent += `${s.description}\n\n`;
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`;

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await sandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sandbox.files.write(filePath, file.content);
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.storageKey);
          const docPath = `${skillDir}/${doc.path ?? doc.filename}`;
          const lastSlash = docPath.lastIndexOf("/");
          const parentDir = docPath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          const arrayBuffer = new Uint8Array(buffer).buffer;
          await sandbox.files.write(docPath, arrayBuffer);
          console.log(
            `[E2B] Written document: ${doc.path ?? doc.filename} (${doc.sizeBytes} bytes)`,
          );
        } catch (error) {
          console.error(`[E2B] Failed to write document ${doc.path ?? doc.filename}:`, error);
        }
      }),
    );

    writtenSkills.push(s.name);
    console.log(
      `[E2B] Written skill: ${s.name} (${s.files.length} files, ${s.documents.length} documents)`,
    );
  }, Promise.resolve());

  // Write AGENTS.md
  await sandbox.files.write("/app/.opencode/AGENTS.md", agentsContent);

  return writtenSkills;
}

/**
 * Get the system prompt addition for skills
 */
function getSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return `
# Custom Skills

You have access to custom skills in /app/.opencode/skills/. Each skill directory contains:
- A SKILL.md file with instructions
- Any associated documents (PDFs, images, etc.) at the same level

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

/**
 * Write resolved community integration skills selected by the user to sandbox.
 */
async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: Sandbox,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  const resolved = await resolvePreferredCommunitySkillsForUser(userId, allowedSlugs);
  if (resolved.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/integration-skills");
  const written: string[] = [];

  await Promise.all(
    resolved.map(async (skill) => {
      const skillDir = `/app/.opencode/integration-skills/${skill.slug}`;
      await sandbox.commands.run(`mkdir -p "${skillDir}"`);

      await Promise.all(
        skill.files.map(async (file) => {
          const filePath = `${skillDir}/${file.path}`;
          const lastSlash = filePath.lastIndexOf("/");
          const parentDir = filePath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          await sandbox.files.write(filePath, file.content);
        }),
      );

      written.push(skill.slug);
    }),
  );

  return written;
}

function getIntegrationSkillsSystemPrompt(skillSlugs: string[]): string {
  if (skillSlugs.length === 0) {
    return "";
  }

  return `
# Community Integration Skills

Use community integration skills for these slugs (preferred over official skill variants):
${skillSlugs.map((slug) => `- ${slug}`).join("\n")}

Community files are available in:
/app/.opencode/integration-skills/<slug>/

When a slug is listed above, prioritize that community skill's SKILL.md and resources for that integration.
`;
}

// ========== E2BSandboxBackend ==========

/**
 * SandboxBackend implementation backed by E2B cloud sandboxes.
 * Wraps existing E2B functions into the SandboxBackend interface.
 */
export class E2BSandboxBackend implements SandboxBackend {
  private sandbox: Sandbox | null = null;
  private conversationId: string | null = null;

  async setup(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    // Sandbox is lazily created via getOrCreateSandbox
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    const result = await state.sandbox.commands.run(command, {
      timeoutMs: opts?.timeout,
      envs: opts?.env,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    if (typeof content === "string") {
      await state.sandbox.files.write(path, content);
    } else {
      await state.sandbox.files.write(path, content.buffer as ArrayBuffer);
    }
  }

  async readFile(path: string): Promise<string> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    return await state.sandbox.files.read(path);
  }

  async teardown(): Promise<void> {
    if (this.conversationId) {
      await killSandbox(this.conversationId);
      this.conversationId = null;
      this.sandbox = null;
    }
  }

  isAvailable(): boolean {
    return isE2BConfigured();
  }
}

// ---------------------------------------------------------------------------
// Admin utilities for listing and killing sandboxes
// ---------------------------------------------------------------------------

export async function listAllE2BSandboxes(): Promise<
  Array<{
    sandboxId: string;
    templateId: string;
    state: "running" | "paused";
    startedAt: Date;
    endAt: Date;
    cpuCount: number;
    memoryMB: number;
    metadata: Record<string, string>;
  }>
> {
  const paginator = Sandbox.list();
  const results: Array<{
    sandboxId: string;
    templateId: string;
    state: "running" | "paused";
    startedAt: Date;
    endAt: Date;
    cpuCount: number;
    memoryMB: number;
    metadata: Record<string, string>;
  }> = [];

  while (paginator.hasNext) {
    const page = await paginator.nextItems();
    for (const s of page) {
      results.push({
        sandboxId: s.sandboxId,
        templateId: s.templateId,
        state: s.state,
        startedAt: s.startedAt,
        endAt: s.endAt,
        cpuCount: s.cpuCount,
        memoryMB: s.memoryMB,
        metadata: s.metadata,
      });
    }
  }

  return results;
}

export async function killE2BSandboxById(sandboxId: string): Promise<boolean> {
  return Sandbox.kill(sandboxId);
}
