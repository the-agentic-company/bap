import {
  buildTemplateInstructionsText,
  renderTemplateDeployPrompt as renderPromptTemplateDeployPrompt,
  type TemplateDeployPromptInput,
} from "@bap/prompts/browser";
import type { TemplateCatalogTemplate } from "@bap/db/template-catalog";

export type TemplateDeployPayload = {
  createPayload: {
    name: string;
    triggerType: TemplateCatalogTemplate["triggerType"];
    prompt: string;
  };
  initialBuilderMessage: string;
};

function toPromptTemplateInput(template: TemplateCatalogTemplate): TemplateDeployPromptInput {
  return {
    name: template.title,
    triggerTitle: template.triggerTitle,
    triggerDescription: template.triggerDescription,
    instructions: template.agentInstructions,
  };
}

export function renderTemplateDeployPrompt(
  templateSource: string,
  template: TemplateCatalogTemplate,
) {
  return renderPromptTemplateDeployPrompt(templateSource, toPromptTemplateInput(template));
}

export function buildTemplateDeployPayload(
  template: TemplateCatalogTemplate,
  templateSource: string,
): TemplateDeployPayload {
  const promptInput = toPromptTemplateInput(template);

  return {
    createPayload: {
      name: template.title,
      triggerType: template.triggerType,
      prompt: buildTemplateInstructionsText(template.agentInstructions),
    },
    initialBuilderMessage: renderPromptTemplateDeployPrompt(templateSource, promptInput),
  };
}
