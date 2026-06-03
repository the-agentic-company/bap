import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  requireCloudSessionMock,
  getValidAuthRequestMock,
  updateWhereMock,
  assertCloudMock,
  assertInstanceKeyMock,
  userFindFirstMock,
  isControlPlaneEnabledMock,
  consumeControlPlaneAuthStateMock,
  exchangeCloudAuthMock,
  resolveOrCreateLocalUserMock,
  createLocalSessionRedirectResponseMock,
} = vi.hoisted(() => ({
  requireCloudSessionMock: vi.fn<VitestProcedure>(),
  getValidAuthRequestMock: vi.fn<VitestProcedure>(),
  updateWhereMock: vi.fn<VitestProcedure>(),
  assertCloudMock: vi.fn<VitestProcedure>(),
  assertInstanceKeyMock: vi.fn<VitestProcedure>(),
  userFindFirstMock: vi.fn<VitestProcedure>(),
  isControlPlaneEnabledMock: vi.fn<VitestProcedure>(),
  consumeControlPlaneAuthStateMock: vi.fn<VitestProcedure>(),
  exchangeCloudAuthMock: vi.fn<VitestProcedure>(),
  resolveOrCreateLocalUserMock: vi.fn<VitestProcedure>(),
  createLocalSessionRedirectResponseMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/server/control-plane/auth", () => ({
  assertCloudControlPlaneEnabled: assertCloudMock,
  assertValidInstanceApiKey: assertInstanceKeyMock,
  getValidAuthRequest: getValidAuthRequestMock,
  requireCloudSession: requireCloudSessionMock,
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      user: {
        findFirst: userFindFirstMock,
      },
    },
    update: vi.fn<VitestProcedure>(() => ({
      set: vi.fn<VitestProcedure>(() => ({ where: updateWhereMock })),
    })),
    insert: vi.fn<VitestProcedure>(() => ({ values: vi.fn<VitestProcedure>() })),
  },
}));

vi.mock("@cmdclaw/core/server/control-plane/client", () => ({
  exchangeCloudAuth: exchangeCloudAuthMock,
  isControlPlaneEnabled: isControlPlaneEnabledMock,
}));

vi.mock("@cmdclaw/core/server/control-plane/local-auth", () => ({
  consumeControlPlaneAuthState: consumeControlPlaneAuthStateMock,
}));

vi.mock("@/server/control-plane/selfhost-auth", () => ({
  resolveOrCreateLocalUserFromCloudIdentity: resolveOrCreateLocalUserMock,
  createLocalSessionRedirectResponse: createLocalSessionRedirectResponseMock,
}));

import { authorizeHandler, callbackHandler, exchangeHandler } from "./auth";

function getLocation(response: Response) {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("authorizeHandler (GET /api/control-plane/auth/authorize)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    getValidAuthRequestMock.mockResolvedValue({
      code: "code-1",
      localState: "state-1",
      returnUrl: "http://selfhost.local/api/control-plane/auth/callback",
      createdAt: new Date(),
    });
  });

  it("redirects to cloud login when there is no cloud session", async () => {
    requireCloudSessionMock.mockResolvedValue(null);

    const response = await authorizeHandler(
      new Request("https://cloud.example.com/api/control-plane/auth/authorize?code=code-1"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cloud.example.com/login?callbackUrl=%2Fapi%2Fcontrol-plane%2Fauth%2Fauthorize%3Fcode%3Dcode-1",
    );
  });

  it("uses APP_URL for login redirects when the request host is internal", async () => {
    process.env.APP_URL = "https://cloud.example.com";
    requireCloudSessionMock.mockResolvedValue(null);

    const response = await authorizeHandler(
      new Request("https://0.0.0.0:8080/api/control-plane/auth/authorize?code=code-1"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cloud.example.com/login?callbackUrl=%2Fapi%2Fcontrol-plane%2Fauth%2Fauthorize%3Fcode%3Dcode-1",
    );
  });

  it("redirects back to self-host with code and state after cloud login", async () => {
    requireCloudSessionMock.mockResolvedValue({ user: { id: "cloud-user-1" } });

    const response = await authorizeHandler(
      new Request("https://cloud.example.com/api/control-plane/auth/authorize?code=code-1"),
    );

    expect(updateWhereMock).toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/api/control-plane/auth/callback?code=code-1&state=state-1",
    );
  });
});

describe("callbackHandler (GET /api/control-plane/auth/callback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    isControlPlaneEnabledMock.mockReturnValue(true);
    consumeControlPlaneAuthStateMock.mockResolvedValue({
      state: "state-1",
      returnPath: "/chat",
      createdAt: new Date(),
    });
    exchangeCloudAuthMock.mockResolvedValue({
      cloudUserId: "cloud-user-1",
      email: "user@example.com",
      name: "Cloud User",
      image: null,
    });
    resolveOrCreateLocalUserMock.mockResolvedValue("local-user-1");
    createLocalSessionRedirectResponseMock.mockImplementation(
      async ({ redirectUrl }: { redirectUrl: URL }) =>
        new Response(null, { status: 307, headers: { location: redirectUrl.toString() } }),
    );
  });

  it("redirects back to login when the local state is invalid", async () => {
    consumeControlPlaneAuthStateMock.mockResolvedValue(null);

    const response = await callbackHandler(
      new Request(
        "http://selfhost.local/api/control-plane/auth/callback?code=code-1&state=state-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/login?callbackUrl=%2Fchat&error=invalid_state",
    );
  });

  it("uses APP_URL for login redirects when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";
    consumeControlPlaneAuthStateMock.mockResolvedValue(null);

    const response = await callbackHandler(
      new Request("https://0.0.0.0:8080/api/control-plane/auth/callback?code=code-1&state=state-1"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://app.example.com/login?callbackUrl=%2Fchat&error=invalid_state",
    );
  });

  it("creates a local session and redirects to the requested page", async () => {
    const response = await callbackHandler(
      new Request(
        "http://selfhost.local/api/control-plane/auth/callback?code=code-1&state=state-1",
      ),
    );

    expect(exchangeCloudAuthMock).toHaveBeenCalledWith("code-1");
    expect(resolveOrCreateLocalUserMock).toHaveBeenCalledWith({
      cloudUserId: "cloud-user-1",
      email: "user@example.com",
      name: "Cloud User",
      image: null,
    });
    expect(createLocalSessionRedirectResponseMock).toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("http://selfhost.local/chat");
  });

  it("uses APP_URL for the post-login redirect when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";

    const response = await callbackHandler(
      new Request("https://0.0.0.0:8080/api/control-plane/auth/callback?code=code-1&state=state-1"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("https://app.example.com/chat");
  });

  it("redirects invite-only users to the request-access page", async () => {
    resolveOrCreateLocalUserMock.mockRejectedValueOnce(new Error("invite_only"));

    const response = await callbackHandler(
      new Request(
        "http://selfhost.local/api/control-plane/auth/callback?code=code-1&state=state-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/invite-only?source=selfhost-cloud-login&email=user%40example.com",
    );
  });
});

describe("exchangeHandler (POST /api/control-plane/auth/exchange)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getValidAuthRequestMock.mockResolvedValue({
      code: "code-1",
      completedByUserId: "cloud-user-1",
      completedAt: null,
      createdAt: new Date(),
    });
    userFindFirstMock.mockResolvedValue({
      id: "cloud-user-1",
      email: "user@example.com",
      name: "Cloud User",
      image: "https://example.com/avatar.png",
    });
  });

  it("returns cloud identity payload for a completed auth request", async () => {
    const response = await exchangeHandler(
      new Request("https://cloud.example.com/api/control-plane/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "code-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cloudUserId: "cloud-user-1",
      email: "user@example.com",
      name: "Cloud User",
      image: "https://example.com/avatar.png",
    });
  });

  it("rejects incomplete auth requests", async () => {
    getValidAuthRequestMock.mockResolvedValue({
      code: "code-1",
      completedByUserId: null,
      completedAt: null,
      createdAt: new Date(),
    });

    const response = await exchangeHandler(
      new Request("https://cloud.example.com/api/control-plane/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "code-1" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid or incomplete code" });
  });

  it("returns 401 when the instance API key is invalid", async () => {
    assertInstanceKeyMock.mockImplementationOnce(() => {
      throw new Error("Invalid instance API key");
    });

    const response = await exchangeHandler(
      new Request("https://cloud.example.com/api/control-plane/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "code-1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Invalid instance API key" });
  });
});
