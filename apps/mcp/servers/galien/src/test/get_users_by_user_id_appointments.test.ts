import { afterEach, describe, expect, it, vi } from "vitest";
import getMyAppointments from "../tools/get_users_by_user_id_appointments";

describe("get_my_appointments", () => {
  const originalFetch = globalThis.fetch;
  const originalServerUrl = process.env.CMDCLAW_SERVER_URL;
  const originalServerSecret = process.env.CMDCLAW_SERVER_SECRET;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalServerUrl === undefined) {
      delete process.env.CMDCLAW_SERVER_URL;
    } else {
      process.env.CMDCLAW_SERVER_URL = originalServerUrl;
    }
    if (originalServerSecret === undefined) {
      delete process.env.CMDCLAW_SERVER_SECRET;
    } else {
      process.env.CMDCLAW_SERVER_SECRET = originalServerSecret;
    }
    vi.restoreAllMocks();
  });

  it("requests the authenticated user's appointment endpoint", async () => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify({ id: 2, role: "ROLE_USER" })).toString(
      "base64url",
    );
    const bearerToken = `Bearer ${header}.${payload}.signature`;
    const requests: string[] = [];

    process.env.CMDCLAW_SERVER_URL = "https://cmdclaw.example";
    process.env.CMDCLAW_SERVER_SECRET = "server-secret";
    globalThis.fetch = vi.fn(async (input, init) => {
      requests.push(String(input));

      if (String(input) === "https://cmdclaw.example/api/internal/mcp/galien-credentials") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer server-secret",
        });
        return new Response(JSON.stringify({ username: "user@example.com", password: "password" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (String(input).endsWith("/api/v1/tokens/login")) {
        expect(init?.method).toBe("POST");
        return new Response("[]", {
          status: 200,
          headers: {
            authorization: bearerToken,
          },
        });
      }

      expect(init?.headers).toMatchObject({
        authorization: bearerToken,
      });
      return new Response(JSON.stringify({ total: 0, data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await getMyAppointments(
      {
        startDate: "2026-05-25T00:00:00.000Z",
        endDate: "2026-05-31T23:59:59.999Z",
        size: 50,
        offset: 0,
      },
      {
        authInfo: {
          extra: {
            audience: "galien",
            userId: "cmdclaw-user-id",
            workspaceId: "workspace-id",
          },
        },
      } as never,
    );

    expect(requests[2]).toBe(
      "https://api.frontline.galien.preprod.webhelpmedica.com/api/v1/users/2/appointments?startDate=2026-05-25T00%3A00%3A00.000Z&endDate=2026-05-31T23%3A59%3A59.999Z&size=50&offset=0",
    );
  });
});
