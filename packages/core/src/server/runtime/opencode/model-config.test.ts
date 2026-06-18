import { describe, expect, it } from "vitest";
import { buildOpenCodeRuntimeModelConfig } from "./model-config";

describe("buildOpenCodeRuntimeModelConfig", () => {
  it("keeps Bap OpenAI references on the OpenAI provider for OpenCode", () => {
    expect(buildOpenCodeRuntimeModelConfig("openai/gpt-5.4")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    });
    expect(buildOpenCodeRuntimeModelConfig("openai/gpt-5.4-mini")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-mini",
    });
    expect(buildOpenCodeRuntimeModelConfig("openai/gpt-5.5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    });
  });

  it("maps bare GPT model references to OpenAI for OpenCode", () => {
    expect(buildOpenCodeRuntimeModelConfig("gpt-5.4")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    });
    expect(buildOpenCodeRuntimeModelConfig("gpt-5.4-mini")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-mini",
    });
    expect(buildOpenCodeRuntimeModelConfig("gpt-5.5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    });
  });

  it("keeps non-OpenAI references unchanged", () => {
    expect(buildOpenCodeRuntimeModelConfig("opencode/glm-5-free")).toEqual({
      providerID: "opencode",
      modelID: "glm-5-free",
    });
  });
});
