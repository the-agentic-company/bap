import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "@bap/client";
import { createMcpClient } from "./client";

vi.mock("@bap/client", () => ({
  DEFAULT_SERVER_URL: "https://app.example.com",
  createRpcClient: vi.fn(() => ({ rpc: true })),
}));

const mockedCreateRpcClient = vi.mocked(createRpcClient);
const originalAppServerUrl = process.env.APP_SERVER_URL;

describe("createMcpClient", () => {
  beforeEach(() => {
    mockedCreateRpcClient.mockClear();
    delete process.env.APP_SERVER_URL;
  });

  afterEach(() => {
    if (originalAppServerUrl === undefined) {
      delete process.env.APP_SERVER_URL;
    } else {
      process.env.APP_SERVER_URL = originalAppServerUrl;
    }
  });

  it("forwards the hosted MCP issuer to the Bap API client", () => {
    const state = createMcpClient(
      {
        authInfo: {
          token: "hosted-token",
          clientId: "client-1",
          scopes: ["bap"],
          extra: {
            audience: "bap",
            authType: "hosted_oauth",
            issuer: "https://mcp.heybap.com/",
          },
        },
      } as never,
      "ws-2",
    );

    expect(state.status).toBe("ready");
    expect(mockedCreateRpcClient).toHaveBeenCalledWith("https://app.example.com", "hosted-token", {
      "X-Bap-Public-Origin": "https://mcp.heybap.com/",
      "X-Bap-Workspace-Id": "ws-2",
    });
  });

  it("does not forward a public-origin header for managed MCP tokens", () => {
    const state = createMcpClient({
      authInfo: {
        token: "managed-token",
        clientId: "bap-executor",
        scopes: ["bap"],
        extra: {
          audience: "bap",
          authType: "managed",
        },
      },
    } as never);

    expect(state.status).toBe("ready");
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(
      "https://app.example.com",
      "managed-token",
      undefined,
    );
  });

  it("uses the MCP process APP_SERVER_URL when configured", () => {
    process.env.APP_SERVER_URL = "https://configured.example.com";

    const state = createMcpClient({
      authInfo: {
        token: "managed-token",
        clientId: "bap-executor",
        scopes: ["bap"],
        extra: {
          audience: "bap",
          authType: "managed",
        },
      },
    } as never);

    expect(state.status).toBe("ready");
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(
      "https://configured.example.com",
      "managed-token",
      undefined,
    );
  });
});
