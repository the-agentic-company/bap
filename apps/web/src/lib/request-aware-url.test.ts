import { beforeEach, describe, expect, it } from "vitest";
import { buildRequestAwareUrl, getRequestAwareOrigin } from "./request-aware-url";

describe("request-aware-url", () => {
  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
  });

  it("preserves the request origin for public hosts", () => {
    expect(getRequestAwareOrigin("https://app.example.com/toolbox")).toBe(
      "https://app.example.com",
    );
  });

  it("uses APP_URL when the request host is internal", () => {
    process.env.APP_URL = "https://app.example.com";

    expect(getRequestAwareOrigin("https://0.0.0.0:3000/toolbox")).toBe("https://app.example.com");
  });

  it("uses the gateway public origin header before the configured app origin", () => {
    process.env.APP_URL = "https://cmdclaw-web-prod.onrender.com";

    const request = new Request(
      "https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize?scope=bap",
      {
        headers: {
          "x-bap-public-origin": "https://mcp.heybap.com",
        },
      },
    );

    expect(getRequestAwareOrigin(request)).toBe("https://mcp.heybap.com");
    expect(buildRequestAwareUrl("/login", request)).toEqual(
      new URL("https://mcp.heybap.com/login"),
    );
  });

  it("uses heybap.com forwarded host and protocol headers before the request URL origin", () => {
    const request = new Request(
      "https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize?scope=bap",
      {
        headers: {
          "x-forwarded-host": "mcp.heybap.com",
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(getRequestAwareOrigin(request)).toBe("https://mcp.heybap.com");
  });

  it("ignores non-Bap public origin headers", () => {
    const request = new Request("https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize", {
      headers: {
        "x-cmdclaw-public-origin": "https://cmdclaw.ai",
      },
    });

    expect(getRequestAwareOrigin(request)).toBe("https://cmdclaw-web-prod.onrender.com");
  });

  it("ignores untrusted forwarded hosts", () => {
    const request = new Request("https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize", {
      headers: {
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(getRequestAwareOrigin(request)).toBe("https://cmdclaw-web-prod.onrender.com");
  });

  it("normalizes absolute internal redirect targets to the configured app origin", () => {
    process.env.APP_URL = "https://app.example.com";

    expect(
      buildRequestAwareUrl("https://0.0.0.0:3000/toolbox?success=true", "https://0.0.0.0:3000/api"),
    ).toEqual(new URL("https://app.example.com/toolbox?success=true"));
  });
});
