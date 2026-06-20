import { getCoworkerCliSystemPrompt } from "../../lib/coworker-runtime-cli";
import type { CoworkerBuilderContext } from "../services/coworker-builder-service";
import {
  BAP_CHAT_AGENT_ID,
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
} from "./opencode-agent-ids";

export type ResolvedPromptSection = {
  key: string;
  content: string;
};

export type ResolvedPromptSpec = {
  agentId: string;
  systemPrompt: string;
  sections: ResolvedPromptSection[];
};

type SharedPromptInput = {
  cliInstructions?: string | null;
  skillsInstructions?: string | null;
  integrationSkillsInstructions?: string | null;
  memoryInstructions?: string | null;
  selectedPlatformSkillSlugs?: string[];
  userTimezone?: string | null;
};

type ChatPromptInput = SharedPromptInput & {
  kind: "chat";
};

type CoworkerBuilderPromptInput = SharedPromptInput & {
  kind: "coworker_builder";
  builderCoworkerContext: CoworkerBuilderContext;
};

type CoworkerRunnerPromptInput = SharedPromptInput & {
  kind: "coworker_runner";
  coworkerPrompt?: string | null;
  triggerPayload?: unknown;
};

export type OpencodePromptCompositionInput =
  | ChatPromptInput
  | CoworkerBuilderPromptInput
  | CoworkerRunnerPromptInput;

const BASE_SYSTEM_PROMPT = "You are Bap, an AI agent that helps do work.";

const FILE_SHARING_SECTION = [
  "## File Sharing",
  "When you create files that the user needs (PDFs, images, documents, code files, etc.), ",
  "save them to /app or /home/user. Files created during your response will automatically ",
  "be made available for download in the chat interface.",
].join("");

const NATIVE_MCP_SECTION = [
  "## Connected MCP Servers",
  "OpenCode exposes connected MCP servers as native tools when they are configured for this chat.",
  "For requests about external systems, try the relevant MCP tool before saying the system is unavailable.",
  "Do not require a local SKILL.md file for MCP-backed services; the OpenCode MCP tool itself is the source of truth.",
  "If no relevant MCP tool is available, or if OpenCode reports that it is not connected or needs authentication, explain that plainly.",
].join("\n");

function appendSection(
  sections: ResolvedPromptSection[],
  key: string,
  content: string | null | undefined,
): void {
  const trimmed = content?.trim();
  if (!trimmed) {
    return;
  }

  sections.push({
    key,
    content: trimmed,
  });
}

function finalizePrompt(agentId: string, sections: ResolvedPromptSection[]): ResolvedPromptSpec {
  return {
    agentId,
    systemPrompt: sections.map((section) => section.content).join("\n\n"),
    sections,
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildSelectedPlatformSkillSection(
  selectedPlatformSkillSlugs: string[] | undefined,
): string | null {
  if (!selectedPlatformSkillSlugs || selectedPlatformSkillSlugs.length === 0) {
    return null;
  }

  const list = selectedPlatformSkillSlugs.map((slug) => `- ${slug}`).join("\n");
  const paths = selectedPlatformSkillSlugs
    .map((slug) => `- /app/.claude/skills/${slug}/SKILL.md`)
    .join("\n");
  return [
    "# Selected Platform Skills",
    "The user selected these platform skills for this generation:",
    list,
    "Prioritize these selected skills before using other platform skills.",
    "Read and follow these SKILL.md files first:",
    paths,
  ].join("\n");
}

function buildIntegrationSkillDraftSection(): string {
  return [
    "## Creating Integration Skills",
    "To create a new integration skill via chat, write a JSON draft file in:",
    "/app/.opencode/integration-skill-drafts/<slug>.json",
    "The server imports drafts automatically when generation completes.",
    "Draft schema:",
    "{",
    '  "slug": "integration-slug",',
    '  "title": "Skill title",',
    '  "description": "When and why to use this skill",',
    '  "setAsPreferred": true,',
    '  "files": [{"path":"SKILL.md","content":"..."}]',
    "}",
  ].join("\n");
}

function buildUserTimezoneSection(userTimezone: string | null | undefined): string | null {
  const trimmed = userTimezone?.trim();
  if (!trimmed) {
    return null;
  }

  return [
    "## User Timezone",
    `The user's saved IANA timezone is \`${trimmed}\`.`,
    "Use it as the default timezone for relative dates, times, and schedules unless the user explicitly overrides it.",
    "Do not ask for the user's timezone if this saved timezone is sufficient.",
  ].join("\n");
}

function buildCoworkerExecutionSection(input: CoworkerRunnerPromptInput): string | null {
  const sections = [
    input.coworkerPrompt ? `## Coworker Instructions\n${input.coworkerPrompt}` : null,
    input.triggerPayload !== undefined
      ? `## Trigger Payload\n${JSON.stringify(input.triggerPayload, null, 2)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n\n");
}

function buildCoworkerBuilderRuntimeSection(
  builderCoworkerContext: CoworkerBuilderContext,
): string {
  const snapshot = JSON.stringify(
    {
      coworkerId: builderCoworkerContext.coworkerId,
      updatedAt: builderCoworkerContext.updatedAt,
      editable: {
        prompt: builderCoworkerContext.prompt,
        model: builderCoworkerContext.model,
        toolAccessMode: builderCoworkerContext.toolAccessMode,
        triggerType: builderCoworkerContext.triggerType,
        schedule: builderCoworkerContext.schedule,
        allowedIntegrations: builderCoworkerContext.allowedIntegrations,
        requiresUserInput: builderCoworkerContext.requiresUserInput,
        userInputPrompt: builderCoworkerContext.userInputPrompt,
      },
    },
    null,
    2,
  );

  return [
    "## Coworker Builder Runtime Context",
    "This is the latest server snapshot for the coworker you are editing.",
    "The coworker already exists as a builder placeholder. Your job is to configure this exact coworker, not create a new one.",
    "Do not call coworker creation tools or choose another coworker from coworker list output for this request.",
    "Use the exact coworkerId and updatedAt from this snapshot when you run coworker edit.",
    "Before editing, write the changed fields to a JSON file and pass it with --changes-file.",
    "You may set requiresUserInput and userInputPrompt when the coworker should ask the user for a first free-text reply before it starts running.",
    "If requiresUserInput is true, userInputPrompt must be a specific coworker-authored question for the missing context.",
    "Current edit command:",
    `coworker edit ${builderCoworkerContext.coworkerId} --base-updated-at ${quoteShellArg(builderCoworkerContext.updatedAt)} --changes-file /tmp/coworker-edit.json --json`,
    "Snapshot:",
    snapshot,
  ].join("\n");
}

function composeChatPrompt(input: ChatPromptInput): ResolvedPromptSpec {
  const sections: ResolvedPromptSection[] = [];

  appendSection(sections, "base_system", BASE_SYSTEM_PROMPT);
  appendSection(sections, "file_sharing", FILE_SHARING_SECTION);
  appendSection(sections, "native_mcp", NATIVE_MCP_SECTION);
  appendSection(sections, "user_timezone", buildUserTimezoneSection(input.userTimezone));
  appendSection(sections, "cli", input.cliInstructions);
  appendSection(sections, "coworker_cli", getCoworkerCliSystemPrompt());
  appendSection(sections, "skills", input.skillsInstructions);
  appendSection(
    sections,
    "selected_platform_skills",
    buildSelectedPlatformSkillSection(input.selectedPlatformSkillSlugs),
  );
  appendSection(sections, "integration_skills", input.integrationSkillsInstructions);
  appendSection(sections, "integration_skill_drafts", buildIntegrationSkillDraftSection());
  appendSection(sections, "memory", input.memoryInstructions);

  return finalizePrompt(BAP_CHAT_AGENT_ID, sections);
}

function composeCoworkerBuilderPrompt(input: CoworkerBuilderPromptInput): ResolvedPromptSpec {
  const sections: ResolvedPromptSection[] = [];

  appendSection(sections, "base_system", BASE_SYSTEM_PROMPT);
  appendSection(sections, "file_sharing", FILE_SHARING_SECTION);
  appendSection(sections, "native_mcp", NATIVE_MCP_SECTION);
  appendSection(sections, "user_timezone", buildUserTimezoneSection(input.userTimezone));
  appendSection(sections, "cli", input.cliInstructions);
  appendSection(sections, "coworker_cli", getCoworkerCliSystemPrompt());
  appendSection(sections, "skills", input.skillsInstructions);
  appendSection(
    sections,
    "selected_platform_skills",
    buildSelectedPlatformSkillSection(input.selectedPlatformSkillSlugs),
  );
  appendSection(sections, "integration_skills", input.integrationSkillsInstructions);
  appendSection(sections, "memory", input.memoryInstructions);
  appendSection(
    sections,
    "coworker_builder_runtime",
    buildCoworkerBuilderRuntimeSection(input.builderCoworkerContext),
  );

  return finalizePrompt(BAP_COWORKER_BUILDER_AGENT_ID, sections);
}

function composeCoworkerRunnerPrompt(input: CoworkerRunnerPromptInput): ResolvedPromptSpec {
  const sections: ResolvedPromptSection[] = [];

  appendSection(sections, "base_system", BASE_SYSTEM_PROMPT);
  appendSection(sections, "file_sharing", FILE_SHARING_SECTION);
  appendSection(sections, "native_mcp", NATIVE_MCP_SECTION);
  appendSection(sections, "user_timezone", buildUserTimezoneSection(input.userTimezone));
  appendSection(sections, "cli", input.cliInstructions);
  appendSection(sections, "skills", input.skillsInstructions);
  appendSection(
    sections,
    "selected_platform_skills",
    buildSelectedPlatformSkillSection(input.selectedPlatformSkillSlugs),
  );
  appendSection(sections, "integration_skills", input.integrationSkillsInstructions);
  appendSection(sections, "memory", input.memoryInstructions);
  appendSection(sections, "coworker_execution", buildCoworkerExecutionSection(input));

  return finalizePrompt(BAP_COWORKER_RUNNER_AGENT_ID, sections);
}

export function composeOpencodePromptSpec(
  input: OpencodePromptCompositionInput,
): ResolvedPromptSpec {
  switch (input.kind) {
    case "chat":
      return composeChatPrompt(input);
    case "coworker_builder":
      return composeCoworkerBuilderPrompt(input);
    case "coworker_runner":
      return composeCoworkerRunnerPrompt(input);
    default: {
      const exhaustive: never = input;
      throw new Error(`Unhandled prompt composition input: ${JSON.stringify(exhaustive)}`);
    }
  }
}
