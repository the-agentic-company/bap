import { describe, expect, it } from "vitest";
import type { TemplateItem } from "./templates-filters";
import { filterTemplates, toggleMultiSelect } from "./templates-filters";

const TEMPLATES: TemplateItem[] = [
  {
    id: "sales-follow-up",
    title: "Sales follow-up",
    description: "Draft follow-up emails for prospects.",
    triggerType: "manual",
    integrations: ["google_gmail", "hubspot"],
    industry: "Sales",
    useCase: "Follow-ups",
  },
  {
    id: "marketing-report",
    title: "Marketing report",
    description: "Summarize campaign performance in Slack.",
    triggerType: "schedule",
    integrations: ["slack", "google_sheets"],
    industry: "Marketing",
    useCase: "Reporting",
  },
  {
    id: "sales-meeting-prep",
    title: "Sales meeting prep",
    description: "Prep for upcoming meetings with enriched lead data.",
    triggerType: "webhook",
    integrations: ["linkedin", "slack"],
    industry: "Sales",
    useCase: "Meeting Prep",
  },
];

describe("toggleMultiSelect", () => {
  it("adds values that are not selected yet", () => {
    expect(toggleMultiSelect(["Sales"], "Marketing")).toEqual(["Sales", "Marketing"]);
  });

  it("removes values that are already selected", () => {
    expect(toggleMultiSelect(["Sales", "Marketing"], "Sales")).toEqual(["Marketing"]);
  });
});

describe("filterTemplates", () => {
  it("matches multiple selections across groups", () => {
    const result = filterTemplates(TEMPLATES, {
      search: "",
      industries: ["Sales"],
      useCases: ["Follow-ups", "Meeting Prep"],
      integrations: ["slack", "google_gmail"],
    });

    expect(result.map((template) => template.id)).toEqual([
      "sales-follow-up",
      "sales-meeting-prep",
    ]);
  });

  it("keeps OR semantics inside a group", () => {
    const result = filterTemplates(TEMPLATES, {
      search: "",
      industries: ["Sales", "Marketing"],
      useCases: [],
      integrations: [],
    });

    expect(result).toHaveLength(3);
  });

  it("still applies text search alongside selected filters", () => {
    const result = filterTemplates(TEMPLATES, {
      search: "campaign",
      industries: ["Marketing"],
      useCases: ["Reporting"],
      integrations: ["slack"],
    });

    expect(result.map((template) => template.id)).toEqual(["marketing-report"]);
  });
});
