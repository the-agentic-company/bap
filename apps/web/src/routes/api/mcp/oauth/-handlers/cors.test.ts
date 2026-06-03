import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    APP_URL: "https://cmdclaw.ai",
    VITE_APP_URL: "https://cmdclaw.ai",
  },
}));

vi.mock("@/lib/trusted-origins", () => ({
  getTrustedOrigins: () => ["https://cmdclaw.ai", "https://app.cmdclaw.ai"],
}));

import { hostedMcpOauthOptionsResponse, withHostedMcpOauthCors } from "./cors";

function makeRequest(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new Request("https://cmdclaw.ai/api/mcp/oauth/token", { method: "POST", headers });
}

describe("withHostedMcpOauthCors", () => {
  it("echoes a whitelisted origin and preserves the underlying response", () => {
    const base = Response.json({ ok: true }, { status: 201, headers: { "X-Test": "1" } });
    const response = withHostedMcpOauthCors(makeRequest("https://app.cmdclaw.ai"), base);

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.cmdclaw.ai");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization, Accept",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("X-Test")).toBe("1");
  });

  it("allows loopback origins dynamically", () => {
    const response = withHostedMcpOauthCors(
      makeRequest("http://localhost:6274"),
      new Response(null, { status: 200 }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:6274");
  });

  it("falls back to the configured app origin for unknown origins", () => {
    const response = withHostedMcpOauthCors(
      makeRequest("https://evil.example.com"),
      new Response(null, { status: 200 }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://cmdclaw.ai");
  });

  it("falls back to the configured app origin when there is no origin header", () => {
    const response = withHostedMcpOauthCors(makeRequest(null), new Response(null, { status: 200 }));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://cmdclaw.ai");
  });

  it("preserves the JSON body of the wrapped response", async () => {
    const response = withHostedMcpOauthCors(
      makeRequest("https://cmdclaw.ai"),
      Response.json({ access_token: "abc" }),
    );

    await expect(response.json()).resolves.toEqual({ access_token: "abc" });
  });
});

describe("hostedMcpOauthOptionsResponse", () => {
  it("returns a 204 preflight with CORS headers for a whitelisted origin", () => {
    const response = hostedMcpOauthOptionsResponse(makeRequest("https://app.cmdclaw.ai"));

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.cmdclaw.ai");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });

  it("returns a 204 preflight with the fallback origin for unknown origins", () => {
    const response = hostedMcpOauthOptionsResponse(makeRequest("https://evil.example.com"));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://cmdclaw.ai");
  });
});
