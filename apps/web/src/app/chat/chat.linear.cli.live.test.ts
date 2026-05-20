import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  liveEnabled,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

const linearExecutorTimeoutMs = 60_000;
const linearPrompt = "whats' the description of my linear issue BAP-310";
const linearModel = "openai/gpt-5.4-mini";

describe.runIf(liveEnabled)("@live CLI chat linear", () => {
  beforeAll(async () => {
    await ensureCliAuth();
  });

  test(
    "reads issue BAP-310 through executor within 60 seconds",
    { timeout: linearExecutorTimeoutMs + 10_000 },
    async () => {
      const result = await runChatMessage({
        message: linearPrompt,
        model: linearModel,
        timeoutMs: linearExecutorTimeoutMs,
      });

      assertExitOk(result, "chat linear issue description");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).toContain("[tool_use] executor_execute");
      expect(result.stdout).toMatch(/"sourceId":\s*"linear"/);
      expect(result.stdout).toContain("Linear MCP");
      expect(result.stdout).toMatch(/"toolCount":\s*(?:[1-9]\d*)/);
      expect(result.stdout).toContain("BAP-310");
      expect(result.stdout).toContain("e2e test for executor");
      expect(result.stdout).toContain("test-1234");
      expect(result.stdout).toContain("Done");
    },
  );
});
