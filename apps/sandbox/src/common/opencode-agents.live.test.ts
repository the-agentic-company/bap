import {
  CMDCLAW_CHAT_AGENT_ID,
  CMDCLAW_COWORKER_BUILDER_AGENT_ID,
  CMDCLAW_COWORKER_RUNNER_AGENT_ID,
} from "../../../../packages/core/src/server/prompts/opencode-agent-ids";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Sandbox } from "e2b";
import { beforeAll, describe, expect, test } from "vitest";
import { liveEnabled } from "../../../web/tests/e2e-cli/live-fixtures";

const templateName = process.env.E2B_SANDBOX_TEMPLATE_NAME || "bap-agent-dev";
const liveSandboxAgentsEnabled = liveEnabled && Boolean(process.env.E2B_API_KEY);
const sandboxTimeoutMs = 15 * 60 * 1000;
const opencodePort = 4096;

async function waitForHealth(url: string): Promise<void> {
  const timeoutMs = 30_000;
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for OpenCode health at ${url}/health`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    await poll();
  }

  await poll();
}

describe.runIf(liveSandboxAgentsEnabled)("@live OpenCode agents", () => {
  beforeAll(() => {
    process.env.E2E_LIVE = "1";
  });

  test(
    "loads custom agents from sandbox assets and accepts an explicit agent on prompt",
    { timeout: 180_000 },
    async () => {
      const sandbox = await Sandbox.create(templateName, {
        timeoutMs: sandboxTimeoutMs,
      });

      try {
        const baseUrl = `https://${sandbox.getHost(opencodePort)}`;
        await waitForHealth(baseUrl);

        const client = createOpencodeClient({ baseUrl });
        const listed = await client.app.agents({});
        expect(listed.error).toBeFalsy();

        const agents = listed.data ?? [];
        const chat = agents.find((agent) => agent.name === CMDCLAW_CHAT_AGENT_ID);
        const builder = agents.find((agent) => agent.name === CMDCLAW_COWORKER_BUILDER_AGENT_ID);
        const runner = agents.find((agent) => agent.name === CMDCLAW_COWORKER_RUNNER_AGENT_ID);

        expect(chat?.mode).toBe("primary");
        expect(chat?.prompt).toContain("When drafting or sending email bodies");
        expect(builder?.mode).toBe("primary");
        expect(builder?.prompt).toContain("You are CmdClaw's coworker builder agent.");
        expect(runner?.mode).toBe("primary");
        expect(runner?.prompt).toContain("You are CmdClaw's coworker runner agent.");
        expect(runner?.prompt).toContain("without asking clarifying questions.");

        const created = await client.session.create({ title: "Agent smoke" });
        expect(created.error).toBeFalsy();
        expect(created.data?.id).toBeTruthy();

        const promptResult = await client.session.prompt({
          sessionID: created.data!.id,
          agent: CMDCLAW_CHAT_AGENT_ID,
          model: {
            providerID: "opencode",
            modelID: "glm-5-free",
          },
          parts: [{ type: "text", text: "Reply with exactly READY." }],
        });
        expect(promptResult.error).toBeFalsy();
      } finally {
        await sandbox.kill();
      }
    },
  );
});
