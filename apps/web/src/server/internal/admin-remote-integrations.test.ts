import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { getLocalRemoteIntegrationCredentialsMock, listLocalRemoteIntegrationUsersMock } =
  vi.hoisted(() => ({
    getLocalRemoteIntegrationCredentialsMock: vi.fn(),
    listLocalRemoteIntegrationUsersMock: vi.fn(),
  }));

vi.mock("@/env", () => ({
  env: {
    CMDCLAW_SERVER_SECRET: "test-secret",
  },
}));

vi.mock("@cmdclaw/core/server/integrations/remote-integrations", () => {
  const remoteIntegrationTypeSchema = z.enum([
    "google_gmail",
    "outlook",
    "outlook_calendar",
    "google_calendar",
    "google_docs",
    "google_sheets",
    "google_drive",
    "notion",
    "github",
    "airtable",
    "slack",
    "hubspot",
    "salesforce",
    "dynamics",
    "reddit",
    "twitter",
  ]);
  return {
    getLocalRemoteIntegrationCredentials: getLocalRemoteIntegrationCredentialsMock,
    listLocalRemoteIntegrationUsers: listLocalRemoteIntegrationUsersMock,
    remoteIntegrationTypeSchema,
    remoteIntegrationCredentialsResponseSchema: z.object({
      remoteUserId: z.string().min(1),
      remoteUserEmail: z.string().email(),
      remoteUserName: z.string().nullable(),
      enabledIntegrations: z.array(remoteIntegrationTypeSchema),
      tokens: z.record(z.string(), z.string()),
    }),
    remoteIntegrationUserSummarySchema: z.object({
      id: z.string().min(1),
      email: z.string().email(),
      name: z.string().nullable(),
      enabledIntegrationTypes: z.array(z.string()),
    }),
  };
});

import {
  handleRemoteIntegrationCredentials,
  handleRemoteIntegrationUsers,
} from "./admin-remote-integrations";

describe("handleRemoteIntegrationCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLocalRemoteIntegrationCredentialsMock.mockResolvedValue({
      remoteUserId: "remote-user-1",
      remoteUserEmail: "client@example.com",
      remoteUserName: "Client User",
      enabledIntegrations: ["google_gmail", "hubspot"],
      tokens: {
        GMAIL_ACCESS_TOKEN: "gmail-token",
        HUBSPOT_ACCESS_TOKEN: "hubspot-token",
      },
    });
  });

  it("rejects unauthorized requests", async () => {
    const response = await handleRemoteIntegrationCredentials(
      new Request("https://app.example.com/api/internal/admin/remote-integrations/credentials", {
        method: "POST",
        body: JSON.stringify({
          remoteUserId: "remote-user-1",
          integrationTypes: ["google_gmail"],
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns remote integration credentials for authorized requests", async () => {
    const response = await handleRemoteIntegrationCredentials(
      new Request("https://app.example.com/api/internal/admin/remote-integrations/credentials", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          remoteUserId: "remote-user-1",
          integrationTypes: ["google_gmail", "hubspot"],
          requestedByUserId: "admin-1",
          requestedByEmail: "admin@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      remoteUserId: "remote-user-1",
      remoteUserEmail: "client@example.com",
      remoteUserName: "Client User",
      enabledIntegrations: ["google_gmail", "hubspot"],
      tokens: {
        GMAIL_ACCESS_TOKEN: "gmail-token",
        HUBSPOT_ACCESS_TOKEN: "hubspot-token",
      },
    });
    expect(getLocalRemoteIntegrationCredentialsMock).toHaveBeenCalledWith({
      remoteUserId: "remote-user-1",
      integrationTypes: ["google_gmail", "hubspot"],
    });
  });

  it("returns 404 when the remote user is missing", async () => {
    getLocalRemoteIntegrationCredentialsMock.mockRejectedValue(
      new Error("Remote integration user not found"),
    );

    const response = await handleRemoteIntegrationCredentials(
      new Request("https://app.example.com/api/internal/admin/remote-integrations/credentials", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          remoteUserId: "missing",
          integrationTypes: ["google_gmail"],
        }),
      }),
    );

    expect(response.status).toBe(404);
  });
});

describe("handleRemoteIntegrationUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLocalRemoteIntegrationUsersMock.mockResolvedValue([
      {
        id: "remote-user-1",
        email: "client@example.com",
        name: "Client User",
        enabledIntegrationTypes: ["google_gmail", "hubspot"],
      },
    ]);
  });

  it("rejects unauthorized requests", async () => {
    const response = await handleRemoteIntegrationUsers(
      new Request("https://app.example.com/api/internal/admin/remote-integrations/users", {
        method: "POST",
        body: JSON.stringify({ query: "client" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns matching users for authorized requests", async () => {
    const response = await handleRemoteIntegrationUsers(
      new Request("https://app.example.com/api/internal/admin/remote-integrations/users", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "client", limit: 5 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [
        {
          id: "remote-user-1",
          email: "client@example.com",
          name: "Client User",
          enabledIntegrationTypes: ["google_gmail", "hubspot"],
        },
      ],
    });
    expect(listLocalRemoteIntegrationUsersMock).toHaveBeenCalledWith({
      query: "client",
      limit: 5,
    });
  });
});
