import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { eq } from "drizzle-orm";
import { Sandbox } from "e2b";
import { env } from "../../../env";
import { resolvePublicCallbackBaseUrl } from "../../../lib/worktree-routing";
import { db } from "@bap/db/client";
import { conversation, conversationRuntime } from "@bap/db/schema";
import { generationLifecyclePolicy } from "../../services/lifecycle-policy";
import { logger, type ObservabilityContext } from "../../utils/observability";

// Use custom template with OpenCode pre-installed
export const TEMPLATE_NAME = env.E2B_DAYTONA_SANDBOX_NAME || "bap-agent-dev";
export const SANDBOX_TIMEOUT_MS = generationLifecyclePolicy.activeSandboxTimeoutMs;

export const DEFAULT_SANDBOX_MODEL = "anthropic/claude-sonnet-4-6";

export function resolveSandboxAppUrl(): string {
  return resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    viteAppUrl: env.VITE_APP_URL,
    nodeEnv: process.env.NODE_ENV,
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

export interface SandboxState {
  sandbox: Sandbox;
  client: OpencodeClient;
  serverUrl: string;
  reused: boolean;
}

export type SessionInitStage =
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

export type SessionInitLifecycleCallback = (
  stage: SessionInitStage,
  details?: Record<string, unknown>,
) => void;

export async function getConversationRuntimeState(conversationId: string): Promise<{
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
    model: row.model ?? DEFAULT_SANDBOX_MODEL,
  };
}

export async function connectSandboxById(sandboxId: string): Promise<Sandbox | null> {
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

export async function applySandboxTimeout(sandbox: Sandbox): Promise<void> {
  const timeoutApi = sandbox as Sandbox & {
    setTimeout?: (timeoutMs: number) => Promise<unknown>;
  };
  if (typeof timeoutApi.setTimeout === "function") {
    await timeoutApi.setTimeout(SANDBOX_TIMEOUT_MS);
  }
}

export function logLifecycle(
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

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
