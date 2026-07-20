import { describe, expect, it } from "vitest";
import {
  isManagedBapRpcAllowed,
  isManagedBapToolAllowed,
  MANAGED_BAP_TOOL_PROFILES,
} from "./managed-bap-capabilities";

describe("managed Bap capability profiles", () => {
  it("keeps administrative tools out of every managed profile", () => {
    for (const tools of Object.values(MANAGED_BAP_TOOL_PROFILES)) {
      expect(tools).not.toContain("workspaceMember.save");
      expect(tools).not.toContain("connectedAccount.connect");
      expect(tools).not.toContain("workspaceMcpServer.setCredential");
      expect(tools).not.toContain("workspaceMcpServer.startOAuth");
    }
  });

  it("limits the runner profile to its Generation-bound failure tool and procedure", () => {
    expect(MANAGED_BAP_TOOL_PROFILES.coworker_runner).toEqual(["runner.markFailed"]);
    expect(
      isManagedBapRpcAllowed("coworker_runner", "generation/markCurrentCoworkerRunFailed"),
    ).toBe(true);
    expect(isManagedBapRpcAllowed("coworker_runner", "coworker/update")).toBe(false);
  });

  it("uses the chat profile when old managed tokens omit a surface", () => {
    expect(isManagedBapToolAllowed(undefined, "workspace.list")).toBe(true);
    expect(isManagedBapRpcAllowed(undefined, "billing/overview")).toBe(true);
    expect(isManagedBapToolAllowed(undefined, "coworker.read")).toBe(true);
    expect(isManagedBapToolAllowed(undefined, "workspaceMember.list")).toBe(false);
  });
});
