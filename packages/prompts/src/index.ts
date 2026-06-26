import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replacePlaceholders } from "./shared";

export {
  buildSelectedSkillInstructionBlock,
  buildTemplateInstructionsText,
  renderTemplateDeployPrompt,
} from "./browser";
export type { TemplateDeployPromptInput } from "./browser";

const SOURCE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = path.join(SOURCE_ROOT, "assets");
const assetCache = new Map<string, string>();

export const BAP_CHAT_AGENT_ID = "bap-chat";
export const BAP_COWORKER_BUILDER_AGENT_ID = "bap-coworker-builder";
export const BAP_COWORKER_RUNNER_AGENT_ID = "bap-coworker-runner";

export const OPENCODE_AGENT_DEFINITIONS_DIR = path.join(ASSET_ROOT, "opencode-agents");

function readAsset(...segments: string[]): string {
  const assetPath = path.join(ASSET_ROOT, ...segments);
  const cached = assetCache.get(assetPath);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(assetPath, "utf8");
  assetCache.set(assetPath, content);
  return content;
}

export function getPromptAssetPath(...segments: string[]): string {
  return path.join(ASSET_ROOT, ...segments);
}

export function getTemplateDeployPromptTemplate(): string {
  return readAsset("product", "template-deploy.md");
}

export function buildAuditIntegrationRecommenderPrompt(input: {
  profileContext: string;
  connectedIntegrations: string;
}): string {
  return renderPromptAsset(["product", "audit-integration-recommender.md"], {
    profile_context: input.profileContext,
    connected_integrations: input.connectedIntegrations,
  });
}

export function buildAuditCompanyProfilePrompt(input: { websiteContext: string }): string {
  return renderPromptAsset(["product", "audit-company-profile.md"], {
    website_context: input.websiteContext,
  });
}

export function buildAuditPersonProfilePrompt(input: { linkedinContext: string }): string {
  return renderPromptAsset(["product", "audit-person-profile.md"], {
    linkedin_context: input.linkedinContext,
  });
}

export function buildAuditAgentRecommenderPrompt(input: {
  profileContext: string;
  integrationRecommendations: string;
}): string {
  return renderPromptAsset(["product", "audit-agent-recommender.md"], {
    profile_context: input.profileContext,
    integration_recommendations: input.integrationRecommendations,
  });
}

export type AgenticAuditCoworkerDefinition = {
  key:
    | "company-brain"
    | "agentic-app-ideation"
    | "agentic-app-idea-1"
    | "agentic-app-idea-2"
    | "agentic-app-idea-3";
  name: string;
  username: string;
  description: string;
  prompt: string;
};

function getAuditCoworkerSharedContext(): string {
  return readAsset("product", "audit-coworker-shared-context.md").trim();
}

function buildAuditCoworkerPrompt(
  assetName: string,
  values: Record<string, string> = {},
): string {
  return renderPromptAsset(["product", assetName], {
    shared_audit_context: getAuditCoworkerSharedContext(),
    ...values,
  });
}

function buildAuditCoworkerIdeaPrompt(input: {
  ideaNumber: 1 | 2 | 3;
  theme: string;
  pageTitle: string;
}): string {
  return buildAuditCoworkerPrompt("audit-coworker-idea.md", {
    idea_number: String(input.ideaNumber),
    theme: input.theme,
    page_title: input.pageTitle,
  });
}

export function getAgenticAuditCoworkerDefinitions(): AgenticAuditCoworkerDefinition[] {
  return [
    {
      key: "company-brain",
      name: "company brain",
      username: "audit-company-brain",
      description: "Researches the person and company, then creates structured profiles.",
      prompt: buildAuditCoworkerPrompt("audit-coworker-company-brain.md"),
    },
    {
      key: "agentic-app-ideation",
      name: "agentic-app ideation",
      username: "audit-agentic-app-ideation",
      description: "Turns the research context into agentic workflow ideas.",
      prompt: buildAuditCoworkerPrompt("audit-coworker-ideation.md"),
    },
    {
      key: "agentic-app-idea-1",
      name: "agentic-app-idea-1",
      username: "audit-agentic-app-idea-1",
      description: "Builds the first agentic workflow concept page.",
      prompt: buildAuditCoworkerIdeaPrompt({
        ideaNumber: 1,
        theme: "lead research and outreach personalization",
        pageTitle: "Personalized Outreach Agent",
      }),
    },
    {
      key: "agentic-app-idea-2",
      name: "agentic-app-idea-2",
      username: "audit-agentic-app-idea-2",
      description: "Builds the second agentic workflow concept page.",
      prompt: buildAuditCoworkerIdeaPrompt({
        ideaNumber: 2,
        theme: "company operations and recurring work automation",
        pageTitle: "Operations Workflow Agent",
      }),
    },
    {
      key: "agentic-app-idea-3",
      name: "agentic-app-idea-3",
      username: "audit-agentic-app-idea-3",
      description: "Builds the third agentic workflow concept page.",
      prompt: buildAuditCoworkerIdeaPrompt({
        ideaNumber: 3,
        theme: "customer-facing intelligence and follow-up",
        pageTitle: "Customer Signal Agent",
      }),
    },
  ];
}

function renderPromptAsset(segments: string[], values: Record<string, string>): string {
  return replacePlaceholders(readAsset(...segments).trim(), values);
}

export function getBaseSystemPrompt(): string {
  return readAsset("opencode-runtime", "base-system.md").trim();
}

export function getFileSharingSection(): string {
  return readAsset("opencode-runtime", "file-sharing.md").trim();
}

export function getNativeMcpSection(): string {
  return readAsset("opencode-runtime", "native-mcp.md").trim();
}

export function getIntegrationSkillDraftSection(): string {
  return readAsset("opencode-runtime", "integration-skill-drafts.md").trim();
}

export function getCoworkerCliSystemPrompt(): string {
  return readAsset("opencode-runtime", "coworker-cli.md").trim();
}

export function buildSelectedPlatformSkillSection(
  selectedPlatformSkillSlugs: string[] | undefined,
): string | null {
  if (!selectedPlatformSkillSlugs || selectedPlatformSkillSlugs.length === 0) {
    return null;
  }

  const list = selectedPlatformSkillSlugs.map((slug) => `- ${slug}`).join("\n");
  const paths = selectedPlatformSkillSlugs
    .map((slug) => `- /app/.claude/skills/${slug}/SKILL.md`)
    .join("\n");
  return renderPromptAsset(["opencode-runtime", "selected-platform-skills.md"], {
    selected_skills: list,
    skill_paths: paths,
  });
}

export function buildUserTimezoneSection(userTimezone: string | null | undefined): string | null {
  const trimmed = userTimezone?.trim();
  if (!trimmed) {
    return null;
  }

  return renderPromptAsset(["opencode-runtime", "user-timezone.md"], {
    timezone: trimmed,
  });
}

export function buildCoworkerExecutionSection(input: {
  coworkerPrompt?: string | null;
  triggerPayload?: unknown;
}): string | null {
  const sections = [
    input.coworkerPrompt
      ? renderPromptAsset(["opencode-runtime", "coworker-instructions-section.md"], {
          coworker_prompt: input.coworkerPrompt,
        })
      : null,
    input.triggerPayload !== undefined
      ? renderPromptAsset(["opencode-runtime", "trigger-payload-section.md"], {
          trigger_payload: JSON.stringify(input.triggerPayload, null, 2),
        })
      : null,
  ].filter((value): value is string => Boolean(value));

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n\n");
}

export type CoworkerBuilderRuntimeContext = {
  coworkerId: string;
  updatedAt: string;
  prompt: string;
  model: string;
  toolAccessMode: string;
  triggerType: string;
  schedule: unknown;
  allowedIntegrations: string[];
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
};

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildCoworkerBuilderRuntimeSection(
  builderCoworkerContext: CoworkerBuilderRuntimeContext,
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

  return renderPromptAsset(["opencode-runtime", "coworker-builder-runtime.md"], {
    edit_command: `coworker edit ${builderCoworkerContext.coworkerId} --base-updated-at ${quoteShellArg(builderCoworkerContext.updatedAt)} --changes-file /tmp/coworker-edit.json --json`,
    snapshot,
  });
}

export type PromptIntegrationType =
  | "google_gmail"
  | "outlook"
  | "outlook_calendar"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "dynamics";

const INTEGRATION_TYPES: PromptIntegrationType[] = [
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
];

type AccountLabelsByType =
  | Map<string, string[]>
  | Partial<Record<PromptIntegrationType | string, string[]>>;

function getAccountLabels(
  labelsByType: AccountLabelsByType | undefined,
  type: PromptIntegrationType,
): string[] {
  if (!labelsByType) {
    return [];
  }
  if (labelsByType instanceof Map) {
    return labelsByType.get(type) ?? [];
  }
  return labelsByType[type] ?? [];
}

function accountLabelHint(
  labelsByType: AccountLabelsByType | undefined,
  type: PromptIntegrationType,
): string {
  const labels = getAccountLabels(labelsByType, type);
  if (labels.length === 0) {
    return "";
  }
  return `\n- Account Labels: ${labels.join(", ")}. Use --account <label> when selecting a Connected Account.`;
}

export function buildIntegrationCliInstructions(input: {
  connectedIntegrations: string[];
  labelsByType?: AccountLabelsByType;
  customIntegrations?: Array<{ name: string; cliInstructions: string }>;
}): string {
  const connected = new Set(input.connectedIntegrations);
  const statusTag = (type: PromptIntegrationType) =>
    connected.has(type) ? "✓ Connected" : "⚡ Auth Required";
  const values: Record<string, string> = {};
  for (const type of INTEGRATION_TYPES) {
    values[`${type}_status`] = statusTag(type);
    values[`${type}_account_label_hint`] = accountLabelHint(input.labelsByType, type);
  }

  const base = replacePlaceholders(
    readAsset("opencode-runtime", "integration-cli.md").trim(),
    values,
  );
  if (!input.customIntegrations || input.customIntegrations.length === 0) {
    return base;
  }

  const customSections = input.customIntegrations.map(
    (integration) =>
      renderPromptAsset(["opencode-runtime", "integration-cli-custom-section.md"], {
        name: integration.name,
        cli_instructions: integration.cliInstructions,
      }),
  );

  return base + "\n" + customSections.join("\n");
}

export function buildSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return renderPromptAsset(["opencode-runtime", "skills-system.md"], {
    skill_names: skillNames.map((name) => `- ${name}`).join("\n"),
  });
}

export function buildIntegrationSkillsSystemPrompt(skillSlugs: string[]): string {
  if (skillSlugs.length === 0) {
    return "";
  }

  return renderPromptAsset(["opencode-runtime", "integration-skills-system.md"], {
    skill_slugs: skillSlugs.map((slug) => `- ${slug}`).join("\n"),
  });
}

export type CustomSkillAgentSummary = {
  name: string;
  displayName: string;
  description: string;
};

export function buildCustomSkillsAgentsFile(skills: CustomSkillAgentSummary[]): string {
  const skillEntries = skills
    .map((skill) =>
      renderPromptAsset(["opencode-runtime", "custom-skills-agents-entry.md"], {
        display_name: skill.displayName,
        description: skill.description,
        name: skill.name,
      }),
    )
    .join("\n\n");

  return renderPromptAsset(["opencode-runtime", "custom-skills-agents.md"], {
    skill_entries: skillEntries,
  });
}

export function buildCoworkerModelInput(input: {
  coworkerPrompt?: string | null;
  triggerPayload?: unknown;
  trustedUserInput?: string | null;
}): string {
  const coworkerSections = [
    input.coworkerPrompt?.trim()
      ? renderPromptAsset(["opencode-runtime", "coworker-instructions-section.md"], {
          coworker_prompt: input.coworkerPrompt,
        })
      : null,
  ].filter(Boolean);
  const sections = [
    ...coworkerSections,
    renderPromptAsset(["opencode-runtime", "trigger-payload-section.md"], {
      trigger_payload: JSON.stringify(input.triggerPayload ?? {}, null, 2),
    }),
  ];
  if (input.trustedUserInput) {
    sections.push(
      "",
      renderPromptAsset(["opencode-runtime", "user-input-section.md"], {
        user_input: input.trustedUserInput,
      }),
    );
  }
  return sections.join("\n");
}

export function buildCoworkerDocumentAttachmentPrompt(filePaths: string[]): string {
  return renderPromptAsset(["opencode-runtime", "coworker-document-attachment.md"], {
    file_paths: filePaths.map((filePath) => `- ${filePath}`).join("\n"),
  });
}

export function buildUserUploadedFilePrompt(input: {
  sandboxPath: string;
  mimeType: string;
}): string {
  return renderPromptAsset(["opencode-runtime", "user-uploaded-file.md"], {
    sandbox_path: input.sandboxPath,
    mime_type: input.mimeType,
  });
}

export function buildUserUploadFailurePrompt(fileName: string): string {
  return renderPromptAsset(["opencode-runtime", "user-upload-failure.md"], {
    file_name: fileName,
  });
}

export function buildSlackBotBridgeMessage(input: {
  displayName: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  messageText: string;
}): string {
  return renderPromptAsset(["opencode-runtime", "slack-bot-bridge.md"], {
    display_name: input.displayName,
    channel_id: input.channelId,
    thread_ts: input.threadTs,
    message_ts: input.messageTs,
    message_text: input.messageText,
  });
}

export function buildConversationTitlePrompt(input: {
  userMessage: string;
  assistantMessage: string;
}): string {
  return renderPromptAsset(["opencode-runtime", "conversation-title.md"], {
    user_message: input.userMessage.slice(0, 500),
    assistant_message: input.assistantMessage.slice(0, 500),
  });
}

export function buildDetectMessageLanguagePrompt(text: string): string {
  return renderPromptAsset(["opencode-runtime", "detect-message-language.md"], {
    message: text.trim().slice(0, 4000),
  });
}

export type CoworkerMetadataPromptState = {
  name?: string | null;
  description?: string | null;
  username?: string | null;
  prompt?: string | null;
  triggerType?: string | null;
  allowedIntegrations?: string[] | null;
  allowedCustomIntegrations?: string[] | null;
  schedule?: unknown;
  autoApprove?: boolean | null;
};

export function buildCoworkerMetadataPrompt(input: {
  missingFields: string[];
  current: CoworkerMetadataPromptState;
  next: CoworkerMetadataPromptState;
}): string {
  return renderPromptAsset(["opencode-runtime", "coworker-metadata.md"], {
    missing_fields: input.missingFields.join(", "),
    current_json: JSON.stringify(
      {
        name: input.current.name,
        description: input.current.description,
        username: input.current.username,
        prompt: input.current.prompt,
        triggerType: input.current.triggerType,
        allowedIntegrations: input.current.allowedIntegrations,
        allowedCustomIntegrations: input.current.allowedCustomIntegrations,
        schedule: input.current.schedule,
        autoApprove: input.current.autoApprove,
      },
      null,
      2,
    ),
    next_json: JSON.stringify(
      {
        prompt: input.next.prompt,
        triggerType: input.next.triggerType,
        allowedIntegrations: input.next.allowedIntegrations,
        allowedCustomIntegrations: input.next.allowedCustomIntegrations,
        schedule: input.next.schedule,
        autoApprove: input.next.autoApprove,
      },
      null,
      2,
    ),
  });
}
