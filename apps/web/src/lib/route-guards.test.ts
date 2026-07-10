import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/bap";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_SERVER_SECRET ??= "test-server-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:4566";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

const {
  getRequestMock,
  getRequestSessionMock,
  isSelfHostedEditionMock,
  redirectMock,
  resolveSessionPrincipalWorkspaceIdMock,
} = vi.hoisted(() => ({
  getRequestMock: vi.fn<() => Request>(),
  getRequestSessionMock: vi.fn<() => Promise<unknown>>(),
  isSelfHostedEditionMock: vi.fn<() => boolean>(),
  redirectMock: vi.fn<(options: unknown) => never>(),
  resolveSessionPrincipalWorkspaceIdMock:
    vi.fn<(userId: string, activeOrganizationId?: string | null) => Promise<string>>(),
}));

vi.mock("@/server/session-principal-workspace", () => ({
  resolveSessionPrincipalWorkspaceId: resolveSessionPrincipalWorkspaceIdMock,
}));

vi.mock("@bap/core/server/edition", () => ({
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

vi.mock("@/server/session-auth", () => ({
  getRequestSession: getRequestSessionMock,
}));

import {
  fetchSessionContext,
  requireSelfHostInstance,
  requireSession,
  requireSupportAdmin,
} from "./route-guards";

function mockSession(role: string | null = null, activeOrganizationId?: string | null) {
  getRequestSessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "admin@example.com",
      role,
    },
    session: {
      id: "session-1",
      activeOrganizationId,
    },
  });
}

describe("route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BAP_INSTANCE_ROOT;
    getRequestMock.mockReturnValue(new Request("http://localhost:3000/chat"));
    getRequestSessionMock.mockResolvedValue(null);
    resolveSessionPrincipalWorkspaceIdMock.mockResolvedValue("workspace-1");
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
        activeWorkspaceId: "workspace-1",
        email: "admin@example.com",
        image: null,
        name: null,
        role: "admin",
      },
      edition: "cloud",
      isAdmin: true,
      worktreeAutoLoginConfigured: false,
    });
    expect(resolveSessionPrincipalWorkspaceIdMock).toHaveBeenCalledWith("user-1", null);
  });

  it("passes Better Auth active organization into session workspace resolution", async () => {
    mockSession("user", "workspace-2");

    await expect(fetchSessionContext()).resolves.toMatchObject({
      principal: {
        activeWorkspaceId: "workspace-1",
      },
    });
    expect(resolveSessionPrincipalWorkspaceIdMock).toHaveBeenCalledWith("user-1", "workspace-2");
  });

  it("redirects unauthenticated protected routes to login with callback", async () => {
    await expect(requireSession("/chat?tab=latest")).rejects.toEqual({
      href: "/login?callbackUrl=%2Fchat%3Ftab%3Dlatest",
    });
  });

  it("redirects unauthenticated protected routes to worktree auto-login when configured", async () => {
    process.env.BAP_INSTANCE_ROOT = "/tmp/bap-worktree";

    await expect(requireSession("/chat?tab=latest")).rejects.toEqual({
      href: "/api/dev/worktree-auth?callbackUrl=%2Fchat%3Ftab%3Dlatest",
    });
  });

  it("allows protected routes with a session", async () => {
    mockSession();

    await expect(requireSession("/settings")).resolves.toMatchObject({
      principal: {
        userId: "user-1",
        activeWorkspaceId: "workspace-1",
      },
    });
  });

  it("allows cloud support admins", async () => {
    mockSession("admin");

    await expect(requireSupportAdmin("/internal")).resolves.toMatchObject({
      edition: "cloud",
      isAdmin: true,
    });
  });

  it("redirects non-admin support users home", async () => {
    mockSession("member");

    await expect(requireSupportAdmin("/internal")).rejects.toEqual({ href: "/" });
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
