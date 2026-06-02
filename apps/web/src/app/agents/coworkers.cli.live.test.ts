import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  commandTimeoutMs,
  ensureCliAuth,
  liveEnabled,
  requireMatch,
  responseTimeoutMs,
  runBunCommand,
} from "../../../tests/e2e-cli/live-fixtures";

describe.runIf(liveEnabled)("@live CLI coworkers", () => {
  beforeAll(async () => {
    await ensureCliAuth();
  });

  test(
    "creates manual coworker, runs it, and gets a non-error answer",
    { timeout: Math.max(responseTimeoutMs + 120_000, 300_000) },
    async () => {
      const coworkerInstruction = process.env.E2E_COWORKER_PROMPT ?? "say hi";
      const marker = `cli-coworker-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const name = `CLI Live ${marker}`;
      const prompt = `${coworkerInstruction}\nInclude this token somewhere in your final answer: ${marker}`;

      const created = await runBunCommand([
        "run",
        "cmdclaw",
        "--",
        "coworker",
        "create",
        "--name",
        name,
        "--trigger",
        "manual",
        "--prompt",
        prompt,
        "--auto-approve",
      ]);

      assertExitOk(created, "coworker create");
      const coworkerId = requireMatch(created.stdout, /id:\s+([^\s]+)/, created.stdout);

      const triggered = await runBunCommand([
        "run",
        "cmdclaw",
        "--",
        "coworker",
        "run",
        coworkerId,
        "--payload",
        '{"source":"cli-live-test"}',
      ]);

      assertExitOk(triggered, "coworker run");
      const runId = requireMatch(triggered.stdout, /run id:\s+([^\s]+)/, triggered.stdout);

      const logs = await runBunCommand(
        ["run", "cmdclaw", "--", "coworker", "logs", runId, "--watch", "--watch-interval", "2"],
        Math.max(responseTimeoutMs, commandTimeoutMs),
      );

      assertExitOk(logs, "coworker logs");
      expect(logs.stdout).toContain(`Run ${runId}`);
      expect(logs.stdout).not.toContain("Error:");
      expect(logs.stdout).not.toContain("[ERROR]");
    },
  );
});
