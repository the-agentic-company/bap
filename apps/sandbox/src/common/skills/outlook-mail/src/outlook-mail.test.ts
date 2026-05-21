import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

const OUTLOOK_MAIL_CLI = "sandbox/src/common/skills/outlook-mail/src/outlook-mail.ts";

describe("outlook-mail CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["--help"], {
      OUTLOOK_ACCESS_TOKEN: "",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["--help"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Outlook Mail CLI - Commands");
    expect(result.stdout).toContain("--account <label>");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("search -q <query>");
    expect(result.stdout).toContain("unread");
    expect(result.stdout).toContain("contact -q <query>");
    expect(result.stdout).toContain("contacts list [-l limit] [--cursor <cursor>] [--all]");
    expect(result.stdout).toContain(
      "draft --to <email> --subject <subject> --body <body> [--cc <email>] [--attachment <path>]...",
    );
  });

  test("fails for invalid limit value", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["list", "--limit", "0"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid --limit");
  });

  test("accepts account label option", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["--account", "work", "list"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
      CMDCLAW_AVAILABLE_ACCOUNT_LABELS: "personal, work",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("--account requires CMDCLAW_RUNTIME_CREDENTIALS_URL");
    expect(result.combined).toContain("Available account labels: personal, work");
  });

  test("rejects queries on list", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["list", "--query", "invoice"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("outlook-mail list does not accept --query");
    expect(result.combined).toContain("Use outlook-mail search instead");
  });

  test("requires a query for search", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["search"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Required: outlook-mail search --query <search>");
  });

  test("requires a query for contact lookup", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["contact"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Required: outlook-mail contact --query <name-or-email>");
  });

  test("requires the contacts list subcommand", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["contacts"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Required: outlook-mail contacts list");
  });

  test("rejects invalid contacts cursor before making a request", () => {
    const result = runSkillCli(OUTLOOK_MAIL_CLI, ["contacts", "list", "--cursor", "not-a-cursor"], {
      OUTLOOK_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid --cursor");
  });

  test("fails send when body contains unsupported html tags", () => {
    const result = runSkillCli(
      OUTLOOK_MAIL_CLI,
      ["send", "--to", "user@example.com", "--subject", "Hello", "--body", "<div>hello</div>"],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid email body HTML: unsupported tag <div>");
    expect(result.combined).toContain("Allowed tags: b,strong,s,i,em,u,br,p,table");
  });

  test("fails draft when body contains unsupported html tags", () => {
    const result = runSkillCli(
      OUTLOOK_MAIL_CLI,
      ["draft", "--to", "user@example.com", "--subject", "Hello", "--body", "<script>x</script>"],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid email body HTML: script/style tags are not allowed");
    expect(result.combined).toContain("Allowed tags: b,strong,s,i,em,u,br,p,table");
  });

  test("fails send when an attachment file cannot be read", () => {
    const result = runSkillCli(
      OUTLOOK_MAIL_CLI,
      [
        "send",
        "--to",
        "user@example.com",
        "--subject",
        "Hello",
        "--body",
        "<p>Hello</p>",
        "--attachment",
        "/tmp/does-not-exist.pdf",
      ],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain('Failed to read attachment "/tmp/does-not-exist.pdf"');
  });

  test("fails draft when an attachment file cannot be read", () => {
    const result = runSkillCli(
      OUTLOOK_MAIL_CLI,
      [
        "draft",
        "--to",
        "user@example.com",
        "--subject",
        "Hello",
        "--body",
        "<p>Hello</p>",
        "--attachment",
        "/tmp/does-not-exist.pdf",
      ],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain('Failed to read attachment "/tmp/does-not-exist.pdf"');
  });

  test("uses html content type and graph file attachments in payloads", () => {
    const source = readFileSync(new URL("./outlook-mail.ts", import.meta.url), "utf8");
    expect(source).toContain('contentType: "HTML"');
    expect(source).toContain('"#microsoft.graph.fileAttachment"');
    expect(source).toContain("/me/people");
    expect(source).toContain("/me/contacts");
    expect(source).toContain('"@odata.nextLink"');
    expect(source).toContain('case "draft"');
  });
});
