import { checkToolPermissions, parseBashCommand } from "@bap/core/server/ai/permission-checker";
import { describe, expect, test } from "vitest";

describe("parseBashCommand", () => {
  test("returns null for non-integration commands", () => {
    expect(parseBashCommand("echo hello")).toBeNull();
  });

  test("parses standard integration commands", () => {
    expect(parseBashCommand("slack send --channel general -t hi")).toEqual({
      integration: "slack",
      operation: "send",
      integrationName: "Slack",
      isWrite: true,
    });
  });

  test("parses hubspot nested resource/action operations", () => {
    expect(parseBashCommand("hubspot contacts create --email user@example.com")).toEqual({
      integration: "hubspot",
      operation: "contacts.create",
      integrationName: "HubSpot",
      isWrite: true,
    });
  });

  test("parses linkedin nested resource/action operations", () => {
    expect(parseBashCommand("linkedin chats list --limit 5")).toEqual({
      integration: "linkedin",
      operation: "chats.list",
      integrationName: "LinkedIn",
      isWrite: false,
    });
  });

  test("does not parse unsupported commands", () => {
    expect(parseBashCommand("mastodon post --text hello")).toBeNull();
    expect(parseBashCommand("forum feed --limit 5")).toBeNull();
  });

  test("supports google-* command names", () => {
    expect(parseBashCommand("google-calendar today")).toEqual({
      integration: "google_calendar",
      operation: "today",
      integrationName: "Google Calendar",
      isWrite: false,
    });

    expect(parseBashCommand("google-docs list")).toEqual({
      integration: "google_docs",
      operation: "list",
      integrationName: "Google Docs",
      isWrite: false,
    });

    expect(parseBashCommand("google-sheets update abc --range A1:B1 --values '[[\"x\"]]'")).toEqual(
      {
        integration: "google_sheets",
        operation: "update",
        integrationName: "Google Sheets",
        isWrite: true,
      },
    );

    expect(parseBashCommand("google-drive search -q budget")).toEqual({
      integration: "google_drive",
      operation: "search",
      integrationName: "Google Drive",
      isWrite: false,
    });

    expect(parseBashCommand('google-gmail search -q "from:boss"')).toEqual({
      integration: "google_gmail",
      operation: "search",
      integrationName: "Gmail",
      isWrite: false,
    });

    expect(parseBashCommand('outlook-mail search -q "invoice"')).toEqual({
      integration: "outlook",
      operation: "search",
      integrationName: "Outlook Mail",
      isWrite: false,
    });

    expect(parseBashCommand('outlook-mail contact -q "Jane Doe"')).toEqual({
      integration: "outlook",
      operation: "contact",
      integrationName: "Outlook Mail",
      isWrite: false,
    });

    expect(parseBashCommand("outlook-mail contacts list --limit 25")).toEqual({
      integration: "outlook",
      operation: "contacts.list",
      integrationName: "Outlook Mail",
      isWrite: false,
    });
  });

  test("rejects legacy short aliases", () => {
    expect(
      parseBashCommand(
        "gcalendar create --summary Test --start 2026-02-25T09:00:00 --end 2026-02-25T10:00:00",
      ),
    ).toBeNull();
    expect(parseBashCommand("gdocs list")).toBeNull();
    expect(parseBashCommand("gsheets list")).toBeNull();
    expect(parseBashCommand("gdrive list")).toBeNull();
  });

  test("parses google-calendar writes", () => {
    expect(
      parseBashCommand(
        "google-calendar create --summary Test --start 2026-02-25T09:00:00 --end 2026-02-25T10:00:00",
      ),
    ).toEqual({
      integration: "google_calendar",
      operation: "create",
      integrationName: "Google Calendar",
      isWrite: true,
    });
  });
});

describe("checkToolPermissions", () => {
  test("auto-allows non-bash tools", () => {
    expect(checkToolPermissions("web_search", {}, [])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("auto-allows non-integration bash commands", () => {
    expect(checkToolPermissions("bash", { command: "ls -la" }, [])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("requires auth when integration is missing", () => {
    expect(checkToolPermissions("bash", { command: "slack channels" }, [])).toEqual({
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: "slack",
      integrationName: "Slack",
      reason: "Slack authentication required",
    });
  });

  test("requires approval for write commands with auth", () => {
    expect(
      checkToolPermissions("bash", { command: "slack send -c general -t hi" }, ["slack"]),
    ).toEqual({
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: "slack",
      integrationName: "Slack",
    });
  });

  test("allows read commands with auth", () => {
    expect(checkToolPermissions("bash", { command: "github prs" }, ["github"])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("allows Gmail and Outlook read commands when auth exists", () => {
    expect(
      checkToolPermissions("bash", { command: 'google-gmail search -q "from:boss"' }, [
        "google_gmail",
      ]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });

    expect(
      checkToolPermissions("bash", { command: 'outlook-mail search -q "invoice"' }, ["outlook"]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });

    expect(
      checkToolPermissions("bash", { command: 'outlook-mail contact -q "Jane Doe"' }, ["outlook"]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
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

  test("requires auth for github when integration token is missing", () => {
    expect(checkToolPermissions("bash", { command: "github repos" }, [])).toEqual({
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: "github",
      integrationName: "GitHub",
      reason: "GitHub authentication required",
    });
  });

  test("requires approval for slack write operations with auth", () => {
    expect(
      checkToolPermissions("bash", { command: "slack send --channel general -t hi" }, ["slack"]),
    ).toEqual({
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: "slack",
      integrationName: "Slack",
    });
  });

  test("allows slack read operations when auth exists", () => {
    expect(checkToolPermissions("bash", { command: "slack history general" }, ["slack"])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });
});
