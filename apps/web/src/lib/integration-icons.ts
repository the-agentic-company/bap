/**
 * Integration Icons Mapping
 *
 * Maps integration types to lucide-react icons for display in the UI.
 */

import {
  Bot,
  Mail,
  Calendar,
  FileText,
  Table2,
  HardDrive,
  BookOpen,
  TicketCheck,
  Github,
  Grid3X3,
  MessageSquare,
  Users,
  Linkedin,
  Cloud,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type IntegrationType =
  | "google_gmail"
  | "outlook"
  | "outlook_calendar"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "linear"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "dynamics";

type ExecutorDisplayOnlyIntegrationType = never;

export type DisplayIntegrationType =
  | IntegrationType
  | ExecutorDisplayOnlyIntegrationType
  | "coworker"
  | "agent-browser";

export const ALL_INTEGRATION_TYPES: IntegrationType[] = [
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
];

export const COMING_SOON_INTEGRATIONS: ReadonlySet<IntegrationType> = new Set();

export function isComingSoonIntegration(integration: IntegrationType): boolean {
  return COMING_SOON_INTEGRATIONS.has(integration);
}

export const COWORKER_AVAILABLE_INTEGRATION_TYPES: IntegrationType[] = ALL_INTEGRATION_TYPES.filter(
  (integration) => !isComingSoonIntegration(integration),
);

const INTEGRATION_ICONS: Record<IntegrationType, LucideIcon> = {
  google_gmail: Mail,
  outlook: Mail,
  outlook_calendar: Calendar,
  google_calendar: Calendar,
  google_docs: FileText,
  google_sheets: Table2,
  google_drive: HardDrive,
  notion: BookOpen,
  linear: TicketCheck,
  github: Github,
  airtable: Grid3X3,
  slack: MessageSquare,
  hubspot: Users,
  linkedin: Linkedin,
  salesforce: Cloud,
  dynamics: Cloud,
};

export const INTEGRATION_DISPLAY_NAMES: Record<IntegrationType, string> = {
  google_gmail: "Gmail",
  outlook: "Outlook Mail",
  outlook_calendar: "Outlook Calendar",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_drive: "Google Drive",
  notion: "Notion",
  linear: "Linear",
  github: "GitHub",
  airtable: "Airtable",
  slack: "Slack",
  hubspot: "HubSpot",
  linkedin: "LinkedIn",
  salesforce: "Salesforce",
  dynamics: "Microsoft Dynamics 365",
};

const INTEGRATION_COLORS: Record<IntegrationType, string> = {
  google_gmail: "text-red-500",
  outlook: "text-[#0A5CBD]",
  outlook_calendar: "text-[#0A5CBD]",
  google_calendar: "text-blue-500",
  google_docs: "text-blue-600",
  google_sheets: "text-green-500",
  google_drive: "text-yellow-500",
  notion: "text-gray-800 dark:text-gray-200",
  linear: "text-[#5E6AD2]",
  github: "text-gray-900 dark:text-gray-100",
  airtable: "text-blue-400",
  slack: "text-[#4A154B]",
  hubspot: "text-orange-500",
  linkedin: "text-[#0A66C2]",
  salesforce: "text-[#00A1E0]",
  dynamics: "text-[#0F6CBD]",
};

export const INTEGRATION_LOGOS: Record<IntegrationType, string> = {
  google_gmail: "/integrations/google-gmail.svg",
  outlook: "/integrations/outlook.svg",
  outlook_calendar: "/integrations/outlook-calendar.svg",
  google_calendar: "/integrations/google-calendar.svg",
  google_docs: "/integrations/google-docs.svg",
  google_sheets: "/integrations/google-sheets.svg",
  google_drive: "/integrations/google-drive.svg",
  notion: "/integrations/notion.svg",
  linear: "/integrations/linear.svg",
  github: "/integrations/github.svg",
  airtable: "/integrations/airtable.svg",
  slack: "/integrations/slack.svg",
  hubspot: "/integrations/hubspot.svg",
  linkedin: "/integrations/linkedin.svg",
  salesforce: "/integrations/salesforce.svg",
  dynamics: "/integrations/dynamics.svg",
};

// Human-readable descriptions for integration operations
export const INTEGRATION_OPERATION_LABELS: Record<IntegrationType, Record<string, string>> = {
  linear: {
    list: "Listing issues",
    get: "Getting issue",
    teams: "Listing teams",
    mine: "Getting my issues",
    create: "Creating issue",
    update: "Updating issue",
  },
  slack: {
    channels: "Listing channels",
    history: "Reading messages",
    search: "Searching messages",
    recent: "Getting recent messages",
    users: "Listing users",
    user: "Getting user info",
    thread: "Reading thread",
    send: "Sending message",
    react: "Adding reaction",
    upload: "Uploading file",
  },
  google_gmail: {
    list: "Listing emails",
    get: "Reading email",
    unread: "Getting unread emails",
    send: "Sending email",
  },
  outlook: {
    list: "Listing emails",
    get: "Reading email",
    unread: "Getting unread emails",
    send: "Sending email",
  },
  outlook_calendar: {
    list: "Listing events",
    get: "Getting event",
    calendars: "Listing calendars",
    today: "Getting today's events",
    create: "Creating event",
    update: "Updating event",
    delete: "Deleting event",
  },
  google_calendar: {
    list: "Listing events",
    get: "Getting event",
    calendars: "Listing calendars",
    today: "Getting today's events",
    create: "Creating event",
    update: "Updating event",
    delete: "Deleting event",
  },
  google_docs: {
    get: "Reading document",
    list: "Listing documents",
    search: "Searching documents",
    create: "Creating document",
    append: "Appending to document",
  },
  google_sheets: {
    get: "Reading spreadsheet",
    list: "Listing spreadsheets",
    create: "Creating spreadsheet",
    append: "Appending rows",
    update: "Updating cells",
    clear: "Clearing data",
    "add-sheet": "Adding sheet",
  },
  google_drive: {
    list: "Listing files",
    get: "Getting file",
    download: "Downloading file",
    search: "Searching files",
    folders: "Listing folders",
    upload: "Uploading file",
    mkdir: "Creating folder",
    delete: "Deleting file",
  },
  notion: {
    search: "Searching pages",
    get: "Getting page",
    databases: "Listing databases",
    query: "Querying database",
    create: "Creating page",
    append: "Appending content",
  },
  github: {
    repos: "Listing repositories",
    prs: "Listing pull requests",
    pr: "Getting pull request",
    "my-prs": "Getting my pull requests",
    issues: "Listing issues",
    search: "Searching code",
    "create-issue": "Creating issue",
  },
  airtable: {
    bases: "Listing bases",
    schema: "Getting schema",
    list: "Listing records",
    get: "Getting record",
    search: "Searching records",
    create: "Creating record",
    update: "Updating record",
    delete: "Deleting record",
  },
  hubspot: {
    "contacts.list": "Listing contacts",
    "contacts.get": "Getting contact",
    "contacts.search": "Searching contacts",
    "contacts.create": "Creating contact",
    "contacts.update": "Updating contact",
    "companies.list": "Listing companies",
    "companies.get": "Getting company",
    "companies.create": "Creating company",
    "companies.update": "Updating company",
    "deals.list": "Listing deals",
    "deals.get": "Getting deal",
    "deals.create": "Creating deal",
    "deals.update": "Updating deal",
    "tickets.list": "Listing tickets",
    "tickets.get": "Getting ticket",
    "tickets.create": "Creating ticket",
    "tickets.update": "Updating ticket",
    "tasks.list": "Listing tasks",
    "tasks.get": "Getting task",
    "tasks.create": "Creating task",
    "tasks.complete": "Completing task",
    "notes.list": "Listing notes",
    "notes.create": "Creating note",
    "pipelines.deals": "Getting deal pipelines",
    "pipelines.tickets": "Getting ticket pipelines",
    owners: "Listing owners",
  },
  linkedin: {
    "chats.list": "Listing chats",
    "chats.get": "Getting chat",
    "messages.list": "Listing messages",
    "messages.send": "Sending message",
    "messages.start": "Starting conversation",
    "profile.me": "Getting my profile",
    "profile.get": "Getting profile",
    "profile.company": "Getting company profile",
    search: "Searching",
    "invite.list": "Listing invitations",
    "invite.send": "Sending invitation",
    "connections.list": "Listing connections",
    "connections.remove": "Removing connection",
    "posts.list": "Listing posts",
    "posts.get": "Getting post",
    "posts.create": "Creating post",
    "posts.comment": "Commenting on post",
    "posts.react": "Reacting to post",
    "company.posts": "Listing company posts",
    "company.post": "Creating company post",
  },
  salesforce: {
    query: "Querying records",
    get: "Getting record",
    describe: "Getting object metadata",
    objects: "Listing objects",
    search: "Searching records",
    create: "Creating record",
    update: "Updating record",
  },
  dynamics: {
    whoami: "Getting current user",
    "tables.list": "Listing tables",
    "tables.get": "Getting table metadata",
    "rows.list": "Listing rows",
    "rows.get": "Getting row",
    "rows.create": "Creating row",
    "rows.update": "Updating row",
    "rows.delete": "Deleting row",
  },
};

const DISPLAY_INTEGRATION_ICONS: Record<DisplayIntegrationType, LucideIcon> = {
  ...INTEGRATION_ICONS,
  coworker: Bot,
  "agent-browser": Globe,
};

const DISPLAY_INTEGRATION_NAMES: Record<DisplayIntegrationType, string> = {
  ...INTEGRATION_DISPLAY_NAMES,
  coworker: "Coworker",
  "agent-browser": "Browser",
};

const DISPLAY_INTEGRATION_LOGOS: Partial<Record<DisplayIntegrationType, string>> = {
  ...INTEGRATION_LOGOS,
  coworker: "/tools/lobster.svg",
  "agent-browser": "/tools/browser.svg",
};

const DISPLAY_INTEGRATION_OPERATION_LABELS: Partial<
  Record<DisplayIntegrationType, Record<string, string>>
> = {
  ...INTEGRATION_OPERATION_LABELS,
  coworker: {
    list: "Listing coworkers",
    invoke: "Invoking coworker",
    edit: "Editing coworker",
    "upload-document": "Uploading coworker document",
  },
  "agent-browser": {
    open: "Opening page",
    goto: "Opening page",
    navigate: "Opening page",
    snapshot: "Inspecting page",
    click: "Clicking element",
    tap: "Tapping element",
    fill: "Filling field",
    type: "Typing text",
    select: "Selecting option",
    check: "Checking option",
    press: "Pressing key",
    scroll: "Scrolling page",
    get: "Getting page data",
    wait: "Waiting for page",
    screenshot: "Taking screenshot",
    pdf: "Saving PDF",
    close: "Closing browser",
    state: "Managing browser state",
    find: "Finding page element",
    swipe: "Swiping page",
  },
};

/**
 * Get the icon component for an integration
 */
export function getIntegrationIcon(integration: string): LucideIcon | null {
  return DISPLAY_INTEGRATION_ICONS[integration as DisplayIntegrationType] || null;
}

/**
 * Get the display name for an integration (with custom integration fallback)
 */
export function getIntegrationDisplayName(integration: string): string {
  return DISPLAY_INTEGRATION_NAMES[integration as DisplayIntegrationType] || integration;
}

/**
 * Get the color class for an integration icon (with custom fallback)
 */
export function getIntegrationColor(integration: string): string {
  if (integration === "linear") {
    return "text-purple-500";
  }

  return INTEGRATION_COLORS[integration as IntegrationType] || "text-muted-foreground";
}

/**
 * Get the logo path for an integration
 */
export function getIntegrationLogo(integration: string): string | null {
  return DISPLAY_INTEGRATION_LOGOS[integration as DisplayIntegrationType] || null;
}

/**
 * Get display info for a custom integration (fallback defaults)
 */
export function getCustomIntegrationDisplayInfo(name: string, iconUrl?: string | null) {
  return {
    displayName: name,
    color: "text-indigo-500",
    iconUrl: iconUrl || null,
  };
}

/**
 * Get the human-readable label for an integration operation
 */
export function getOperationLabel(integration: string, operation: string): string {
  const labels = DISPLAY_INTEGRATION_OPERATION_LABELS[integration as DisplayIntegrationType];
  if (labels && labels[operation]) {
    return labels[operation];
  }
  // Fallback: capitalize and format the operation name
  return operation.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get all available actions for an integration as display-friendly labels
 */
export function getIntegrationActions(integration: string): { key: string; label: string }[] {
  const labels = DISPLAY_INTEGRATION_OPERATION_LABELS[integration as DisplayIntegrationType];
  if (!labels) {
    return [];
  }

  const verbMap: Record<string, string> = {
    Listing: "List",
    Getting: "Get",
    Reading: "Read",
    Searching: "Search",
    Creating: "Create",
    Updating: "Update",
    Deleting: "Delete",
    Sending: "Send",
    Adding: "Add",
    Uploading: "Upload",
    Appending: "Append",
    Completing: "Complete",
    Removing: "Remove",
    Commenting: "Comment on",
    Reacting: "React to",
    Starting: "Start",
  };

  return Object.entries(labels).map(([key, label]) => ({
    key,
    // Convert labels like "Listing channels" into "List channels".
    label: (() => {
      const match = label.match(
        /^(Listing|Getting|Reading|Searching|Creating|Updating|Deleting|Sending|Adding|Uploading|Appending|Completing|Removing|Commenting|Reacting|Starting)\b(?:\s+(?:on|to))?/,
      );
      if (!match) {
        return label;
      }
      const verb = match[1];
      const replacement = verbMap[verb] || verb;
      return `${replacement}${label.slice(match[0].length)}`.trim();
    })(),
  }));
}
