import type { ComponentType } from "react";
import type { PreviewProps } from "./preview-styles";
import { AirtablePreview } from "./airtable-preview";
import { CalendarPreview } from "./calendar-preview";
import { DocsPreview } from "./docs-preview";
import { DrivePreview } from "./drive-preview";
import { GithubPreview } from "./github-preview";
import { GmailPreview } from "./gmail-preview";
import { HubspotPreview } from "./hubspot-preview";
import { NotionPreview } from "./notion-preview";
import { SheetsPreview } from "./sheets-preview";
import { SlackPreview } from "./slack-preview";

export type { PreviewProps } from "./preview-styles";
export { GenericPreview } from "./generic-preview";

export type PreviewComponent = ComponentType<PreviewProps>;

export interface IntegrationPreviewConfig {
  component: PreviewComponent;
  displayName: string;
}

// Map integration names to their preview components and display names
export const INTEGRATION_PREVIEWS: Record<string, IntegrationPreviewConfig> = {
  slack: { component: SlackPreview, displayName: "Slack" },
  google_gmail: { component: GmailPreview, displayName: "Gmail" },
  outlook: { component: GmailPreview, displayName: "Outlook Mail" },
  outlook_calendar: {
    component: CalendarPreview,
    displayName: "Outlook Calendar",
  },
  google_calendar: {
    component: CalendarPreview,
    displayName: "Google Calendar",
  },
  google_docs: { component: DocsPreview, displayName: "Google Docs" },
  google_sheets: { component: SheetsPreview, displayName: "Google Sheets" },
  google_drive: { component: DrivePreview, displayName: "Google Drive" },
  notion: { component: NotionPreview, displayName: "Notion" },
  github: { component: GithubPreview, displayName: "GitHub" },
  airtable: { component: AirtablePreview, displayName: "Airtable" },
  hubspot: { component: HubspotPreview, displayName: "HubSpot" },
};
