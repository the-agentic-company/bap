import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

import { handleNangoProviders } from "./nango-providers";

function makeRequest() {
  return new Request("https://cmdclaw.ai/api/integrations/nango/providers", {
    method: "GET",
  });
}

describe("handleNangoProviders", () => {
  const originalKey = process.env.NANGO_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    process.env.NANGO_SECRET_KEY = "nango-secret";
  });

  afterEach(() => {
    process.env.NANGO_SECRET_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await handleNangoProviders(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns an empty provider list with 200 when NANGO_SECRET_KEY is missing", async () => {
    delete process.env.NANGO_SECRET_KEY;

    const response = await handleNangoProviders(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [],
      error: "Missing NANGO_SECRET_KEY",
    });
  });

  it("normalizes, filters, and sorts the Nango provider catalog", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              provider: "zoom",
              display_name: "Zoom",
              logo: "https://logo/zoom.svg",
              auth_type: "OAUTH2",
              categories: ["video"],
              docs_url: "https://docs/zoom",
            },
            // missing display name -> filtered out
            { config_key: "no-name" },
            {
              name: "asana",
              display_name: "Asana",
              categories: ["pm", 42],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const response = await handleNangoProviders(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      providers: Array<{ name: string; displayName: string; categories: string[] }>;
    };
    expect(body.providers.map((p) => p.name)).toEqual(["asana", "zoom"]);
    expect(body.providers[0]).toMatchObject({
      name: "asana",
      displayName: "Asana",
      logoUrl: null,
      authMode: null,
      categories: ["pm"],
      docs: null,
    });
    expect(body.providers[1]).toMatchObject({
      name: "zoom",
      logoUrl: "https://logo/zoom.svg",
      authMode: "OAUTH2",
      docs: "https://docs/zoom",
    });

    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer nango-secret");
  });

  it("returns 502 when the Nango API responds with an error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const response = await handleNangoProviders(makeRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch providers" });
  });
});
