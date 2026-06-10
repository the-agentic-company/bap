import { describe, expect, it } from "vitest";
import { normalizeModelReference } from "./model-reference";

describe("normalizeModelReference", () => {
  it("upgrades legacy GPT-5.5 ids", () => {
    expect(normalizeModelReference("gpt-5.5")).toBe("openai/gpt-5.5");
  });
});
