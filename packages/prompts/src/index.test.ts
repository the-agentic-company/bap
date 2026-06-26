import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BAP_CHAT_AGENT_ID,
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
  OPENCODE_AGENT_DEFINITIONS_DIR,
  buildConversationTitlePrompt,
  buildCoworkerBuilderRuntimeSection,
  buildCoworkerExecutionSection,
  buildCoworkerDocumentAttachmentPrompt,
  buildCoworkerMetadataPrompt,
  buildAuditCompanyProfilePrompt,
  getAgenticAuditCoworkerDefinitions,
  buildAuditPersonProfilePrompt,
  buildCoworkerModelInput,
  buildCustomSkillsAgentsFile,
  buildDetectMessageLanguagePrompt,
  buildIntegrationSkillsSystemPrompt,
  buildIntegrationCliInstructions,
  buildSelectedPlatformSkillSection,
  buildSkillsSystemPrompt,
  buildSlackBotBridgeMessage,
  buildUserTimezoneSection,
  buildUserUploadedFilePrompt,
  buildUserUploadFailurePrompt,
  getBaseSystemPrompt,
  getCoworkerCliSystemPrompt,
  getFileSharingSection,
  getNativeMcpSection,
  getPromptAssetPath,
  getTemplateDeployPromptTemplate,
  renderTemplateDeployPrompt,
} from ".";

const templateDeployInput = {
  name: "Call follow-up",
  triggerTitle: "Call Transcription Ready",
  triggerDescription: "When a call transcription becomes available.",
  triggerType: "webhook",
  instructions: ["Read the transcript.", "Draft the follow-up."],
};

describe("@bap/prompts", () => {
  it("exports stable OpenCode agent ids and physical OpenCode Agent Definitions", () => {
    expect(BAP_CHAT_AGENT_ID).toBe("bap-chat");
    expect(BAP_COWORKER_BUILDER_AGENT_ID).toBe("bap-coworker-builder");
    expect(BAP_COWORKER_RUNNER_AGENT_ID).toBe("bap-coworker-runner");
    expect(existsSync(path.join(OPENCODE_AGENT_DEFINITIONS_DIR, "bap-chat.md"))).toBe(true);
    expect(existsSync(path.join(OPENCODE_AGENT_DEFINITIONS_DIR, "bap-coworker-builder.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(OPENCODE_AGENT_DEFINITIONS_DIR, "bap-coworker-runner.md"))).toBe(
      true,
    );
    expect(existsSync(getPromptAssetPath("product", "template-deploy.md"))).toBe(true);
  });

  it("loads reusable OpenCode runtime sections", () => {
    expect(getBaseSystemPrompt()).toBe("You are Bap, an AI agent that helps do work.");
    expect(getFileSharingSection()).toContain("## File Sharing");
    expect(getNativeMcpSection()).toContain("try the relevant MCP tool");
    expect(getCoworkerCliSystemPrompt()).toContain("coworker upload-document");
  });

  it("renders selected platform skill sections", () => {
    const section = buildSelectedPlatformSkillSection(["gmail", "calendar"]);

    expect(section).toContain("# Selected Platform Skills");
    expect(section).toContain("- /app/.claude/skills/gmail/SKILL.md");
    expect(section).toContain("- /app/.claude/skills/calendar/SKILL.md");
  });

  it("renders the template deploy prompt", () => {
    const template = getTemplateDeployPromptTemplate();
    const rendered = renderTemplateDeployPrompt(template, templateDeployInput);

    expect(rendered).toContain("Create it with name Call follow-up");
    expect(rendered).toContain("Call Transcription Ready");
    expect(rendered).toContain("Read the transcript.\nDraft the follow-up.");
  });

  it("renders integration CLI instructions with statuses, account hints, and custom sections", () => {
    const rendered = buildIntegrationCliInstructions({
      connectedIntegrations: ["google_gmail", "slack"],
      labelsByType: new Map([
        ["google_gmail", ["work"]],
        ["slack", ["team"]],
      ]),
      customIntegrations: [{ name: "Acme", cliInstructions: "acme list - List Acme objects" }],
    });

    expect(rendered).toContain("## Google Gmail CLI [✓ Connected]");
    expect(rendered).toContain("## Outlook Mail CLI [⚡ Auth Required]");
    expect(rendered).toContain("Account Labels: work");
    expect(rendered).toContain("Account Labels: team");
    expect(rendered).toContain("## Acme CLI (Custom) [✓ Connected]");
  });

  it("renders model helper and task-frame prompts", () => {
    expect(buildAuditCompanyProfilePrompt({ websiteContext: '{"title":"Acme"}' })).toContain(
      "You are Agentic Auditor's company profiler.",
    );
    expect(buildAuditPersonProfilePrompt({ linkedinContext: '{"fullName":"Ada"}' })).toContain(
      "You are Agentic Auditor's LinkedIn person profiler.",
    );
    const auditCoworkers = getAgenticAuditCoworkerDefinitions();
    expect(auditCoworkers).toHaveLength(5);
    expect(auditCoworkers[0]?.prompt).toContain("You are Company Brain for Agentic Auditor.");
    expect(auditCoworkers[2]?.prompt).toContain("### Page 1: Personalized Outreach Agent");
    expect(buildConversationTitlePrompt({ userMessage: "hello", assistantMessage: "hi" }))
      .toContain("Return ONLY the title");
    expect(buildDetectMessageLanguagePrompt("bonjour")).toContain(
      'Respond with exactly one lowercase token: "french" or "other".',
    );
    expect(
      buildCoworkerMetadataPrompt({
        missingFields: ["name"],
        current: { name: null, prompt: "old" },
        next: { prompt: "new", triggerType: "manual" },
      }),
    ).toContain("Generate missing metadata for a coworker.");
    expect(
      buildCoworkerModelInput({
        coworkerPrompt: "Do the work",
        triggerPayload: { source: "manual" },
        trustedUserInput: "Use this detail",
      }),
    ).toContain("## User Input\nUse this detail");
    expect(buildCoworkerDocumentAttachmentPrompt(["/app/docs/a.pdf"])).toContain(
      "Read them from disk when they are relevant to the task.",
    );
    expect(
      buildUserUploadedFilePrompt({ sandboxPath: "/home/user/uploads/a.txt", mimeType: "text/plain" }),
    ).toBe("The user uploaded a file: /home/user/uploads/a.txt (text/plain).");
    expect(buildUserUploadFailurePrompt("a.txt")).toBe(
      'The user tried to upload a file "a.txt" but it could not be written to the sandbox.',
    );
    expect(
      buildSlackBotBridgeMessage({
        displayName: "Ada",
        channelId: "C1",
        threadTs: "1.2",
        messageTs: "1.3",
        messageText: "repeat hi",
      }),
    ).toContain("context: You are already replying in this exact Slack thread");
  });

  it("renders OpenCode runtime dynamic sections", () => {
    expect(buildUserTimezoneSection("Europe/Dublin")).toContain(
      "The user's saved IANA timezone is `Europe/Dublin`.",
    );
    expect(buildUserTimezoneSection("   ")).toBeNull();

    const executionSection = buildCoworkerExecutionSection({
      coworkerPrompt: "Do the work",
      triggerPayload: { source: "manual" },
    });
    expect(executionSection).toContain("## Coworker Instructions\nDo the work");
    expect(executionSection).toContain('"source": "manual"');
    expect(buildCoworkerExecutionSection({})).toBeNull();

    const builderSection = buildCoworkerBuilderRuntimeSection({
      coworkerId: "cw-1",
      updatedAt: "2026-06-23T10:00:00.000Z",
      prompt: "Draft summaries",
      model: "openai/gpt-5.4",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["google_gmail"],
      requiresUserInput: true,
      userInputPrompt: "Which account?",
    });
    expect(builderSection).toContain("## Coworker Builder Runtime Context");
    expect(builderSection).toContain("coworker edit cw-1");
    expect(builderSection).toContain('"allowedIntegrations": [');
  });

  it("renders custom and integration skill instruction frames", () => {
    expect(buildSkillsSystemPrompt([])).toBe("");
    expect(buildSkillsSystemPrompt(["sales-followup"])).toContain("- sales-followup");
    expect(buildIntegrationSkillsSystemPrompt([])).toBe("");
    expect(buildIntegrationSkillsSystemPrompt(["gmail"])).toContain("- gmail");
  });

  it("renders generated custom skill agent guidance", () => {
    expect(
      buildCustomSkillsAgentsFile([
        {
          name: "sales-followup",
          displayName: "Sales Followup",
          description: "Draft sales follow-up messages.",
        },
      ]),
    ).toBe(
      [
        "# Custom Skills",
        "",
        "## Sales Followup",
        "",
        "Draft sales follow-up messages.",
        "",
        "Files available in: /app/.opencode/skills/sales-followup/",
      ].join("\n"),
    );
  });
});
