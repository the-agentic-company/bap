import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateModulrWorkspaceConnection } from "./service";

vi.mock("@cmdclaw/db/client", () => ({
  db: {},
}));

vi.mock("@cmdclaw/db/schema", () => ({
  modulrWorkspaceAccess: {},
  workspaceAuthorization: {},
  workspaceMcpAuthorization: {},
  workspaceMcpServer: {},
  workspaceMember: {},
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
});
