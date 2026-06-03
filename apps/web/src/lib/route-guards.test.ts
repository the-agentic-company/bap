import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRequestMock, getSessionMock, isSelfHostedEditionMock, redirectMock } = vi.hoisted(
  () => ({
    getRequestMock: vi.fn<() => Request>(),
    getSessionMock: vi.fn<() => Promise<unknown>>(),
    isSelfHostedEditionMock: vi.fn<() => boolean>(),
    redirectMock: vi.fn<(options: unknown) => never>(),
  }),
);

vi.mock("@cmdclaw/core/server/edition", () => ({
  isSelfHostedEdition: isSelfHostedEditionMock,
}));

vi.mock("@tanstack/react-router", () => ({
  redirect: redirectMock,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn,
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: getRequestMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

import {
  fetchSessionContext,
  requireSelfHostInstance,
  requireSession,
  requireSupportAdmin,
} from "./route-guards";

function mockSession(role: string | null = null) {
  getSessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "baptiste@heybap.com",
      role,
    },
    session: {
      id: "session-1",
    },
  });
}

describe("route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CMDCLAW_INSTANCE_ROOT;
    getRequestMock.mockReturnValue(new Request("http://localhost:3000/chat"));
    getSessionMock.mockResolvedValue(null);
    isSelfHostedEditionMock.mockReturnValue(false);
    redirectMock.mockImplementation((options: unknown) => {
      throw options;
    });
  });

  it("resolves an authenticated session context", async () => {
    mockSession("admin");

    await expect(fetchSessionContext()).resolves.toEqual({
      principal: {
        userId: "user-1",
        email: "baptiste@heybap.com",
        role: "admin",
      },
      edition: "cloud",
      isAdmin: true,
      worktreeAutoLoginConfigured: false,
    });
  });

  it("redirects unauthenticated protected routes to login with callback", async () => {
    await expect(requireSession("/chat?tab=latest")).rejects.toEqual({
      href: "/login?callbackUrl=%2Fchat%3Ftab%3Dlatest",
    });
  });

  it("redirects unauthenticated protected routes to worktree auto-login when configured", async () => {
    process.env.CMDCLAW_INSTANCE_ROOT = "/tmp/cmdclaw-worktree";

    await expect(requireSession("/chat?tab=latest")).rejects.toEqual({
      href: "/api/dev/worktree-auth?callbackUrl=%2Fchat%3Ftab%3Dlatest",
    });
  });

  it("allows protected routes with a session", async () => {
    mockSession();

    await expect(requireSession("/settings")).resolves.toMatchObject({
      principal: {
        userId: "user-1",
      },
    });
  });

  it("allows cloud support admins", async () => {
    mockSession("admin");

    await expect(requireSupportAdmin("/admin")).resolves.toMatchObject({
      edition: "cloud",
      isAdmin: true,
    });
  });

  it("redirects non-admin support users home", async () => {
    mockSession("member");

    await expect(requireSupportAdmin("/admin")).rejects.toEqual({ href: "/" });
  });

  it("redirects cloud requests away from self-host instance routes", async () => {
    mockSession("admin");

    await expect(requireSelfHostInstance("/instance")).rejects.toEqual({ href: "/" });
  });

  it("requires login for self-host instance routes without a session", async () => {
    isSelfHostedEditionMock.mockReturnValue(true);

    await expect(requireSelfHostInstance("/instance")).rejects.toEqual({
      href: "/login?callbackUrl=%2Finstance",
    });
  });
});
