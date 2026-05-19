import { describe, expect, it } from "vitest";
import { aggregateConversationUsageFromSessionMessages } from "./conversation-usage-service";

describe("conversation-usage-service", () => {
  it("aggregates assistant token usage from session messages", () => {
    const totals = aggregateConversationUsageFromSessionMessages([
      {
        info: {
          role: "assistant",
          tokens: { input: 10, output: 20 },
        },
      },
      {
        info: {
          role: "user",
        },
      },
      {
        info: {
          role: "assistant",
          tokens: { input: 5, output: 7 },
        },
      },
    ]);

    expect(totals).toEqual({
      inputTokens: 15,
      outputTokens: 27,
      totalTokens: 42,
      assistantMessageCount: 2,
    });
  });

  it("treats missing token fields as zero", () => {
    const totals = aggregateConversationUsageFromSessionMessages([
      {
        info: {
          role: "assistant",
        },
      },
      {
        info: {
          role: "assistant",
          tokens: { input: 12 },
        },
      },
    ]);

    expect(totals).toEqual({
      inputTokens: 12,
      outputTokens: 0,
      totalTokens: 12,
      assistantMessageCount: 2,
    });
  });
});
