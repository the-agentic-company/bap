import { beforeEach, describe, expect, it, vi } from "vitest";

type MockFn = (...args: unknown[]) => unknown;

const { getSessionMock, findFirstMock, updateWhereMock, getOAuthConfigMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn<MockFn>();
  const findFirstMock = vi.fn<MockFn>();
  const updateWhereMock = vi.fn<MockFn>();
  const updateSetMock = vi.fn<MockFn>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<MockFn>(() => ({ set: updateSetMock }));
  const getOAuthConfigMock = vi.fn<MockFn>();

  return {
    getSessionMock,
    findFirstMock,
    updateWhereMock,
    getOAuthConfigMock,
    dbMock: {
      query: {
        integration: {
          findFirst: findFirstMock,
        },
      },
      update: updateMock,
    },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      integration: {
        findFirst: findFirstMock,
      },
    },
    update: vi.fn<MockFn>(() => ({
      set: vi.fn<MockFn>(() => ({ where: updateWhereMock })),
    })),
  },
}));

vi.mock("@cmdclaw/core/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

import { handleDynamicsPendingGet, handleDynamicsPendingPost } from "./dynamics-pending";

describe("Dynamics pending selection handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findFirstMock.mockResolvedValue({
      id: "integration-1",
      metadata: {
        pendingInstanceSelection: true,
        availableInstances: [
          {
            id: "env-1",
            friendlyName: "Prod",
            instanceUrl: "https://acme.crm.dynamics.com",
            apiUrl: "https://acme.crm.dynamics.com/api/data/v9.2",
          },
        ],
      },
    });
    updateWhereMock.mockResolvedValue(undefined);
    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["scope:one"],
      getUserInfo: vi.fn<MockFn>(),
    });
  });

  it("returns unauthorized when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await handleDynamicsPendingGet(
      new Request("https://app.example.com/api/oauth/dynamics/pending"),
    );

    expect(response.status).toBe(401);
  });

  it("returns pending instances", async () => {
    const response = await handleDynamicsPendingGet(
      new Request("https://app.example.com/api/oauth/dynamics/pending"),
    );
    const payload = (await response.json()) as { instances: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.instances).toHaveLength(1);
    expect(payload.instances[0]?.id).toBe("env-1");
  });

  it("completes selection by starting instance-scoped reauth", async () => {
    const response = await handleDynamicsPendingPost(
      new Request("https://app.example.com/api/oauth/dynamics/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceUrl: "https://acme.crm.dynamics.com",
          interruptId: "interrupt-1",
          integration: "dynamics",
        }),
      }),
    );

    const payload = (await response.json()) as { requiresReauth: boolean; authUrl: string };
    expect(response.status).toBe(200);
    expect(payload.requiresReauth).toBe(true);
    expect(payload.authUrl).toContain(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?",
    );
    expect(payload.authUrl).toContain(
      encodeURIComponent("https://acme.crm.dynamics.com/user_impersonation"),
    );
    const authUrl = new URL(payload.authUrl);
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const decodedState = JSON.parse(Buffer.from(state!, "base64url").toString("utf8")) as {
      redirectUrl: string;
    };
    expect(decodedState.redirectUrl).toContain("interrupt_id=interrupt-1");
  });

  it("uses APP_URL instead of request host for the post-reauth redirect target", async () => {
    process.env.APP_URL = "https://app.example.com";

    const response = await handleDynamicsPendingPost(
      new Request("https://0.0.0.0:8080/api/oauth/dynamics/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceUrl: "https://acme.crm.dynamics.com",
        }),
      }),
    );

    const payload = (await response.json()) as { authUrl: string };
    expect(response.status).toBe(200);

    const authUrl = new URL(payload.authUrl);
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const decodedState = JSON.parse(Buffer.from(state!, "base64url").toString("utf8")) as {
      redirectUrl: string;
    };
    expect(decodedState.redirectUrl).toBe("https://app.example.com/toolbox");
  });
});
