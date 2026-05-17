import type { McpOAuthSession } from "@cmdclaw/core/server/executor/mcp-oauth";
import { consumePending, getPending, storePending } from "@/server/ai/pending-oauth";

const EXECUTOR_SOURCE_OAUTH_PROVIDER_PREFIX = "executor_source:";

type PendingExecutorSourceOAuthPayload = {
  redirectUrl: string;
  session: McpOAuthSession;
};

function providerKeyForSource(sourceId: string): string {
  return `${EXECUTOR_SOURCE_OAUTH_PROVIDER_PREFIX}${sourceId}`;
}

function parsePendingPayload(raw: string): PendingExecutorSourceOAuthPayload {
  const parsed = JSON.parse(raw) as PendingExecutorSourceOAuthPayload;
  if (!parsed || typeof parsed !== "object" || typeof parsed.redirectUrl !== "string") {
    throw new Error("Invalid executor source OAuth payload.");
  }
  if (!parsed.session || typeof parsed.session !== "object") {
    throw new Error("Missing executor source OAuth session.");
  }
  return parsed;
}

export async function storeExecutorSourceOAuthPending(input: {
  state: string;
  userId: string;
  sourceId: string;
  redirectUrl: string;
  session: McpOAuthSession;
}) {
  await storePending(input.state, {
    userId: input.userId,
    provider: providerKeyForSource(input.sourceId),
    codeVerifier: JSON.stringify({
      redirectUrl: input.redirectUrl,
      session: input.session,
    } satisfies PendingExecutorSourceOAuthPayload),
  });
}

async function readExecutorSourceOAuthPending(
  state: string,
  reader: typeof getPending | typeof consumePending,
) {
  const pending = await reader(state);
  if (!pending || !pending.provider.startsWith(EXECUTOR_SOURCE_OAUTH_PROVIDER_PREFIX)) {
    return undefined;
  }

  const sourceId = pending.provider.slice(EXECUTOR_SOURCE_OAUTH_PROVIDER_PREFIX.length);
  if (!sourceId) {
    return undefined;
  }

  return {
    userId: pending.userId,
    sourceId,
    ...parsePendingPayload(pending.codeVerifier),
  };
}

export async function consumeExecutorSourceOAuthPending(state: string) {
  return readExecutorSourceOAuthPending(state, consumePending);
}
