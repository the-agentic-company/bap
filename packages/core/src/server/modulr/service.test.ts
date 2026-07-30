import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUserUseModulrInWorkspace,
  normalizeModulrWorkspaceConnection,
  setModulrWorkspaceConnection,
  validateModulrWorkspaceConnection,
} from "./service";

vi.mock("@bap/db/client", () => ({
  db: {},
}));

vi.mock("@bap/db/schema", () => ({
  modulrWorkspaceAccess: {
    workspaceId: "access.workspaceId",
    email: "access.email",
  },
  workspaceAuthorization: {},
  workspaceMcpAuthorization: {
    userId: "authorization.userId",
    workspaceMcpServerId: "authorization.workspaceMcpServerId",
  },
  workspaceMcpServer: {
    internalKey: "source.internalKey",
    workspaceId: "source.workspaceId",
  },
  workspaceMember: {
    userId: "membership.userId",
    organizationId: "membership.organizationId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => [left, right]),
}));

vi.mock("../utils/encryption", () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

describe("Modulr service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates Modulr credentials with a form-encoded token request", async () => {
    const fetchMock = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded",
          Database: "assurhelium",
        }),
      );
      expect(String(init?.body)).toBe(
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: "api",
          client_secret: "test-secret",
        }).toString(),
      );
      return jsonResponse({ data: { access_token: "token", expires_in: 3600 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateModulrWorkspaceConnection({
        database: "assurhelium",
        clientId: "api",
        clientSecret: "test-secret",
        locale: "fr",
        baseUrl: "https://app.modulr-courtage.fr",
      }),
    ).resolves.toEqual({ ok: true, expiresIn: 3600 });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://app.modulr-courtage.fr/fr/api/1.0/tokens/users"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1",
    "https://example.com",
    "http://app.modulr-courtage.fr",
  ])("rejects an untrusted Modulr base URL: %s", (baseUrl) => {
    expect(() =>
      normalizeModulrWorkspaceConnection({
        database: "assurhelium",
        clientId: "api",
        clientSecret: "secret",
        locale: "fr",
        baseUrl,
      }),
    ).toThrow("Modulr base URL must be https://app.modulr-courtage.fr.");
  });

  it("stores Modulr credentials for the current user without replacing other members", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const database = {
      query: {
        workspaceMcpServer: {
          findFirst: vi.fn().mockResolvedValue({ id: "modulr-source" }),
        },
      },
      insert,
    };

    await setModulrWorkspaceConnection({
      database: database as never,
      workspaceId: "workspace-1",
      userId: "user-1",
      connection: {
        database: "assurhelium",
        clientId: "api",
        clientSecret: "test-secret",
        locale: "fr",
        baseUrl: "https://app.modulr-courtage.fr",
      },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceMcpServerId: "modulr-source",
      }),
    );
    expect(database).not.toHaveProperty("delete");
  });

  it.each([
    {
      label: "workspace-wide access",
      workspaceWide: true,
      userGrant: null,
      expected: true,
    },
    {
      label: "a specific-user grant",
      workspaceWide: false,
      userGrant: { id: "grant-1" },
      expected: true,
    },
    {
      label: "no matching grant",
      workspaceWide: false,
      userGrant: null,
      expected: false,
    },
  ])("allows a workspace member through $label", async ({ workspaceWide, userGrant, expected }) => {
    const database = {
      query: {
        workspaceMember: {
          findFirst: vi.fn().mockResolvedValue({ user: { email: "User@Example.com" } }),
        },
        workspaceMcpServer: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "modulr-source", managedWorkspaceWideAccess: workspaceWide }),
        },
        modulrWorkspaceAccess: {
          findFirst: vi.fn().mockResolvedValue(userGrant),
        },
      },
    };

    await expect(
      canUserUseModulrInWorkspace({
        database: database as never,
        workspaceId: "workspace-1",
        userId: "user-1",
      }),
    ).resolves.toBe(expected);
  });
});
