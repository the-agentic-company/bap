import { describe, expect, it } from "vitest";
import { matchProtectedResourceMetadataRequest, routeMcpRequest } from "./router";

describe("routeMcpRequest", () => {
  const env = {
    CMDCLAW_INTERNAL_MCP_TARGET: "http://127.0.0.1:4101",
    CMDCLAW_GMAIL_MCP_TARGET: "http://127.0.0.1:4102",
    CMDCLAW_GALIEN_MCP_TARGET: "http://127.0.0.1:4103",
  };

  it("routes internal MCP requests", () => {
    const routed = routeMcpRequest(new URL("https://mcp.cmdclaw.ai/internal"), env);
    expect(routed?.slug).toBe("internal");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4101/mcp");
  });

  it("routes galien MCP requests", () => {
    const routed = routeMcpRequest(new URL("https://mcp.cmdclaw.ai/galien"), env);
    expect(routed?.slug).toBe("galien");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4103/mcp");
  });

  it("routes legacy slug/mcp requests", () => {
    const routed = routeMcpRequest(new URL("https://mcp.cmdclaw.ai/galien/mcp"), env);
    expect(routed?.slug).toBe("galien");
    expect(routed?.target.toString()).toBe("http://127.0.0.1:4103/mcp");
  });

  it("does not route the retired Modulr document download endpoint", () => {
    const routed = routeMcpRequest(
      new URL("https://mcp.cmdclaw.ai/modulr/documents/download?token=abc"),
      {
        ...env,
        CMDCLAW_MODULR_MCP_TARGET: "http://127.0.0.1:4104",
      },
    );

    expect(routed).toBeNull();
  });

  it("matches the spec protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.cmdclaw.ai/.well-known/oauth-protected-resource/gmail"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("matches the legacy spec protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.cmdclaw.ai/.well-known/oauth-protected-resource/gmail/mcp"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("matches the legacy protected-resource metadata path", () => {
    expect(
      matchProtectedResourceMetadataRequest(
        new URL("https://mcp.cmdclaw.ai/gmail/.well-known/oauth-protected-resource"),
      ),
    ).toEqual({ slug: "gmail" });
  });

  it("returns null for unknown slugs", () => {
    expect(routeMcpRequest(new URL("https://mcp.cmdclaw.ai/reddit"), env)).toBeNull();
  });
});
