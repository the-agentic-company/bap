import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "./security-headers-middleware";

describe("withSecurityHeaders", () => {
  it("adds default security headers to responses with immutable headers", () => {
    const response = withSecurityHeaders(Response.redirect("https://example.com/login", 303));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.com/login");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("x-dns-prefetch-control")).toBe("off");
  });

  it("does not override headers already set by the handler", () => {
    const response = withSecurityHeaders(
      new Response("ok", {
        headers: {
          "X-Frame-Options": "DENY",
        },
      }),
    );

    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});
