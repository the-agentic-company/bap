// ─── Types ────────────────────────────────────────────────────────────────────

type SummaryBlock = {
  title: string;
  body: string;
};

export type UseCase = {
  title: string;
  body: string;
};

export type CommunitySkillContent = {
  id: string;
  title: string;
  category: string;
  description: string;
  iconName: string;
  logoUrl?: string;
  kind: "skill" | "tool-integration";
  githubUrl: string;
  summaryBlocks: SummaryBlock[];
  howItWorks: string[];
  useCases: UseCase[];
};

// ─── Mock data ────────────────────────────────────────────────────────────────

export const COMMUNITY_SKILLS_DATA: Record<string, CommunitySkillContent> = {
  "agent-browser": {
    id: "agent-browser",
    title: "Browser",
    category: "Automation",
    description:
      "Browse the web autonomously — search, navigate, extract data, and interact with pages on behalf of the user. The agent can fill forms, click buttons, scrape content, and chain multi-step web tasks.",
    iconName: "globe",
    logoUrl: "/tools/browser.svg",
    kind: "tool-integration",
    githubUrl:
      "https://github.com/baptistecolle/cmdclaw/blob/main/apps/sandbox/src/common/skills/agent-browser/SKILL.md",
    summaryBlocks: [
      {
        title: "Navigate and interact",
        body: "Opens URLs, clicks elements, fills forms, and navigates multi-page flows just like a human user would.",
      },
      {
        title: "Extract structured data",
        body: "Scrapes page content and returns clean, structured data — tables, lists, text blocks, or custom selectors.",
      },
      {
        title: "Search and research",
        body: "Performs web searches, follows result links, and compiles findings into a concise summary.",
      },
    ],
    howItWorks: [
      "Receive a browsing task with a target URL or search query.",
      "Launch a headless browser session and navigate to the target page.",
      "Analyze the page DOM to identify interactive elements, text content, and navigation paths.",
      "Execute the requested actions — clicking, typing, scrolling, or extracting data.",
      "If the task spans multiple pages, follow links and repeat the process.",
      "Return structured results with extracted data, screenshots, or confirmation of completed actions.",
    ],
    useCases: [
      {
        title: "Competitive price monitoring",
        body: "Automatically check competitor websites for pricing changes and compile a comparison report.",
      },
      {
        title: "Lead research",
        body: "Visit a prospect's website, LinkedIn, and news mentions to build a pre-call briefing.",
      },
      {
        title: "Form submission automation",
        body: "Fill and submit web forms across vendor portals, government sites, or partner platforms.",
      },
    ],
  },
  "fill-pdf": {
    id: "fill-pdf",
    title: "Fill PDF",
    category: "Documents",
    description:
      "Fill PDF form fields programmatically from structured data. Supports text fields, checkboxes, dropdowns, and signature placeholders.",
    iconName: "file-input",
    kind: "skill",
    githubUrl:
      "https://github.com/baptistecolle/cmdclaw/blob/main/apps/sandbox/src/common/skills/fill-pdf/SKILL.md",
    summaryBlocks: [
      {
        title: "Parse PDF structure",
        body: "Reads the PDF and identifies all fillable form fields, their types, and constraints.",
      },
      {
        title: "Map data to fields",
        body: "Matches your structured data (JSON, spreadsheet row) to the correct form fields by name or position.",
      },
      {
        title: "Generate filled PDF",
        body: "Produces a completed PDF with all fields populated, ready to download or attach to an email.",
      },
    ],
    howItWorks: [
      "Receive a PDF template URL or file reference and a data payload (JSON object or spreadsheet row).",
      "Parse the PDF to extract all AcroForm fields — text inputs, checkboxes, radio buttons, dropdowns.",
      "Match each data key to a form field by field name, falling back to positional matching.",
      "Fill each field with the corresponding value, respecting field types and validation rules.",
      "Flatten the form if requested (makes fields non-editable) and return the completed PDF.",
    ],
    useCases: [
      {
        title: "Client onboarding forms",
        body: "Auto-fill KYC, compliance, or intake forms from CRM contact data.",
      },
      {
        title: "Invoice generation",
        body: "Populate invoice templates with line items, totals, and payment details from your billing system.",
      },
      {
        title: "HR document processing",
        body: "Fill employee contracts, NDAs, or tax forms from HR records.",
      },
    ],
  },
  docx: {
    id: "docx",
    title: "Docx",
    category: "Documents",
    description:
      "Generate polished Word documents from templates or scratch — headings, tables, images, and custom styles. Output professional reports, proposals, and contracts automatically.",
    iconName: "file-output",
    kind: "skill",
    githubUrl:
      "https://github.com/baptistecolle/cmdclaw/blob/main/apps/sandbox/src/common/skills/docx/SKILL.md",
    summaryBlocks: [
      {
        title: "Template-based generation",
        body: "Use existing .docx templates with placeholder variables that get replaced with your data.",
      },
      {
        title: "Rich content support",
        body: "Insert tables, images, styled headings, bullet lists, page breaks, and custom fonts.",
      },
      {
        title: "Dynamic sections",
        body: "Conditionally include or repeat sections based on your data — perfect for variable-length reports.",
      },
    ],
    howItWorks: [
      "Receive a template reference (or generate from scratch) and a data payload.",
      "Parse the template to identify placeholder tokens and repeatable sections.",
      "Replace each placeholder with the corresponding data value, formatting dates, numbers, and currencies.",
      "For repeating sections (e.g., line items in a proposal), clone the section for each data row.",
      "Insert any images, charts, or tables specified in the data payload.",
      "Return the completed .docx file ready for download or email attachment.",
    ],
    useCases: [
      {
        title: "Sales proposals",
        body: "Generate branded proposals with client details, pricing tables, and scope of work pulled from your CRM.",
      },
      {
        title: "Meeting minutes",
        body: "Auto-generate formatted meeting notes from transcription data with action items and attendee lists.",
      },
      {
        title: "Compliance reports",
        body: "Produce standardized compliance documents with data from multiple sources, ready for audit.",
      },
    ],
  },
  xlsx: {
    id: "xlsx",
    title: "Xlsx",
    category: "Documents",
    description:
      "Create and manipulate Excel spreadsheets — multiple sheets, formulas, conditional formatting, and charts. Build reports, dashboards, and data exports programmatically.",
    iconName: "table",
    kind: "skill",
    githubUrl:
      "https://github.com/baptistecolle/cmdclaw/blob/main/apps/sandbox/src/common/skills/xlsx/SKILL.md",
    summaryBlocks: [
      {
        title: "Multi-sheet workbooks",
        body: "Create workbooks with multiple named sheets, each with its own structure, data, and formatting.",
      },
      {
        title: "Formulas and formatting",
        body: "Add Excel formulas (SUM, VLOOKUP, etc.), conditional formatting rules, number formats, and cell styles.",
      },
      {
        title: "Charts and visuals",
        body: "Generate bar charts, line charts, and pie charts embedded directly in the spreadsheet.",
      },
    ],
    howItWorks: [
      "Receive a data payload with sheet definitions, headers, rows, and optional formatting rules.",
      "Create the workbook structure — sheets, column widths, frozen panes, and header rows.",
      "Populate cells with data, applying number formats, date formats, and text styles.",
      "Insert formulas for calculated fields — totals, averages, lookups, and custom expressions.",
      "Apply conditional formatting rules (e.g., red for negative values, green for targets met).",
      "Return the completed .xlsx file ready for download or attachment.",
    ],
    useCases: [
      {
        title: "Weekly pipeline reports",
        body: "Export CRM deal data into a formatted spreadsheet with pivot-ready structure and summary formulas.",
      },
      {
        title: "Financial reconciliation",
        body: "Generate reconciliation sheets matching transactions across systems with variance highlighting.",
      },
      {
        title: "Data exports",
        body: "Transform API data into clean, structured spreadsheets for stakeholders who prefer Excel.",
      },
    ],
  },
  "skill-creator": {
    id: "skill-creator",
    title: "Skill Creator",
    category: "Utilities",
    description:
      "Describe what you need in plain language and this meta-skill generates a fully functional new skill with instructions, files, and configuration. Bootstrap custom skills in seconds.",
    iconName: "wand",
    kind: "skill",
    githubUrl:
      "https://github.com/baptistecolle/cmdclaw/blob/main/apps/sandbox/src/common/skills/skill-creator/SKILL.md",
    summaryBlocks: [
      {
        title: "Natural language input",
        body: "Describe what you want the skill to do in plain English — no code or configuration needed.",
      },
      {
        title: "Generates complete skill",
        body: "Creates the SKILL.md with frontmatter, instructions, and any supporting files the skill needs.",
      },
      {
        title: "Ready to activate",
        body: "The generated skill is immediately usable — toggle it on and start using it in your workflows.",
      },
    ],
    howItWorks: [
      "Receive a natural language description of the desired skill behavior and capabilities.",
      "Analyze the description to identify the skill's trigger conditions, required inputs, and expected outputs.",
      "Generate the SKILL.md file with proper YAML frontmatter (name, description) and detailed instructions.",
      "Create any supporting files needed — templates, schemas, or reference data.",
      "Save the skill to your account with a sensible slug, icon, and description.",
    ],
    useCases: [
      {
        title: "Custom report formats",
        body: "Describe your company's report format and get a skill that generates reports matching your template.",
      },
      {
        title: "Domain-specific workflows",
        body: "Create skills for industry-specific tasks like legal document review or medical record processing.",
      },
      {
        title: "Team-specific automation",
        body: "Build skills tailored to your team's unique processes — standup formats, review checklists, or escalation procedures.",
      },
    ],
  },
};
