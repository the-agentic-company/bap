import { replacePlaceholders } from "./shared";

export type TemplateDeployPromptInput = {
  name: string;
  triggerTitle: string;
  triggerDescription: string;
  instructions: string | string[];
};

export function buildTemplateInstructionsText(instructions: string | string[]): string {
  return Array.isArray(instructions) ? instructions.join("\n") : instructions;
}

export function renderTemplateDeployPrompt(
  templateSource: string,
  template: TemplateDeployPromptInput,
): string {
  const instructions = buildTemplateInstructionsText(template.instructions);
  return replacePlaceholders(templateSource, {
    name: template.name,
    trigger_title: template.triggerTitle,
    trigger_description: template.triggerDescription,
    instructions,
  });
}

export function buildSelectedSkillInstructionBlock(skillSlugs: string[], isFrench: boolean): string {
  const heading = isFrench
    ? "Utilise les skills suivants pour résoudre la tâche:"
    : "use the following skills to solve the task:";
  const skillsList = skillSlugs.map((skillSlug) => `- "${skillSlug}"`).join("\n");
  return `${heading}\n${skillsList}`;
}
