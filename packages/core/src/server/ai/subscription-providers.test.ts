import { describe, expect, it } from "vitest";
import { getProviderModels } from "./subscription-providers";

describe("subscription-providers", () => {
  it("keeps both legacy and current OpenAI ChatGPT models available", () => {
    expect(getProviderModels("openai").map((model) => model.id)).toEqual([
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1-codex",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
  });
});
