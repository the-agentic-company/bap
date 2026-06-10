import { describe, expect, it } from "vitest";
import { normalizeChatModelReference } from "./chat-model-reference";

describe("normalizeChatModelReference", () => {
  it("keeps provider/model references unchanged", () => {
    expect(normalizeChatModelReference("anthropic/claude-sonnet-4-6")).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });

  it("upgrades legacy anthropic ids", () => {
    expect(normalizeChatModelReference("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("upgrades legacy openai ids", () => {
    expect(normalizeChatModelReference("gpt-5.5")).toBe("openai/gpt-5.5");
    expect(normalizeChatModelReference("gpt-5.4-mini")).toBe("openai/gpt-5.4-mini");
  });
});
