// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordActivity: vi.fn<() => Promise<{ success: boolean }>>().mockResolvedValue({ success: true }),
}));

vi.mock("@/orpc/client", () => ({
  client: { session: { recordActivity: mocks.recordActivity } },
}));

import { SessionActivityTracker } from "./session-activity-tracker";

describe("SessionActivityTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("records deliberate activity and throttles interaction writes", async () => {
    render(<SessionActivityTracker />);
    expect(mocks.recordActivity).not.toHaveBeenCalled();

    fireEvent.keyDown(window);
    expect(mocks.recordActivity).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(window);
    expect(mocks.recordActivity).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.recordActivity).toHaveBeenCalledTimes(2);
  });
});
