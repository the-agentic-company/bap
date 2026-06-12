import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/cmdclaw_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_SERVER_SECRET ??= "test-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:9000";
process.env.AWS_ACCESS_KEY_ID ??= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-key";

const getEnabledIntegrationTypesMock = vi.fn<() => Promise<unknown>>();
const getRemoteIntegrationCredentialsMock = vi.fn<() => Promise<unknown>>();
const getTokensForIntegrationsMock = vi.fn<() => Promise<unknown>>();
const userFindFirstMock = vi.fn<() => Promise<unknown>>();

vi.mock("@/env", () => ({
  env: {
    APP_SERVER_SECRET: "test-secret",
  },
}));

vi.mock("@/server/internal/server-secret", () => ({
  isAuthorizedByServerSecret: (request: Request) =>
    request.headers.get("authorization") === "Bearer test-secret",
}));

vi.mock("@cmdclaw/core/server/integrations/cli-env", () => ({
  getEnabledIntegrationTypes: getEnabledIntegrationTypesMock,
  getTokenEnvVarForIntegrationType: (type: string) =>
    type === "google_gmail"
      ? "GMAIL_ACCESS_TOKEN"
      : type === "outlook"
        ? "OUTLOOK_ACCESS_TOKEN"
        : null,
  getTokensForIntegrations: getTokensForIntegrationsMock,
}));

vi.mock("@cmdclaw/core/server/integrations/connected-account-resolution", () => ({
  ConnectedAccountResolutionError: class ConnectedAccountResolutionError extends Error {},
  resolveConnectedAccountCredential: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@cmdclaw/core/server/integrations/remote-integrations", () => {
  const remoteIntegrationTargetEnvSchema = z.enum(["staging", "prod"]);
  return {
    getRemoteIntegrationCredentials: getRemoteIntegrationCredentialsMock,
    remoteIntegrationSourceSchema: z.object({
      targetEnv: remoteIntegrationTargetEnvSchema,
      remoteUserId: z.string().min(1),
      requestedByUserId: z.string().min(1).optional(),
      requestedByEmail: z.string().email().nullable().optional(),
      remoteUserEmail: z.string().email().nullable().optional(),
    }),
  };
});

vi.mock("@cmdclaw/core/server/galien/service", () => ({
  getGalienCredentialForUser: vi.fn<() => Promise<unknown>>(),
  getGalienWorkspaceAccessForUser: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@cmdclaw/core/server/modulr/service", () => ({
  canUserUseModulrInWorkspace: vi.fn<() => Promise<unknown>>(),
  getModulrWorkspaceConnection: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      user: {
        findFirst: userFindFirstMock,
      },
    },
  },
}));

vi.mock("@cmdclaw/db/schema", () => ({
  user: {
    id: "user.id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn<() => unknown>(),
}));

const { handleRuntimeCredentials } = await import("./mcp-credentials");

function runtimeCredentialsRequest(body: unknown) {
  return new Request("https://app.example.com/api/internal/mcp/runtime-credentials", {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("handleRuntimeCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindFirstMock.mockResolvedValue({ role: "admin" });
    getRemoteIntegrationCredentialsMock.mockResolvedValue({
      remoteUserId: "remote-user-1",
      remoteUserEmail: "client@example.com",
      remoteUserName: "Client User",
      enabledIntegrations: ["google_gmail"],
      tokens: {
        GMAIL_ACCESS_TOKEN: "remote-gmail-token",
      },
    });
  });

  it("returns remote integration tokens for an admin actor", async () => {
    const response = await handleRuntimeCredentials(
      runtimeCredentialsRequest({
        userId: "local-user-1",
        workspaceId: "ws-1",
        integrationTypes: ["google_gmail"],
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
          requestedByUserId: "admin-1",
          requestedByEmail: "admin@example.com",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      userId: "local-user-1",
      workspaceId: "ws-1",
      enabledIntegrations: ["google_gmail"],
      tokens: {
        GMAIL_ACCESS_TOKEN: "remote-gmail-token",
      },
    });
    expect(getRemoteIntegrationCredentialsMock).toHaveBeenCalledWith({
      targetEnv: "prod",
      remoteUserId: "remote-user-1",
      integrationTypes: ["google_gmail"],
      requestedByUserId: "admin-1",
      requestedByEmail: "admin@example.com",
    });
    expect(getTokensForIntegrationsMock).not.toHaveBeenCalled();
  });

  it("resolves a remote integration credential for sandbox account lookups", async () => {
    getRemoteIntegrationCredentialsMock.mockResolvedValue({
      remoteUserId: "remote-user-1",
      remoteUserEmail: "client@example.com",
      remoteUserName: "Client User",
      enabledIntegrations: ["outlook"],
      tokens: {
        OUTLOOK_ACCESS_TOKEN: "remote-outlook-token",
      },
    });

    const response = await handleRuntimeCredentials(
      runtimeCredentialsRequest({
        userId: "local-user-1",
        workspaceId: "ws-1",
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
          requestedByUserId: "admin-1",
          requestedByEmail: "admin@example.com",
        },
        resolve: {
          integrationType: "outlook",
          accountLabel: null,
          allowedIntegrationTypes: ["outlook"],
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      credential: {
        integrationType: "outlook",
        accessToken: "remote-outlook-token",
        connectedAccountId: "remote-user-1",
        accountLabel: null,
        metadata: {
          remoteUserEmail: "client@example.com",
          remoteTargetEnv: "prod",
        },
      },
    });
    expect(getRemoteIntegrationCredentialsMock).toHaveBeenCalledWith({
      targetEnv: "prod",
      remoteUserId: "remote-user-1",
      integrationTypes: ["outlook"],
      requestedByUserId: "admin-1",
      requestedByEmail: "admin@example.com",
    });
    expect(getTokensForIntegrationsMock).not.toHaveBeenCalled();
  });

  it("rejects remote integration tokens for a non-admin actor", async () => {
    userFindFirstMock.mockResolvedValue({ role: "member" });

    const response = await handleRuntimeCredentials(
      runtimeCredentialsRequest({
        userId: "local-user-1",
        integrationTypes: ["google_gmail"],
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
          requestedByUserId: "member-1",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ message: "Admin access required" });
    expect(getRemoteIntegrationCredentialsMock).not.toHaveBeenCalled();
  });
});
