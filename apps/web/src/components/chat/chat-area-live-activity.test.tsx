// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { shouldRenderInitialLiveActivity, shouldRenderLiveActivity } from "./chat-live-activity";

describe("chat live activity rendering", () => {
  it("suppresses transient live activity while a terminal assistant message is being inserted", () => {
    const terminalTransition = {
      displaySegmentCount: 0,
      isStreaming: true,
      suppressLiveActivity: true,
    };

    expect(shouldRenderLiveActivity(terminalTransition)).toBe(false);
    expect(shouldRenderInitialLiveActivity(terminalTransition)).toBe(false);
  });

  it("still renders the initial activity card for a new generation before stream segments arrive", () => {
    const startingGeneration = {
      displaySegmentCount: 0,
      isStreaming: true,
      suppressLiveActivity: false,
    };

    expect(shouldRenderLiveActivity(startingGeneration)).toBe(true);
    expect(shouldRenderInitialLiveActivity(startingGeneration)).toBe(true);
  });
});
