// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clear: vi.fn<() => void>(),
  getSession: vi.fn<() => Promise<{ data: { user: { id: string } } | null }>>(),
  navigate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: mocks.clear }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: () => "/admin/settings",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { getSession: mocks.getSession },
}));

import { SessionPrincipalCacheGuard } from "./session-principal-cache-guard";

describe("SessionPrincipalCacheGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getSession
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } })
      .mockResolvedValue({ data: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("moves an expired signed-in session to login", async () => {
    render(<SessionPrincipalCacheGuard />);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({
      href: "/login?callbackUrl=%2Fadmin%2Fsettings",
      replace: true,
    });
  });

  it("moves to login when the first client poll finds the server session expired", async () => {
    mocks.getSession.mockReset().mockResolvedValue({ data: null });

    render(<SessionPrincipalCacheGuard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({
      href: "/login?callbackUrl=%2Fadmin%2Fsettings",
      replace: true,
    });
  });
});
