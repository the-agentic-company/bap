import type { TemplateCatalogTemplate } from "@cmdclaw/db/template-catalog";

export type TemplateDeployPayload = {
  createPayload: {
    name: string;
    triggerType: TemplateCatalogTemplate["triggerType"];
    prompt: string;
  };
  initialBuilderMessage: string;
};

function replacePlaceholder(template: string, placeholder: string, value: string) {
  return template.replaceAll(`{{${placeholder}}}`, value);
}

function buildTemplateInstructionsText(template: TemplateCatalogTemplate) {
  return template.agentInstructions.join("\n");
}

export function renderTemplateDeployPrompt(
  templateSource: string,
  template: TemplateCatalogTemplate,
) {
  const instructions = buildTemplateInstructionsText(template);

  return replacePlaceholder(
    replacePlaceholder(
      replacePlaceholder(
        replacePlaceholder(templateSource, "name", template.title),
        "trigger_title",
        template.triggerTitle,
      ),
      "trigger_description",
      template.triggerDescription,
    ),
    "instructions",
    instructions,
  );
}

export function buildTemplateDeployPayload(
  template: TemplateCatalogTemplate,
  templateSource: string,
): TemplateDeployPayload {
  return {
    createPayload: {
      name: template.title,
      triggerType: template.triggerType,
      prompt: buildTemplateInstructionsText(template),
    },
    initialBuilderMessage: renderTemplateDeployPrompt(templateSource, template),
  };
}
