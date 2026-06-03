import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  callCliLiveTestingApi,
  ensureCliAuth,
  expectedUserEmail,
  liveEnabled,
  runChatMessage,
} from "./live-fixtures";

const linearMcpTimeoutMs = 90_000;
const linearPrompt = "whats' the description of my linear issue BAP-310? use linear";
const linearModel = "openai/gpt-5.4-mini";
let linearMcpCredentialBackup: unknown | null = null;

describe.runIf(liveEnabled)("@live CLI chat linear", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    const { backup } = await callCliLiveTestingApi<{ backup: unknown }>({
      action: "workspace-mcp:linear-api-key:apply",
      email: expectedUserEmail,
    });
    linearMcpCredentialBackup = backup;
  });

  afterAll(async () => {
    if (!linearMcpCredentialBackup) {
      return;
    }
    await callCliLiveTestingApi({
      action: "workspace-mcp:linear-api-key:restore",
      backup: linearMcpCredentialBackup,
    });
    linearMcpCredentialBackup = null;
  });

  test(
    "reads issue BAP-310 through native MCP within 90 seconds",
    { timeout: linearMcpTimeoutMs + 10_000 },
    async () => {
      const result = await runChatMessage({
        message: linearPrompt,
        model: linearModel,
        timeoutMs: linearMcpTimeoutMs,
      });

      assertExitOk(result, "chat linear issue description");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).toContain("[tool_use]");
      expect(result.stdout).not.toContain("executor_execute");
      expect(result.stdout).toContain("BAP-310");
      expect(result.stdout).toContain("test-1234");
      expect(result.stdout).toContain("Done");
    },
  );
});
