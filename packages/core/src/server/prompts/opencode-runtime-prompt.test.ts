import { describe, expect, it } from "vitest";
import type { CoworkerBuilderContext } from "../services/coworker-builder-service";
import {
  BAP_CHAT_AGENT_ID,
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
} from "./opencode-agent-ids";
import { composeOpencodePromptSpec } from "./opencode-runtime-prompt";

const builderContext: CoworkerBuilderContext = {
  coworkerId: "cw-1",
  updatedAt: "2026-03-03T12:00:00.000Z",
  prompt: "Current prompt",
  model: "anthropic/claude-sonnet-4-6",
  toolAccessMode: "selected",
  triggerType: "manual",
  schedule: null,
  allowedIntegrations: ["github"],
};

describe("composeOpencodePromptSpec", () => {
  it("returns the chat agent id and expected runtime sections", () => {
    const result = composeOpencodePromptSpec({
      kind: "chat",
      cliInstructions: "CLI instructions",
      skillsInstructions: "Skills instructions",
      integrationSkillsInstructions: "Integration skills instructions",
      memoryInstructions: "Memory instructions",
      selectedPlatformSkillSlugs: ["calendar", "gmail"],
      userTimezone: "Europe/Dublin",
    });

    expect(result.agentId).toBe(BAP_CHAT_AGENT_ID);
    expect(result.sections.map((section) => section.key)).toEqual([
      "base_system",
      "file_sharing",
      "native_mcp",
      "user_timezone",
      "cli",
      "coworker_cli",
      "skills",
      "selected_platform_skills",
      "integration_skills",
      "integration_skill_drafts",
      "memory",
    ]);
    expect(result.systemPrompt).toContain("## File Sharing");
    expect(result.systemPrompt).toContain("## Connected MCP Servers");
    expect(result.systemPrompt).toContain("try the relevant MCP tool");
    expect(result.systemPrompt).toContain("## User Timezone");
    expect(result.systemPrompt).toContain("Europe/Dublin");
    expect(result.systemPrompt).toContain("CLI instructions");
    expect(result.systemPrompt).not.toContain("Executor instructions");
    expect(result.systemPrompt).toContain("# Selected Platform Skills");
    expect(result.systemPrompt).toContain("/app/.opencode/integration-skill-drafts/<slug>.json");
  });

  it("returns the builder agent id and only runtime-specific builder context", () => {
    const result = composeOpencodePromptSpec({
      kind: "coworker_builder",
      builderCoworkerContext: builderContext,
      cliInstructions: "CLI instructions",
      userTimezone: "America/New_York",
    });

    expect(result.agentId).toBe(BAP_COWORKER_BUILDER_AGENT_ID);
    expect(result.sections.map((section) => section.key)).toContain("user_timezone");
    expect(result.systemPrompt).toContain("America/New_York");
    expect(result.sections.map((section) => section.key)).toContain("coworker_builder_runtime");
    expect(result.systemPrompt).toContain("## Coworker Builder Runtime Context");
    expect(result.systemPrompt).toContain('"coworkerId": "cw-1"');
    expect(result.systemPrompt).toContain("--base-updated-at '2026-03-03T12:00:00.000Z'");
    expect(result.systemPrompt).toContain("coworker edit cw-1");
    expect(result.systemPrompt).toContain(
      "The coworker already exists as a builder placeholder.",
    );
    expect(result.systemPrompt).toContain("Do not call coworker creation tools");
    expect(result.systemPrompt).not.toContain("Never run `coworker edit` on your first response");
    expect(result.systemPrompt).not.toContain("Question round first");
    expect(result.systemPrompt).not.toContain("If information is missing, apply a best-effort default edit first");
  });

  it("returns the runner agent id and coworker execution sections", () => {
    const result = composeOpencodePromptSpec({
      kind: "coworker_runner",
      coworkerPrompt: "Fetch unread emails and summarize them.",
      triggerPayload: { source: "schedule" },
      memoryInstructions: "Memory instructions",
      userTimezone: "Asia/Tokyo",
    });

    expect(result.agentId).toBe(BAP_COWORKER_RUNNER_AGENT_ID);
    expect(result.sections.map((section) => section.key)).toContain("user_timezone");
    expect(result.systemPrompt).toContain("Asia/Tokyo");
    expect(result.sections.map((section) => section.key)).toContain("coworker_execution");
    expect(result.systemPrompt).toContain("## Coworker Instructions");
    expect(result.systemPrompt).not.toContain("\n## Do\n");
    expect(result.systemPrompt).not.toContain("\n## Don't\n");
    expect(result.systemPrompt).toContain("## Trigger Payload");
  });

  it("omits empty optional sections cleanly", () => {
    const result = composeOpencodePromptSpec({
      kind: "chat",
      cliInstructions: "   ",
      skillsInstructions: "",
      integrationSkillsInstructions: null,
      memoryInstructions: undefined,
      selectedPlatformSkillSlugs: [],
    });

    expect(result.sections.map((section) => section.key)).toEqual([
      "base_system",
      "file_sharing",
      "native_mcp",
      "coworker_cli",
      "integration_skill_drafts",
    ]);
    expect(result.systemPrompt).not.toContain("Selected Platform Skills");
    expect(result.systemPrompt).not.toContain("Skills instructions");
    expect(result.systemPrompt).not.toContain("User Timezone");
  });
});
