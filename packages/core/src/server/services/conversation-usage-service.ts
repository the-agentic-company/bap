import { env } from "../../env";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "../../lib/chat-model-defaults";
import {
  normalizeModelAuthSource,
  type ProviderAuthSource,
} from "../../lib/provider-auth-source";
import { getOrCreateConversationRuntime } from "../sandbox/core/orchestrator";
import { resolveRuntimeSelection } from "../sandbox/selection/policy-resolver";

type ConversationUsageSource = "live_session" | "restored_snapshot";

type ConversationUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  assistantMessageCount: number;
  sessionId: string;
  source: ConversationUsageSource;
};

type SessionMessageUsageTotals = Omit<ConversationUsage, "sessionId" | "source">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function aggregateConversationUsageFromSessionMessages(
  payload: unknown,
): SessionMessageUsageTotals {
  if (!Array.isArray(payload)) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      assistantMessageCount: 0,
    };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let assistantMessageCount = 0;

  for (const item of payload) {
    if (!isRecord(item)) {
      continue;
    }

    const info = isRecord(item.info) ? item.info : null;
    if (!info || info.role !== "assistant") {
      continue;
    }

    assistantMessageCount += 1;

    const tokens = isRecord(info.tokens) ? info.tokens : null;
    inputTokens += toNonNegativeNumber(tokens?.input);
    outputTokens += toNonNegativeNumber(tokens?.output);
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    assistantMessageCount,
  };
}

async function getConversationUsageFromOpenCodeSession(input: {
  conversationId: string;
  userId: string;
  model?: string | null;
  authSource?: ProviderAuthSource | null;
  sandboxProviderOverride?: "e2b" | "daytona" | "docker";
  runtimeHarness?: string | null;
}): Promise<ConversationUsage> {
  const model = input.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL;

  if (input.runtimeHarness && input.runtimeHarness !== "opencode") {
    throw new Error("Conversation usage is unavailable for this runtime harness.");
  }

  const selection = resolveRuntimeSelection({
    model,
    sandboxProviderOverride: input.sandboxProviderOverride,
  });

  const runtimeHarness = input.runtimeHarness ?? selection.runtimeHarness;
  if (runtimeHarness !== "opencode") {
    throw new Error("Conversation usage is unavailable for this runtime harness.");
  }

  const runtime = await getOrCreateConversationRuntime(
    {
      conversationId: input.conversationId,
      userId: input.userId,
      model,
      anthropicApiKey: env.ANTHROPIC_API_KEY || "",
      openAIAuthSource: normalizeModelAuthSource({
        model,
        authSource: input.authSource,
      }),
    },
    {
      allowSnapshotRestore: true,
      replayHistory: false,
      sandboxProviderOverride: selection.sandboxProvider,
    },
  );

  const sessionSource = runtime.sessionSource ?? "live_session";
  if (sessionSource === "created_session") {
    throw new Error(
      "Conversation usage is unavailable because the OpenCode session could not be restored.",
    );
  }

  const response = await runtime.harnessClient.messages({
    sessionID: runtime.session.id,
  });

  if (response.error) {
    throw new Error(
      response.error instanceof Error
        ? response.error.message
        : "Failed to load OpenCode session messages.",
    );
  }

  const totals = aggregateConversationUsageFromSessionMessages(response.data);

  return {
    ...totals,
    sessionId: runtime.session.id,
    source: sessionSource === "restored_snapshot" ? "restored_snapshot" : "live_session",
  };
}
