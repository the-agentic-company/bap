import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  extractConversationId,
  getCliClient,
  liveEnabled,
  readLatestAssistantMessage,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "./live-fixtures";

let liveModel = "";

type CoworkerLike = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

function isBapCoworkerListToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return /(^|_)bap(_mcp)?_coworker_list$/.test(normalized);
}

function extractStdoutToolNames(output: string): string[] {
  return [...output.matchAll(/^\[tool_use\]\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
}

function extractContentPartToolNames(contentParts: unknown): string[] {
  if (!Array.isArray(contentParts)) {
    return [];
  }

  return contentParts
    .filter(isRecord)
    .filter((part) => part.type === "tool_use" && typeof part.name === "string")
    .map((part) => part.name as string);
}

function coworkerMatchKeys(coworker: CoworkerLike): string[] {
  const values = [coworker.username, coworker.name, coworker.id]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return values.map((value) => value.toLowerCase());
}

function countMentionedExpectedCoworkers(text: string, coworkers: CoworkerLike[]): number {
  const normalizedText = text.toLowerCase();
  return coworkers.filter((coworker) =>
    coworkerMatchKeys(coworker).some((key) => normalizedText.includes(key)),
  ).length;
}

function buildBapCoworkerPrompt(): string {
  return [
    "List my coworkers using only the Bap MCP.",
    "Call the Bap MCP coworker.list tool with empty input.",
    "Do not use bash, read, task, executor_execute, browser tools, or the coworker CLI.",
    "Return exactly COWORKERS_FOUND=YES followed by at least two coworker names or usernames.",
  ].join("\n");
}

describe.runIf(liveEnabled)("@live CLI chat Bap MCP", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "lists multiple coworkers through the Bap MCP",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const expectedCoworkers = await getCliClient().coworker.list();
      expect(expectedCoworkers.length).toBeGreaterThan(1);

      const result = await runChatMessage({
        message: buildBapCoworkerPrompt(),
        model: liveModel,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat Bap MCP coworker list");
      expect(result.stdout).toContain("[tool_use]");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).not.toContain("executor_execute");

      const conversationId = extractConversationId(result.stdout);
      const latest = await readLatestAssistantMessage(conversationId);
      if (!latest) {
        throw new Error(`No assistant message persisted for conversation ${conversationId}`);
      }

      const toolNames = [
        ...extractStdoutToolNames(result.stdout),
        ...extractContentPartToolNames(latest.contentParts),
      ];
      expect(toolNames.some(isBapCoworkerListToolName)).toBe(true);
      expect(toolNames.filter((toolName) => !isBapCoworkerListToolName(toolName))).toEqual([]);
      expect(latest.content).toContain("COWORKERS_FOUND=YES");
      expect(
        countMentionedExpectedCoworkers(latest.content, expectedCoworkers as CoworkerLike[]),
      ).toBeGreaterThanOrEqual(2);
    },
  );
});
