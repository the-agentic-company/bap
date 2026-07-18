import { describe, expect, it, vi } from "vitest";
import { authorizeManagedBapRpcRequest } from "./managed-bap-authorization";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

function managedContext(params?: { status?: string; surface?: "chat" | "coworker_runner" }) {
  return {
    authSource: "managed_mcp",
    runtimeMcp: {
      token: "secret-token",
      userId: "user-1",
      workspaceId: "ws-1",
      internalKey: "bap",
      spawnDepth: 0,
      scopes: ["bap"],
      surface: params?.surface ?? "chat",
      generationId: "generation-1",
      conversationId: "conversation-1",
      expiresAt: 2_000_000_000,
    },
    db: {
      query: {
        generation: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            id: "generation-1",
            conversationId: "conversation-1",
            status: params?.status ?? "running",
            conversation: { userId: "user-1", workspaceId: "ws-1" },
          }),
        },
      },
    },
  };
}

describe("managed Bap downstream API authorization", () => {
  it("rejects replay against an administrative procedure before routing", async () => {
    const context = managedContext();
    const result = await authorizeManagedBapRpcRequest({
      request: new Request("https://heybap.com/api/rpc/billing/removeMember", { method: "POST" }),
      context: context as never,
    });

    expect(result).toMatchObject({ allowed: false, status: 403 });
    expect(context.db.query.generation.findFirst).not.toHaveBeenCalled();
  });

  it("accepts an allowlisted procedure while its bound Generation is running", async () => {
    const result = await authorizeManagedBapRpcRequest({
      request: new Request("https://heybap.com/api/rpc/coworker/get", { method: "POST" }),
      context: managedContext() as never,
    });

    expect(result).toEqual({ allowed: true });
  });

  it("rejects an otherwise allowlisted procedure after Generation termination", async () => {
    const result = await authorizeManagedBapRpcRequest({
      request: new Request("https://heybap.com/api/rpc/coworker/get", { method: "POST" }),
      context: managedContext({ status: "completed" }) as never,
    });

    expect(result).toMatchObject({
      allowed: false,
      message: "The managed Bap Generation is unavailable or terminal.",
    });
  });

  it("rejects a runner token from non-runner procedures", async () => {
    const result = await authorizeManagedBapRpcRequest({
      request: new Request("https://heybap.com/api/rpc/coworker/get", { method: "POST" }),
      context: managedContext({ surface: "coworker_runner" }) as never,
    });

    expect(result.allowed).toBe(false);
  });
});
