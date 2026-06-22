import { describe, expect, it } from "vitest";
import { matchProtectedResourceMetadataRequest, routeMcpRequest } from "./router";

describe("routeMcpRequest", () => {
  const env = {
    BAP_BAP_MCP_TARGET: "http://127.0.0.1:4101",
    BAP_GMAIL_MCP_TARGET: "http://127.0.0.1:4102",
    BAP_GALIEN_MCP_TARGET: "http://127.0.0.1:4103",
  };

  it("routes Bap MCP requests to the Bap server", () => {
    const routed = routeMcpRequest(new URL("https://mcp.heybap.com/bap"), env);
    expect(routed?.slug).toBe("bap");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4101/mcp");
  });

  it("does not route the old platform MCP path", () => {
    const oldPlatformPath = ["cmd", "claw"].join("");
    expect(routeMcpRequest(new URL(`https://mcp.heybap.com/${oldPlatformPath}`), env)).toBeNull();
  });

  it("routes galien MCP requests", () => {
    const routed = routeMcpRequest(new URL("https://mcp.heybap.com/galien"), env);
    expect(routed?.slug).toBe("galien");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4103/mcp");
  });

  it("routes legacy slug/mcp requests", () => {
    const routed = routeMcpRequest(new URL("https://mcp.heybap.com/galien/mcp"), env);
    expect(routed?.slug).toBe("galien");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4103/mcp");
  });

  it("does not route the retired Modulr document download endpoint", () => {
    const routed = routeMcpRequest(
      new URL("https://mcp.heybap.com/modulr/documents/download?token=abc"),
      {
        ...env,
        BAP_MODULR_MCP_TARGET: "http://127.0.0.1:4104",
      },
    );

    expect(routed).toBeNull();
  });

  it("matches the spec protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.heybap.com/.well-known/oauth-protected-resource/gmail"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("matches the Bap protected-resource metadata path to the Bap server", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.heybap.com/.well-known/oauth-protected-resource/bap"),
      ),
    ).toEqual({ slug: "bap" });
  });

  it("does not match the old platform protected-resource metadata path", () => {
    const oldPlatformPath = ["cmd", "claw"].join("");
    expect(
      matchProtectedResourceMetadataRequest(
        new URL(`https://mcp.heybap.com/.well-known/oauth-protected-resource/${oldPlatformPath}`),
      ),
    ).toBeNull();
  });

  it("matches the legacy spec protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.heybap.com/.well-known/oauth-protected-resource/gmail/mcp"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("matches the legacy protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.heybap.com/gmail/.well-known/oauth-protected-resource"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("returns null for unknown slugs", () => {
    expect(routeMcpRequest(new URL("https://mcp.heybap.com/unknown"), env)).toBeNull();
  });
});
