import { describe, expect, it } from "vitest";
import { filterManagedToolsListPayload } from "./middleware";

describe("Bap MCP capability discovery", () => {
  it("filters tools/list to the deterministic managed surface profile", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "workspace.list" },
          { name: "coworker.read" },
          { name: "workspaceMember.save" },
          { name: "workspaceMcpServer.setCredential" },
        ],
      },
    };

    expect(filterManagedToolsListPayload(payload, "chat")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "workspace.list" }, { name: "coworker.read" }] },
    });
  });

  it("shows only runner.markFailed to a Coworker runner", () => {
    const payload = {
      result: {
        tools: [{ name: "coworker.read" }, { name: "runner.markFailed" }],
      },
    };

    expect(filterManagedToolsListPayload(payload, "coworker_runner")).toEqual({
      result: { tools: [{ name: "runner.markFailed" }] },
    });
  });
});
