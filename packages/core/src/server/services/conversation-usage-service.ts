type SessionMessageUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  assistantMessageCount: number;
};

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
