import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTED_CHATGPT_MODEL, resolveDefaultChatModel } from "./chat-model-defaults";

describe("chat-model-defaults", () => {
  it("uses GPT-5.5 as the connected ChatGPT default", () => {
    expect(DEFAULT_CONNECTED_CHATGPT_MODEL).toBe("openai/gpt-5.5");
    expect(
      resolveDefaultChatModel({
        isOpenAIConnected: true,
      }),
    ).toBe("openai/gpt-5.5");
  });
});
