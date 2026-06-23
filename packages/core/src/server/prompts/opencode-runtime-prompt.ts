import {
  BAP_CHAT_AGENT_ID,
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
  buildCoworkerBuilderRuntimeSection,
  buildCoworkerExecutionSection,
  buildSelectedPlatformSkillSection,
  buildUserTimezoneSection,
  getBaseSystemPrompt,
  getCoworkerCliSystemPrompt,
  getFileSharingSection,
  getIntegrationSkillDraftSection,
  getNativeMcpSection,
} from "@bap/prompts";
import type { CoworkerBuilderContext } from "../services/coworker-builder-service";

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

function composeChatPrompt(input: ChatPromptInput): ResolvedPromptSpec {
  const sections: ResolvedPromptSection[] = [];

  appendSection(sections, "base_system", getBaseSystemPrompt());
  appendSection(sections, "file_sharing", getFileSharingSection());
  appendSection(sections, "native_mcp", getNativeMcpSection());
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
  appendSection(sections, "integration_skill_drafts", getIntegrationSkillDraftSection());
  appendSection(sections, "memory", input.memoryInstructions);

  return finalizePrompt(BAP_CHAT_AGENT_ID, sections);
}

function composeCoworkerBuilderPrompt(input: CoworkerBuilderPromptInput): ResolvedPromptSpec {
  const sections: ResolvedPromptSection[] = [];

  appendSection(sections, "base_system", getBaseSystemPrompt());
  appendSection(sections, "file_sharing", getFileSharingSection());
  appendSection(sections, "native_mcp", getNativeMcpSection());
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

  appendSection(sections, "base_system", getBaseSystemPrompt());
  appendSection(sections, "file_sharing", getFileSharingSection());
  appendSection(sections, "native_mcp", getNativeMcpSection());
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
