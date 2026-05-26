import { afterEach, describe, expect, it, vi } from "vitest";
import getClientAppointments from "../tools/get_clients_by_client_id_appointments";

describe("get_clients_by_client_id_appointments", () => {
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

  it("requests client appointments with Galien date-only filters", async () => {
    const bearerToken = "Bearer header.payload.signature";
    const requests: string[] = [];

    process.env.CMDCLAW_SERVER_URL = "https://cmdclaw.example";
    process.env.CMDCLAW_SERVER_SECRET = "server-secret";
    globalThis.fetch = vi.fn(async (input, init) => {
      requests.push(String(input));

      if (String(input) === "https://cmdclaw.example/api/internal/mcp/galien-credentials") {
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
      return new Response(JSON.stringify({ total: 1, data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await getClientAppointments(
      {
        clientId: 14,
        startDate: "2026-05-25",
        endDate: "2026-05-31",
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
      "https://api.frontline.galien.preprod.webhelpmedica.com/api/v1/clients/14/appointments?startDate=2026-05-25&endDate=2026-05-31&size=50&offset=0",
    );
  });
});
