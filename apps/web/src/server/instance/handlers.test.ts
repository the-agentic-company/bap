import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { startCloudAuthMock, isSelfHostedEditionMock, getSessionMock, getInstanceHealthStatusMock } =
  vi.hoisted(() => ({
    startCloudAuthMock: vi.fn<VitestProcedure>(),
    isSelfHostedEditionMock: vi.fn<VitestProcedure>(),
    getSessionMock: vi.fn<VitestProcedure>(),
    getInstanceHealthStatusMock: vi.fn<VitestProcedure>(),
  }));

vi.mock("@cmdclaw/core/server/control-plane/client", () => ({
  startCloudAuth: startCloudAuthMock,
}));

vi.mock("@cmdclaw/core/server/edition", () => ({
  isSelfHostedEdition: isSelfHostedEditionMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/server/instance/health", () => ({
  getInstanceHealthStatus: getInstanceHealthStatusMock,
}));

import { handleInstanceAuthStart, handleInstanceHealth } from "./handlers";

function getLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("handleInstanceAuthStart (GET /api/instance/auth/start)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    isSelfHostedEditionMock.mockReturnValue(true);
    startCloudAuthMock.mockResolvedValue(
      "https://cloud.example.com/api/control-plane/auth/authorize?code=code-1",
    );
  });

  it("redirects to cloud auth for self-hosted login", async () => {
    const response = await handleInstanceAuthStart(
      new Request("http://selfhost.local/api/instance/auth/start?callbackUrl=%2Fchat"),
    );

    expect(startCloudAuthMock).toHaveBeenCalledWith({ returnPath: "/chat" });
    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cloud.example.com/api/control-plane/auth/authorize?code=code-1",
    );
  });

  it("redirects back to login when self-hosted auth is unavailable", async () => {
    isSelfHostedEditionMock.mockReturnValue(false);

    const response = await handleInstanceAuthStart(
      new Request("http://selfhost.local/api/instance/auth/start?callbackUrl=%2Fchat"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/login?callbackUrl=%2Fchat&error=cloud_auth_not_available",
    );
  });

  it("uses APP_URL for login redirects when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";
    isSelfHostedEditionMock.mockReturnValue(false);

    const response = await handleInstanceAuthStart(
      new Request("https://0.0.0.0:8080/api/instance/auth/start?callbackUrl=%2Fchat"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://app.example.com/login?callbackUrl=%2Fchat&error=cloud_auth_not_available",
    );
  });

  it("maps the not-configured control plane error to a login error key", async () => {
    startCloudAuthMock.mockRejectedValue(new Error("Cloud control plane is not configured"));

    const response = await handleInstanceAuthStart(
      new Request("http://selfhost.local/api/instance/auth/start?callbackUrl=%2Fchat"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/login?callbackUrl=%2Fchat&error=cloud_auth_not_configured",
    );
  });

  it("maps generic control plane failures to the unavailable error key", async () => {
    startCloudAuthMock.mockRejectedValue(new Error("boom"));

    const response = await handleInstanceAuthStart(
      new Request("http://selfhost.local/api/instance/auth/start?callbackUrl=%2Fchat"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "http://selfhost.local/login?callbackUrl=%2Fchat&error=cloud_auth_unavailable",
    );
  });
});

describe("handleInstanceHealth (GET /api/instance/health)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no authenticated session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await handleInstanceHealth(
      new Request("http://selfhost.local/api/instance/health"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: "Unauthorized" });
    expect(getInstanceHealthStatusMock).not.toHaveBeenCalled();
  });

  it("passes request headers to the session lookup", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    getInstanceHealthStatusMock.mockResolvedValue({ ok: true, checks: {} });

    const request = new Request("http://selfhost.local/api/instance/health", {
      headers: { cookie: "session=abc" },
    });
    await handleInstanceHealth(request);

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock.mock.calls[0]?.[0]?.headers).toBe(request.headers);
  });

  it("returns 200 with the status payload when the instance is healthy", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    const status = { ok: true, edition: "selfhost", checks: {} };
    getInstanceHealthStatusMock.mockResolvedValue(status);

    const response = await handleInstanceHealth(
      new Request("http://selfhost.local/api/instance/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(status);
  });

  it("returns 503 when the instance health status is not ok", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    const status = { ok: false, edition: "selfhost", checks: {} };
    getInstanceHealthStatusMock.mockResolvedValue(status);

    const response = await handleInstanceHealth(
      new Request("http://selfhost.local/api/instance/health"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(status);
  });
});
