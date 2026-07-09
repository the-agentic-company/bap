import { describe, expect, it } from "vitest";
import { checkToolPermissions, parseBashCommand } from "./permission-checker";

describe("permission-checker", () => {
  it("parses coworker commands for tool metadata", () => {
    expect(
      parseBashCommand(
        "coworker edit cw-1 --base-updated-at 2026-03-03T12:00:00.000Z --changes-file /tmp/changes.json --json",
      ),
    ).toEqual({
      integration: "coworker",
      operation: "edit",
      integrationName: "Coworker",
      isWrite: true,
    });
  });

  it("does not require auth or approval for coworker commands", () => {
    expect(
      checkToolPermissions(
        "bash",
        {
          command:
            'coworker invoke --username linkedin-digest --message "Review this inbox" --json',
        },
        [],
      ),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  it("parses coworker commands inside compound shell commands", () => {
    expect(
      parseBashCommand(
        "python -c \"print('hi')\" && coworker edit cw-1 --base-updated-at 2026-03-03T12:00:00.000Z --changes-file /tmp/changes.json --json",
      ),
    ).toEqual({
      integration: "coworker",
      operation: "edit",
      integrationName: "Coworker",
      isWrite: true,
    });
  });

  it("parses integration commands with leading global options", () => {
    expect(parseBashCommand('slack --account baptiste-2 send -c C123 -t "hi" --as bot')).toEqual({
      integration: "slack",
      operation: "send",
      integrationName: "Slack",
      isWrite: true,
    });

    expect(
      checkToolPermissions(
        "bash",
        { command: 'slack --account baptiste-2 send -c C123 -t "hi" --as bot' },
        ["slack"],
      ),
    ).toEqual({
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: "slack",
      integrationName: "Slack",
    });
  });

  it("parses agent-browser commands for tool metadata", () => {
    expect(parseBashCommand("agent-browser screenshot --full /tmp/example.png")).toEqual({
      integration: "agent-browser",
      operation: "screenshot",
      integrationName: "Agent Browser",
      isWrite: false,
    });
  });

  it("does not require auth or approval for agent-browser commands", () => {
    expect(
      checkToolPermissions(
        "bash",
        {
          command: "agent-browser open https://example.com",
        },
        [],
      ),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  it("allows Outlook contact lookups as read commands", () => {
    expect(parseBashCommand('outlook-mail contact -q "Jane Doe"')).toEqual({
      integration: "outlook",
      operation: "contact",
      integrationName: "Outlook Mail",
      isWrite: false,
    });

    expect(
      checkToolPermissions("bash", { command: 'outlook-mail contact -q "Jane Doe"' }, ["outlook"]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });

    expect(parseBashCommand("outlook-mail contacts list --limit 25")).toEqual({
      integration: "outlook",
      operation: "contacts.list",
      integrationName: "Outlook Mail",
      isWrite: false,
    });

    expect(
      checkToolPermissions("bash", { command: "outlook-mail contacts list --limit 25" }, [
        "outlook",
      ]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });
});
