import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sandboxRoot = path.resolve(import.meta.dirname, "..");

describe("sandbox runtime package", () => {
  it.each(["daytona/image.ts", "e2b/template.ts"])(
    "packages the shared integration policy module in %s",
    async (relativePath) => {
      const source = await fs.readFile(path.join(sandboxRoot, "src", relativePath), "utf8");

      expect(source).toContain('"@bap/integration-policy": "file:./packages/integration-policy"');
      expect(source).toContain("/app/packages/integration-policy");
    },
  );

  it("enforces policy inside every credentialed managed integration entrypoint", async () => {
    const entrypoints = [
      "airtable/src/airtable.ts",
      "dynamics/src/dynamics.ts",
      "github/src/github.ts",
      "google-calendar/src/google-calendar.ts",
      "google-docs/src/google-docs.ts",
      "google-drive/src/google-drive.ts",
      "google-gmail/src/google-gmail.ts",
      "google-sheets/src/google-sheets.ts",
      "hubspot/src/hubspot.ts",
      "linkedin/src/linkedin.ts",
      "notion/src/notion.ts",
      "outlook-calendar/src/outlook-calendar.ts",
      "outlook-mail/src/outlook-mail.ts",
      "salesforce/src/salesforce.ts",
      "slack/src/slack.ts",
    ];

    for (const entrypoint of entrypoints) {
      const source = await fs.readFile(
        path.join(sandboxRoot, "src/common/skills", entrypoint),
        "utf8",
      );
      expect(source, entrypoint).toContain("enforceWorkspaceIntegrationPolicyForCli");
      expect(source, entrypoint).toMatch(/enforceWorkspaceIntegrationPolicyForCli\("[a-z-]+"\)/);
    }
  });
});
