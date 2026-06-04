export type CommunitySkillMetadata = {
  title: string;
  description: string;
};

export const COMMUNITY_SKILL_METADATA: Record<string, CommunitySkillMetadata> = {
  "agent-browser": {
    title: "Browser",
    description:
      "Browse the web autonomously — search, navigate, extract data, and interact with pages on behalf of the user. The agent can fill forms, click buttons, scrape content, and chain multi-step web tasks.",
  },
  "fill-pdf": {
    title: "Fill PDF",
    description:
      "Fill PDF form fields programmatically from structured data. Supports text fields, checkboxes, dropdowns, and signature placeholders.",
  },
  docx: {
    title: "Docx",
    description:
      "Generate polished Word documents from templates or scratch — headings, tables, images, and custom styles. Output professional reports, proposals, and contracts automatically.",
  },
  xlsx: {
    title: "Xlsx",
    description:
      "Create and manipulate Excel spreadsheets — multiple sheets, formulas, conditional formatting, and charts. Build reports, dashboards, and data exports programmatically.",
  },
  "skill-creator": {
    title: "Skill Creator",
    description:
      "Describe what you need in plain language and this meta-skill generates a fully functional new skill with instructions, files, and configuration. Bootstrap custom skills in seconds.",
  },
};
