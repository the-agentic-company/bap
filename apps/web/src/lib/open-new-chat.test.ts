// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { openNewChat } from "./open-new-chat";

describe("openNewChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resets the current chat and routes to the new chat page", () => {
    const push = vi.fn<VitestProcedure>();
    const listener = vi.fn<VitestProcedure>();
    window.addEventListener("new-chat", listener);

    try {
      openNewChat(({ to }) => push(to));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith("/chat");
    } finally {
      window.removeEventListener("new-chat", listener);
    }
  });
});
