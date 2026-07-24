import { describe, expect, it } from "vitest";
import { buildBapToolError, buildBapToolResult } from "./result-contract";

describe("Bap MCP result contract", () => {
  it("normalizes success data and cursor into the common envelope", () => {
    expect(
      buildBapToolResult({
        action: "coworkerRun_read",
        workspaceId: "ws-1",
        result: { status: "completed", runs: [{ id: "run-1" }], nextCursor: "cursor-2" },
      }),
    ).toEqual({
      status: "completed",
      workspaceId: "ws-1",
      action: "coworkerRun_read",
      data: { runs: [{ id: "run-1" }] },
      nextCursor: "cursor-2",
    });
  });

  it("returns a machine-readable safe error without bearer credentials", () => {
    const result = buildBapToolError({
      action: "workspaceMember_save",
      workspaceId: "ws-1",
      error: new Error("Forbidden with Bearer secret-token-value"),
    });

    expect(result).toMatchObject({
      status: "failed",
      workspaceId: "ws-1",
      action: "workspaceMember_save",
      error: { category: "forbidden", retryable: false },
    });
    expect(result.error.message).not.toContain("secret-token-value");
  });

  it("classifies backend input validation failures as non-retryable invalid input", () => {
    const result = buildBapToolError({
      action: "connectedAccount_connect",
      workspaceId: "ws-1",
      error: new Error("Input validation failed"),
    });

    expect(result).toMatchObject({
      status: "failed",
      workspaceId: "ws-1",
      action: "connectedAccount_connect",
      error: { category: "invalid_input", retryable: false },
    });
  });
});
