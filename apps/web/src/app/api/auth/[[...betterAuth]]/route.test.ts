import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHandlerMock } = vi.hoisted(() => ({
  getHandlerMock: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: getHandlerMock,
    POST: vi.fn(),
    PUT: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: {},
}));

vi.mock("@/env", () => ({
  env: {
    APP_URL: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
  },
}));

vi.mock("@/lib/trusted-origins", () => ({
  getTrustedOrigins: vi.fn(() => ["https://cmdclaw.ai"]),
}));

import { GET } from "./route";

function getLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("GET /api/auth/[[...betterAuth]]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects invite-only social callback errors to the public fallback page", async () => {
    getHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "invite_only", message: "invite_only" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const response = await GET(
      new NextRequest("https://cmdclaw.ai/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("https://cmdclaw.ai/invite-only?source=social-google");
  });

  it("forwards the email from the invite-only error body when present", async () => {
    getHandlerMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "invite_only",
          message: "invite_only",
          email: "alice@example.com",
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const response = await GET(
      new NextRequest("https://cmdclaw.ai/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cmdclaw.ai/invite-only?source=social-google&email=alice%40example.com",
    );
  });
});
