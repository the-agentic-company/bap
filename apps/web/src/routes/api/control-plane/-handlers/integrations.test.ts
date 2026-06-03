import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  assertCloudControlPlaneEnabledMock,
  assertValidInstanceApiKeyMock,
  requireCloudSessionMock,
  getOAuthConfigMock,
  generateLinkedInAuthUrlMock,
} = vi.hoisted(() => ({
  assertCloudControlPlaneEnabledMock: vi.fn<VitestProcedure>(),
  assertValidInstanceApiKeyMock: vi.fn<VitestProcedure>(),
  requireCloudSessionMock: vi.fn<VitestProcedure>(),
  getOAuthConfigMock: vi.fn<VitestProcedure>(),
  generateLinkedInAuthUrlMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/server/control-plane/auth", () => ({
  assertCloudControlPlaneEnabled: assertCloudControlPlaneEnabledMock,
  assertValidInstanceApiKey: assertValidInstanceApiKeyMock,
  requireCloudSession: requireCloudSessionMock,
}));

vi.mock("@cmdclaw/core/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@/server/integrations/unipile", () => ({
  generateLinkedInAuthUrl: generateLinkedInAuthUrlMock,
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {},
}));

import { connectHandler } from "./integrations";

function getLocation(response: Response) {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("connectHandler (GET /api/control-plane/integrations/connect)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    requireCloudSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["openid", "offline_access"],
      getUserInfo: vi.fn<VitestProcedure>(),
    });
  });

  it("uses APP_URL for the cloud login redirect when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";
    requireCloudSessionMock.mockResolvedValue(null);

    const response = await connectHandler(
      new Request("https://0.0.0.0:8080/api/control-plane/integrations/connect?type=outlook"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://app.example.com/login?callbackUrl=%2Fapi%2Fcontrol-plane%2Fintegrations%2Fconnect%3Ftype%3Doutlook",
    );
  });

  it("stores the public app URL in OAuth state when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";

    const response = await connectHandler(
      new Request("https://0.0.0.0:8080/api/control-plane/integrations/connect?type=outlook"),
    );

    expect(response.status).toBe(307);
    const location = new URL(getLocation(response));
    expect(location.origin).toBe("https://login.microsoftonline.com");

    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();

    const decodedState = JSON.parse(Buffer.from(state!, "base64url").toString("utf8")) as {
      redirectUrl: string;
    };
    expect(decodedState.redirectUrl).toBe("https://app.example.com/toolbox");
  });

  it("prompts Microsoft users to pick an Outlook account when connecting", async () => {
    const response = await connectHandler(
      new Request("https://app.example.com/api/control-plane/integrations/connect?type=outlook"),
    );

    expect(response.status).toBe(307);
    const location = new URL(getLocation(response));

    expect(location.searchParams.get("prompt")).toBe("select_account");
  });

  it("prompts Microsoft users to pick an Outlook Calendar account when connecting", async () => {
    const response = await connectHandler(
      new Request(
        "https://app.example.com/api/control-plane/integrations/connect?type=outlook_calendar",
      ),
    );

    expect(response.status).toBe(307);
    const location = new URL(getLocation(response));

    expect(location.searchParams.get("prompt")).toBe("select_account");
  });

  it("rejects an unsupported integration type", async () => {
    const response = await connectHandler(
      new Request("https://app.example.com/api/control-plane/integrations/connect?type=bogus"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Unsupported integration type" });
  });
});
