import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "@bap/client";
import { createMcpClient } from "./client";

vi.mock("@bap/client", () => ({
  DEFAULT_SERVER_URL: "https://app.example.com",
  createRpcClient: vi.fn(() => ({ rpc: true })),
}));

const mockedCreateRpcClient = vi.mocked(createRpcClient);

describe("createMcpClient", () => {
  beforeEach(() => {
    mockedCreateRpcClient.mockClear();
  });

  it("forwards the hosted MCP issuer to the Bap API client", () => {
    const state = createMcpClient({
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
    } as never);

    expect(state.status).toBe("ready");
    expect(mockedCreateRpcClient).toHaveBeenCalledWith("https://app.example.com", "hosted-token", {
      "X-Bap-Public-Origin": "https://mcp.heybap.com/",
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
});
