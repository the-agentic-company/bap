import { describe, expect, it } from "vitest";
import {
  MANAGED_INTEGRATION_CATALOG,
  MANAGED_INTEGRATION_TYPES,
  getManagedOperationDescriptor,
  managedOperationId,
  parseManagedIntegrationCliCommand,
  parseManagedIntegrationCliCommands,
  resolveManagedMcpTool,
} from "./operation-catalog";

describe("managed integration operation catalog", () => {
  it("has exactly one descriptor for every managed Integration Type", () => {
    expect(MANAGED_INTEGRATION_CATALOG.map((entry) => entry.integrationType).toSorted()).toEqual(
      [...MANAGED_INTEGRATION_TYPES].toSorted(),
    );
    expect(new Set(MANAGED_INTEGRATION_CATALOG.map((entry) => entry.integrationType)).size).toBe(
      MANAGED_INTEGRATION_CATALOG.length,
    );
  });

  it("has unique operations and MCP aliases", () => {
    const mcpAliases = new Set<string>();
    for (const integration of MANAGED_INTEGRATION_CATALOG) {
      expect(new Set(integration.operations.map((entry) => entry.key)).size).toBe(
        integration.operations.length,
      );
      for (const operation of integration.operations) {
        for (const alias of operation.mcpToolNames ?? []) {
          expect(mcpAliases.has(alias)).toBe(false);
          mcpAliases.add(alias);
        }
      }
    }
  });

  it("maps equivalent Gmail CLI and MCP operations to one canonical identity", () => {
    const cli = parseManagedIntegrationCliCommand(
      'google-gmail --account personal send --to "a@example.com" --subject Hi --body Hello',
    );
    const mcp = resolveManagedMcpTool("gmail.send");

    expect(cli).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "send",
      accessHint: "write",
    });
    expect(mcp).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "send",
    });
    expect(managedOperationId(cli!.integrationType, cli!.operationKey)).toBe(
      managedOperationId(mcp!.integrationType, mcp!.operationKey),
    );
  });

  it("recognizes Gmail draft as a write operation", () => {
    expect(
      parseManagedIntegrationCliCommand("google-gmail draft --to a@example.com"),
    ).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "draft",
      accessHint: "write",
    });
    expect(resolveManagedMcpTool("gmail.draft")).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "draft",
    });
  });

  it("parses nested resource commands and compound shell commands", () => {
    expect(
      parseManagedIntegrationCliCommand(
        'python -c "print(1)" && hubspot contacts create --json "{}"',
      ),
    ).toMatchObject({
      integrationType: "hubspot",
      operationKey: "contacts.create",
      accessHint: "write",
    });
    expect(
      parseManagedIntegrationCliCommand("outlook-mail contacts list --limit 25"),
    ).toMatchObject({
      integrationType: "outlook",
      operationKey: "contacts.list",
      accessHint: "read",
    });
    expect(parseManagedIntegrationCliCommand("dynamics rows delete account 1")).toMatchObject({
      integrationType: "dynamics",
      operationKey: "rows.delete",
      accessHint: "write",
    });
  });

  it("cannot be bypassed with shell wrappers, absolute CLI paths, or direct skill entrypoints", () => {
    expect(parseManagedIntegrationCliCommand("env FOO=bar google-gmail send")).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "send",
    });
    expect(
      parseManagedIntegrationCliCommand("/usr/local/bin/salesforce create Lead '{}'"),
    ).toMatchObject({
      integrationType: "salesforce",
      operationKey: "create",
    });
    expect(parseManagedIntegrationCliCommand("sudo -- google-drive delete file-1")).toMatchObject({
      integrationType: "google_drive",
      operationKey: "delete",
    });
    expect(
      parseManagedIntegrationCliCommand(
        "tsx /app/.claude/skills/salesforce/src/salesforce.ts create Lead '{}'",
      ),
    ).toMatchObject({
      integrationType: "salesforce",
      operationKey: "create",
    });
    expect(
      parseManagedIntegrationCliCommand(
        "bun run /app/.claude/skills/google-gmail/src/google-gmail.ts send --to a@example.com",
      ),
    ).toMatchObject({
      integrationType: "google_gmail",
      operationKey: "send",
    });
  });

  it("returns every managed operation in a compound shell command", () => {
    expect(
      parseManagedIntegrationCliCommands("google-gmail send --to a@example.com; google-gmail list"),
    ).toMatchObject([
      { integrationType: "google_gmail", operationKey: "send" },
      { integrationType: "google_gmail", operationKey: "list" },
    ]);
  });

  it("keeps unknown operations visible with a stable key and conservative metadata fallback", () => {
    expect(parseManagedIntegrationCliCommand("salesforce future-operation")).toEqual({
      integrationType: "salesforce",
      operationKey: "future-operation",
      integrationDisplayName: "Salesforce",
      operationLabel: "future-operation",
      accessHint: "read",
    });
    expect(getManagedOperationDescriptor("salesforce", "future-operation")).toBeNull();
  });

  it("does not treat Bap, Coworker, browser, or arbitrary shell commands as managed integrations", () => {
    expect(parseManagedIntegrationCliCommand("coworker run cw-1")).toBeNull();
    expect(parseManagedIntegrationCliCommand("agent-browser open https://example.com")).toBeNull();
    expect(parseManagedIntegrationCliCommand("git status")).toBeNull();
    expect(resolveManagedMcpTool("coworker.save")).toBeNull();
    expect(resolveManagedMcpTool("workspaceMember.remove")).toBeNull();
  });
});
