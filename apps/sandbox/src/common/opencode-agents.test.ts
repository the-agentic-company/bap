import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readAgent(agentFileName: string): string {
  return readFileSync(path.join(__dirname, "agents", agentFileName), "utf8");
}

describe("OpenCode agent definitions", () => {
  it("allows the question tool for chat and coworker builder agents", () => {
    expect(readAgent("bap-chat.md")).toContain("permission:\n  question: allow");
    expect(readAgent("bap-coworker-builder.md")).toContain("permission:\n  question: allow");
  });

  it("teaches the coworker runner the Agentic-App output filename", () => {
    const runner = readAgent("bap-coworker-runner.md");

    expect(runner).toContain("<agentic_app_output>");
    expect(runner).toContain("/app/output.html exactly");
    expect(runner).toContain("custom downloadable HTML filename");
    expect(runner).toContain("</agentic_app_output>");
  });
});
