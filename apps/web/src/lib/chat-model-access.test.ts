import { describe, expect, it } from "vitest";
import { isModelAccessibleForNewChat } from "./chat-model-access";

describe("isModelAccessibleForNewChat", () => {
  const noProviderAvailability = {
    anthropic: { user: false, shared: false },
    google: { user: false, shared: false },
    openai: { user: false, shared: false },
  } as const;

  it("returns false for admin-only Claude models when the user is not an admin", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "anthropic/claude-sonnet-4-6",
        providerAvailabilityByProvider: noProviderAvailability,
      }),
    ).toBe(false);
  });

  it("returns true for admin-only Claude models when the user is an admin", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "anthropic/claude-sonnet-4-6",
        isAdmin: true,
        providerAvailabilityByProvider: {
          anthropic: { user: false, shared: true },
        },
      }),
    ).toBe(true);
  });

  it("returns false for Claude models when the shared Claude source is unavailable", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "anthropic/claude-sonnet-4-6",
        isAdmin: true,
        providerAvailabilityByProvider: noProviderAvailability,
      }),
    ).toBe(false);
  });

  it("returns false for openai models when ChatGPT is disconnected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/gpt-5.4",
        providerAvailabilityByProvider: noProviderAvailability,
      }),
    ).toBe(false);
  });

  it("returns true for openai models when the personal ChatGPT source is connected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/gpt-5.5",
        authSource: "user",
        providerAvailabilityByProvider: {
          openai: { user: true, shared: false },
        },
      }),
    ).toBe(true);
  });

  it("returns true for openai models when the shared ChatGPT source is connected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/gpt-5.4-mini",
        authSource: "shared",
        providerAvailabilityByProvider: {
          openai: { user: false, shared: true },
        },
      }),
    ).toBe(true);
  });

  it("returns false for unknown openai model IDs", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/unknown",
        authSource: "user",
        providerAvailabilityByProvider: {
          openai: { user: true, shared: false },
        },
      }),
    ).toBe(false);
  });

  it("returns true for google models when the shared Gemini source is connected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "google/gemini-3.1-pro-preview",
        providerAvailabilityByProvider: {
          google: { user: false, shared: true },
        },
      }),
    ).toBe(true);
  });

  it("returns false for opencode models while they are hidden from the selector", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "opencode/glm-5-free",
        providerAvailabilityByProvider: noProviderAvailability,
      }),
    ).toBe(false);
  });
});
