import { describe, expect, it } from "vitest";
import { buildBapToolError, buildBapToolResult } from "./result-contract";

describe("Bap MCP result contract", () => {
  it("normalizes success data and cursor into the common envelope", () => {
    expect(
      buildBapToolResult({
        action: "coworkerRun.read",
        workspaceId: "ws-1",
        result: { status: "completed", runs: [{ id: "run-1" }], nextCursor: "cursor-2" },
      }),
    ).toEqual({
      status: "completed",
      workspaceId: "ws-1",
      action: "coworkerRun.read",
      data: { runs: [{ id: "run-1" }] },
      nextCursor: "cursor-2",
    });
  });

  it("returns a machine-readable safe error without bearer credentials", () => {
    const result = buildBapToolError({
      action: "workspaceMember.save",
      workspaceId: "ws-1",
      error: new Error("Forbidden with Bearer secret-token-value"),
    });

    expect(result).toMatchObject({
      status: "failed",
      workspaceId: "ws-1",
      action: "workspaceMember.save",
      error: { category: "forbidden", retryable: false },
    });
    expect(result.error.message).not.toContain("secret-token-value");
  });
});
