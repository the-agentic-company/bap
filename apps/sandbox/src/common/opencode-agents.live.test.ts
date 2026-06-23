import {
  BAP_CHAT_AGENT_ID,
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
} from "@bap/prompts";
import { Daytona } from "@daytonaio/sdk";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { beforeAll, describe, expect, test } from "vitest";
import { liveEnabled } from "../../../web/tests/e2e-cli/live-fixtures";

const snapshotName =
  process.env.E2B_DAYTONA_SANDBOX_NAME ||
  process.env.DAYTONA_SNAPSHOT ||
  process.env.DAYTONA_SNAPSHOT_DEV ||
  "bap-agent-dev";
const liveSandboxAgentsEnabled =
  liveEnabled &&
  (Boolean(process.env.DAYTONA_API_KEY) ||
    (Boolean(process.env.DAYTONA_JWT_TOKEN) && Boolean(process.env.DAYTONA_ORGANIZATION_ID))) &&
  Boolean(process.env.OPENAI_API_KEY);
const sandboxTimeoutMs = 15 * 60 * 1000;
const opencodePort = 4096;
const daytonaConfig = {
  ...(process.env.DAYTONA_API_KEY ? { apiKey: process.env.DAYTONA_API_KEY } : {}),
  ...(process.env.DAYTONA_JWT_TOKEN ? { jwtToken: process.env.DAYTONA_JWT_TOKEN } : {}),
  ...(process.env.DAYTONA_ORGANIZATION_ID
    ? { organizationId: process.env.DAYTONA_ORGANIZATION_ID }
    : {}),
  ...(process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL
    ? { apiUrl: process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL }
    : {}),
  ...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
};

async function waitForHealth(url: string): Promise<void> {
  const timeoutMs = 30_000;
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL(url);
  healthUrl.pathname = `${healthUrl.pathname.replace(/\/$/, "")}/health`;

  async function poll(): Promise<void> {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for OpenCode health at ${healthUrl.toString()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    await poll();
  }

  await poll();
}

function appendDaytonaAuth(url: string, token?: string): string {
  if (!token) {
    return url;
  }

  const parsed = new URL(url);
  if (!parsed.searchParams.has("DAYTONA_SANDBOX_AUTH_KEY")) {
    parsed.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  }
  return parsed.toString();
}

describe.runIf(liveSandboxAgentsEnabled)("@live OpenCode agents", () => {
  beforeAll(() => {
    process.env.E2E_LIVE = "1";
  });

  test(
    "loads custom agents from sandbox assets",
    { timeout: 180_000 },
    async () => {
      const daytona = new Daytona(daytonaConfig);
      const sandbox = await daytona.create({
        snapshot: snapshotName,
        envVars: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        },
      });

      try {
        await sandbox.waitUntilStarted?.(Math.ceil(sandboxTimeoutMs / 1000));
        const preview = await sandbox.getPreviewLink(opencodePort);
        await waitForHealth(appendDaytonaAuth(preview.url, preview.token));

        const authedFetch = (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ): ReturnType<typeof fetch> => {
          if (input instanceof Request) {
            const authedUrl = appendDaytonaAuth(input.url, preview.token);
            return fetch(new Request(authedUrl, input), init);
          }

          return fetch(appendDaytonaAuth(String(input), preview.token), init);
        };

        const client = createOpencodeClient({
          baseUrl: preview.url,
          fetch: authedFetch as typeof fetch,
        });
        const listed = await client.app.agents({});
        expect(listed.error).toBeFalsy();

        const agents = listed.data ?? [];
        const chat = agents.find((agent) => agent.name === BAP_CHAT_AGENT_ID);
        const builder = agents.find((agent) => agent.name === BAP_COWORKER_BUILDER_AGENT_ID);
        const runner = agents.find((agent) => agent.name === BAP_COWORKER_RUNNER_AGENT_ID);

        expect(chat?.mode).toBe("primary");
        expect(chat?.prompt).toContain("When drafting or sending email bodies");
        expect(builder?.mode).toBe("primary");
        expect(builder?.prompt).toContain("You are Bap's coworker builder agent.");
        expect(runner?.mode).toBe("primary");
        expect(runner?.prompt).toContain("You are Bap's coworker runner agent.");
        expect(runner?.prompt).toContain("without asking clarifying questions.");

        const created = await client.session.create({ title: "Agent smoke" });
        expect(created.error).toBeFalsy();
        expect(created.data?.id).toBeTruthy();

        const promptResult = await client.session.prompt({
          sessionID: created.data!.id,
          agent: BAP_CHAT_AGENT_ID,
          model: {
            providerID: "openai",
            modelID: "gpt-5.4-mini",
          },
          parts: [{ type: "text", text: "Reply with exactly READY." }],
        });
        expect(promptResult.error).toBeFalsy();
      } finally {
        await sandbox.delete();
      }
    },
  );
});
