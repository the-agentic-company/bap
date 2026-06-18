import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { asc, eq } from "drizzle-orm";
import { env } from "../../env";
import { db } from "@bap/db/client";
import { conversationRuntime, message, type ContentPart } from "@bap/db/schema";
import { COMPACTION_SUMMARY_PREFIX, SESSION_BOUNDARY_PREFIX } from "../services/session-constants";
import { resolveSandboxRuntimeAppUrl } from "./prep/runtime-env-prep";
import { getSandboxReadinessUrl } from "./opencode-runtime";
import type { OpenCodeSessionConfig } from "./opencode-session-types";

const OPENCODE_READINESS_FETCH_TIMEOUT_MS = 2_000;

export function buildSandboxBootstrapEnv(config: OpenCodeSessionConfig): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANVIL_API_KEY: env.ANVIL_API_KEY || "",
    APP_URL: resolveSandboxRuntimeAppUrl(),
    APP_SERVER_SECRET: env.APP_SERVER_SECRET || "",
    CONVERSATION_ID: config.conversationId,
    ...config.integrationEnvs,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeShell(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

export function appendDaytonaAuth(url: string, token?: string): string {
  if (!token) {
    return url;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has("DAYTONA_SANDBOX_AUTH_KEY")) {
    parsed.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  }
  return parsed.toString();
}

export async function getConversationRuntimeState(conversationId: string): Promise<{
  runtimeId: string;
  sandboxId: string | null;
  sessionId: string | null;
} | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(conversationRuntime.conversationId, conversationId),
    columns: {
      id: true,
      sandboxId: true,
      sessionId: true,
    },
  });

  if (!runtime) {
    return null;
  }

  return {
    runtimeId: runtime.id,
    sandboxId: runtime.sandboxId,
    sessionId: runtime.sessionId,
  };
}

export async function waitForServer(
  url: string,
  model: string,
  token?: string,
  maxWait = 30_000,
): Promise<void> {
  const readinessUrl = appendDaytonaAuth(getSandboxReadinessUrl(url, model), token);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWait) {
    const remainingMs = maxWait - (Date.now() - startedAt);
    const fetchTimeoutMs = Math.max(
      1,
      Math.min(OPENCODE_READINESS_FETCH_TIMEOUT_MS, remainingMs),
    );
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
      const response = await fetch(readinessUrl, {
        method: "GET",
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `OpenCode server failed readiness check (url=${readinessUrl}, waitedMs=${maxWait})`,
  );
}

export async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
): Promise<void> {
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

  const historyContext = messagesAfterSummary
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      }
      if (m.role === "assistant") {
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              const part = p as ContentPart;
              if (part.type === "text") {
                return part.text;
              }
              if (part.type === "tool_use") {
                return `[Used ${part.name}]`;
              }
              if (part.type === "tool_result") {
                return "[Result received]";
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
