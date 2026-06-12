import { describe, expect, it } from "vitest";
import { resolveGatewayPublicOrigin } from "./public-origin";

describe("resolveGatewayPublicOrigin", () => {
  it("uses the explicit public origin header", () => {
    const request = new Request("http://127.0.0.1:3010/galien", {
      headers: {
        "x-bap-public-origin": "https://mcp.heybap.com",
      },
    });

    expect(resolveGatewayPublicOrigin(request)).toBe("https://mcp.heybap.com");
  });

  it("uses forwarded host and protocol headers", () => {
    const request = new Request("http://127.0.0.1:3010/galien", {
      headers: {
        "x-forwarded-host": "mcp.heybap.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(resolveGatewayPublicOrigin(request)).toBe("https://mcp.heybap.com");
  });

  it("defaults LocalCan hosts to HTTPS when no forwarded protocol is available", () => {
    const request = new Request("http://bap-mcp-03.beta.localcan.dev/galien");

    expect(resolveGatewayPublicOrigin(request)).toBe("https://bap-mcp-03.beta.localcan.dev");
  });
});
