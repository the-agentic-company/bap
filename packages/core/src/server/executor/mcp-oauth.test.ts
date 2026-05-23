import { afterEach, describe, expect, it } from "vitest";
import { buildMcpOAuthClientMetadata } from "./mcp-oauth";

const originalAppUrl = process.env.APP_URL;
const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

describe("buildMcpOAuthClientMetadata", () => {
  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
  });

  it("uses the CmdClaw brand name and a public logo URL derived from APP_URL", () => {
    process.env.APP_URL = "https://cmdclaw.ai";
    delete process.env.NEXT_PUBLIC_APP_URL;

    const metadata = buildMcpOAuthClientMetadata("http://localhost:3000/api/oauth/callback");

    expect(metadata.client_name).toBe("CmdClaw");
    expect(metadata.logo_uri).toBe("https://cmdclaw.ai/logo.png");
  });

  it("falls back to the public CmdClaw logo when only a loopback callback is available", () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const metadata = buildMcpOAuthClientMetadata("http://localhost:3000/api/oauth/callback");

    expect(metadata.logo_uri).toBe("https://cmdclaw.ai/logo.png");
  });
});
