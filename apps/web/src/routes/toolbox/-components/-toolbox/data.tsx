import { FileInput, FileOutput, Globe, Table, Wand2 } from "lucide-react";
import { msg } from "gt-react";
import {
  isComingSoonIntegration,
  type IntegrationType as IntegrationIconType,
} from "@/lib/integration-icons";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type FilterTab = "all" | "active" | "needs_setup";

export type IntegrationType = IntegrationIconType;

export type OAuthIntegrationType = Exclude<IntegrationType, "linear">;

export type GoogleIntegrationType =
  | "google_gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive";

const googleIntegrationTypes = new Set<GoogleIntegrationType>([
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);

export function isGoogleIntegrationType(type: OAuthIntegrationType): type is GoogleIntegrationType {
  return googleIntegrationTypes.has(type as GoogleIntegrationType);
}

// ─── Integration config ─────────────────────────────────────────────────────────

export const integrationConfig: Record<
  string,
  { name: string; description: string; icon: string }
> = {
  google_gmail: {
    name: "Google Gmail",
    description: msg("Read and send emails"),
    icon: "/integrations/google-gmail.svg",
  },
  outlook: {
    name: "Outlook Mail",
    description: msg("Read and send emails"),
    icon: "/integrations/outlook.svg",
  },
  outlook_calendar: {
    name: "Outlook Calendar",
    description: msg("Manage events and calendars"),
    icon: "/integrations/outlook-calendar.svg",
  },
  google_calendar: {
    name: "Google Calendar",
    description: msg("Manage events and calendars"),
    icon: "/integrations/google-calendar.svg",
  },
  google_docs: {
    name: "Google Docs",
    description: msg("Read and edit documents"),
    icon: "/integrations/google-docs.svg",
  },
  google_sheets: {
    name: "Google Sheets",
    description: msg("Read and edit spreadsheets"),
    icon: "/integrations/google-sheets.svg",
  },
  google_drive: {
    name: "Google Drive",
    description: msg("Access and manage files"),
    icon: "/integrations/google-drive.svg",
  },
  notion: {
    name: "Notion",
    description: msg("Search and create pages"),
    icon: "/integrations/notion.svg",
  },
  airtable: {
    name: "Airtable",
    description: msg("Read and update bases"),
    icon: "/integrations/airtable.svg",
  },
  slack: {
    name: "Slack",
    description: msg("Send messages and read channels"),
    icon: "/integrations/slack.svg",
  },
  hubspot: {
    name: "HubSpot",
    description: msg("Manage CRM contacts, deals, and tickets"),
    icon: "/integrations/hubspot.svg",
  },
  linkedin: {
    name: "LinkedIn",
    description: msg("Send messages, manage connections, and post content"),
    icon: "/integrations/linkedin.svg",
  },
  salesforce: {
    name: "Salesforce",
    description: msg("Query and manage CRM records and contacts"),
    icon: "/integrations/salesforce.svg",
  },
  dynamics: {
    name: "Microsoft Dynamics 365",
    description: msg("Manage Dataverse tables and CRM rows"),
    icon: "/integrations/dynamics.svg",
  },
};

export const adminPreviewOnlyIntegrations = new Set<IntegrationType>(
  (Object.keys(integrationConfig) as IntegrationType[]).filter(isComingSoonIntegration),
);

// ─── Community skills ───────────────────────────────────────────────────────────

export type CommunitySkill = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  logoUrl?: string;
  category: string;
  kind: "skill" | "tool-integration";
  enabled: boolean;
};

export const COMMUNITY_SKILLS: CommunitySkill[] = [
  {
    id: "agent-browser",
    slug: "agent-browser",
    displayName: "Browser",
    description:
      "Browse the web autonomously — search, navigate, extract data, and interact with pages on behalf of the user.",
    icon: <Globe className="h-5 w-5" />,
    logoUrl: "/tools/browser.svg",
    category: "Automation",
    kind: "tool-integration",
    enabled: true,
  },
  {
    id: "fill-pdf",
    slug: "fill-pdf",
    displayName: "Fill PDF",
    description:
      "Fill PDF form fields programmatically from structured data. Supports text fields, checkboxes, and dropdowns.",
    icon: <FileInput className="h-5 w-5" />,
    category: "Documents",
    kind: "skill",
    enabled: true,
  },
  {
    id: "docx",
    slug: "docx",
    displayName: "Docx",
    description:
      "Generate polished Word documents from templates or scratch — headings, tables, images, and custom styles.",
    icon: <FileOutput className="h-5 w-5" />,
    logoUrl: "/integrations/google-docs.svg",
    category: "Documents",
    kind: "skill",
    enabled: true,
  },
  {
    id: "xlsx",
    slug: "xlsx",
    displayName: "Xlsx",
    description:
      "Create and manipulate Excel spreadsheets — multiple sheets, formulas, conditional formatting, and charts.",
    icon: <Table className="h-5 w-5" />,
    logoUrl: "/integrations/google-sheets.svg",
    category: "Documents",
    kind: "skill",
    enabled: false,
  },
  {
    id: "skill-creator",
    slug: "skill-creator",
    displayName: "Skill Creator",
    description:
      "Describe what you need in plain language and this skill generates a fully functional new skill with instructions and files.",
    icon: <Wand2 className="h-5 w-5" />,
    category: "Utilities",
    kind: "skill",
    enabled: true,
  },
];

export const CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;

export const FADE_IN_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────────

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
