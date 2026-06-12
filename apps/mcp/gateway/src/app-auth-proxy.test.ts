import { describe, expect, it } from "vitest";
import { shouldProxyAppAuthFlowPath } from "./app-auth-proxy";

describe("shouldProxyAppAuthFlowPath", () => {
  it("proxies the hosted MCP browser auth flow through the gateway domain", () => {
    expect(shouldProxyAppAuthFlowPath("/login")).toBe(true);
    expect(shouldProxyAppAuthFlowPath("/api/auth/sign-in/social")).toBe(true);
    expect(shouldProxyAppAuthFlowPath("/api/auth/callback/google")).toBe(true);
    expect(shouldProxyAppAuthFlowPath("/sign-in/token-1/confirm")).toBe(true);
  });

  it("proxies static assets required by the login page", () => {
    expect(shouldProxyAppAuthFlowPath("/assets/index.js")).toBe(true);
    expect(shouldProxyAppAuthFlowPath("/favicon.ico")).toBe(true);
    expect(shouldProxyAppAuthFlowPath("/site.webmanifest")).toBe(true);
  });

  it("does not reintroduce the old CmdClaw MCP slug as an app proxy path", () => {
    expect(shouldProxyAppAuthFlowPath("/cmdclaw")).toBe(false);
    expect(shouldProxyAppAuthFlowPath("/cmdclaw/authorize")).toBe(false);
  });
});
