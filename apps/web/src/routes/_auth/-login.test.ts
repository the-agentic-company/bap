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

const { getRequestMock, getRequestSessionMock, isSelfHostedEditionMock, redirectMock } = vi.hoisted(
  () => ({
    getRequestMock: vi.fn<() => Request>(),
    getRequestSessionMock: vi.fn<(headers: Headers) => Promise<unknown>>(),
    isSelfHostedEditionMock: vi.fn<() => boolean>(),
    redirectMock: vi.fn<(options: unknown) => never>(),
  }),
);

vi.mock("@/components/login/cloud-login-client", () => ({
  CloudLoginClient: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: () => null,
}));

vi.mock("@bap/core/server/edition", () => ({
  isSelfHostedEdition: isSelfHostedEditionMock,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: redirectMock,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn,
    }),
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: getRequestMock,
}));

vi.mock("gt-react", () => ({
  T: ({ children }: { children: unknown }) => children,
  useGT: () => (value: string) => value,
}));

vi.mock("@/server/session-auth", () => ({
  getRequestSession: getRequestSessionMock,
}));

import { resolveLoginPage } from "./login";

describe("/login loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSelfHostedEditionMock.mockReturnValue(false);
    redirectMock.mockImplementation((options: unknown) => {
      throw options;
    });
  });

  it("uses normalized request session resolution before redirecting authenticated users", async () => {
    const request = new Request("https://staging.heybap.com/login?callbackUrl=%2Fchat", {
      headers: {
        cookie:
          "better-auth.session_token=stale; theme=dark; __Secure-better-auth.session_token=current",
      },
    });
    getRequestMock.mockReturnValue(request);
    getRequestSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });

    await expect(resolveLoginPage({ data: { callbackUrl: "/chat" } })).rejects.toEqual({
      href: "/chat",
    });

    expect(getRequestSessionMock).toHaveBeenCalledWith(request.headers);
  });
});
