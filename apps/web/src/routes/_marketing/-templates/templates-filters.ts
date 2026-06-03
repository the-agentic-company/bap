import type { TemplateIntegrationType } from "@cmdclaw/db/template-catalog";

export type TemplateItem = {
  id: string;
  title: string;
  description: string;
  triggerType: "manual" | "schedule" | "email" | "webhook";
  integrations: TemplateIntegrationType[];
  industry: string;
  useCase: string;
};

export type TemplateFilters = {
  search: string;
  industries: string[];
  useCases: string[];
  integrations: TemplateIntegrationType[];
};

export function toggleMultiSelect<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function filterTemplates(templates: TemplateItem[], filters: TemplateFilters) {
  const searchQuery = filters.search.toLowerCase().trim();

  return templates.filter((template) => {
    if (filters.industries.length > 0 && !filters.industries.includes(template.industry)) {
      return false;
    }

    if (filters.useCases.length > 0 && !filters.useCases.includes(template.useCase)) {
      return false;
    }

    if (
      filters.integrations.length > 0 &&
      !filters.integrations.some((integration) => template.integrations.includes(integration))
    ) {
      return false;
    }

    if (
      searchQuery &&
      !template.title.toLowerCase().includes(searchQuery) &&
      !template.description.toLowerCase().includes(searchQuery)
    ) {
      return false;
    }

    return true;
  });
}
