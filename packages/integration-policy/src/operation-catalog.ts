export const MANAGED_INTEGRATION_TYPES = [
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
] as const;

export type ManagedIntegrationType = (typeof MANAGED_INTEGRATION_TYPES)[number];

export type ManagedOperationDescriptor = {
  key: string;
  label: string;
  accessHint: "read" | "write";
  mcpToolNames?: readonly string[];
};

export type ManagedIntegrationDescriptor = {
  integrationType: ManagedIntegrationType;
  displayName: string;
  cliNames: readonly string[];
  operations: readonly ManagedOperationDescriptor[];
};

const operation = (
  key: string,
  label: string,
  accessHint: "read" | "write",
  mcpToolNames?: readonly string[],
): ManagedOperationDescriptor => ({
  key,
  label,
  accessHint,
  ...(mcpToolNames ? { mcpToolNames } : {}),
});

export const MANAGED_INTEGRATION_CATALOG: readonly ManagedIntegrationDescriptor[] = [
  {
    integrationType: "google_gmail",
    displayName: "Gmail",
    cliNames: ["google-gmail"],
    operations: [
      operation("list", "Listing emails", "read", ["gmail.list"]),
      operation("search", "Searching emails", "read", ["gmail.search"]),
      operation("get", "Reading email", "read", ["gmail.get"]),
      operation("unread", "Getting unread emails", "read", ["gmail.unread"]),
      operation("latest", "Getting latest email", "read", ["gmail.latest"]),
      operation("draft", "Drafting email", "write", ["gmail.draft"]),
      operation("send", "Sending email", "write", ["gmail.send"]),
    ],
  },
  {
    integrationType: "outlook",
    displayName: "Outlook Mail",
    cliNames: ["outlook-mail"],
    operations: [
      operation("list", "Listing emails", "read"),
      operation("search", "Searching emails", "read"),
      operation("get", "Reading email", "read"),
      operation("unread", "Getting unread emails", "read"),
      operation("contact", "Finding contact", "read"),
      operation("contacts.list", "Listing contacts", "read"),
      operation("send", "Sending email", "write"),
    ],
  },
  {
    integrationType: "outlook_calendar",
    displayName: "Outlook Calendar",
    cliNames: ["outlook-calendar"],
    operations: [
      operation("list", "Listing events", "read"),
      operation("get", "Getting event", "read"),
      operation("calendars", "Listing calendars", "read"),
      operation("today", "Getting today's events", "read"),
      operation("create", "Creating event", "write"),
      operation("update", "Updating event", "write"),
      operation("delete", "Deleting event", "write"),
    ],
  },
  {
    integrationType: "google_calendar",
    displayName: "Google Calendar",
    cliNames: ["google-calendar"],
    operations: [
      operation("list", "Listing events", "read"),
      operation("get", "Getting event", "read"),
      operation("calendars", "Listing calendars", "read"),
      operation("today", "Getting today's events", "read"),
      operation("create", "Creating event", "write"),
      operation("update", "Updating event", "write"),
      operation("delete", "Deleting event", "write"),
    ],
  },
  {
    integrationType: "google_docs",
    displayName: "Google Docs",
    cliNames: ["google-docs"],
    operations: [
      operation("get", "Reading document", "read"),
      operation("list", "Listing documents", "read"),
      operation("search", "Searching documents", "read"),
      operation("create", "Creating document", "write"),
      operation("append", "Appending to document", "write"),
    ],
  },
  {
    integrationType: "google_sheets",
    displayName: "Google Sheets",
    cliNames: ["google-sheets"],
    operations: [
      operation("get", "Reading spreadsheet", "read"),
      operation("list", "Listing spreadsheets", "read"),
      operation("create", "Creating spreadsheet", "write"),
      operation("append", "Appending rows", "write"),
      operation("update", "Updating cells", "write"),
      operation("clear", "Clearing data", "write"),
      operation("add-sheet", "Adding sheet", "write"),
    ],
  },
  {
    integrationType: "google_drive",
    displayName: "Google Drive",
    cliNames: ["google-drive"],
    operations: [
      operation("list", "Listing files", "read"),
      operation("get", "Getting file", "read"),
      operation("download", "Downloading file", "read"),
      operation("search", "Searching files", "read"),
      operation("folders", "Listing folders", "read"),
      operation("upload", "Uploading file", "write"),
      operation("mkdir", "Creating folder", "write"),
      operation("delete", "Deleting file", "write"),
    ],
  },
  {
    integrationType: "notion",
    displayName: "Notion",
    cliNames: ["notion"],
    operations: [
      operation("search", "Searching pages", "read"),
      operation("get", "Getting page", "read"),
      operation("databases", "Listing databases", "read"),
      operation("query", "Querying database", "read"),
      operation("create", "Creating page", "write"),
      operation("append", "Appending content", "write"),
    ],
  },
  {
    integrationType: "linear",
    displayName: "Linear",
    cliNames: [],
    operations: [
      operation("list", "Listing issues", "read"),
      operation("get", "Getting issue", "read"),
      operation("teams", "Listing teams", "read"),
      operation("mine", "Getting my issues", "read"),
      operation("create", "Creating issue", "write"),
      operation("update", "Updating issue", "write"),
    ],
  },
  {
    integrationType: "github",
    displayName: "GitHub",
    cliNames: ["github"],
    operations: [
      operation("repos", "Listing repositories", "read"),
      operation("prs", "Listing pull requests", "read"),
      operation("pr", "Getting pull request", "read"),
      operation("my-prs", "Getting my pull requests", "read"),
      operation("issues", "Listing issues", "read"),
      operation("search", "Searching code", "read"),
      operation("create-issue", "Creating issue", "write"),
    ],
  },
  {
    integrationType: "airtable",
    displayName: "Airtable",
    cliNames: ["airtable"],
    operations: [
      operation("bases", "Listing bases", "read"),
      operation("schema", "Getting schema", "read"),
      operation("list", "Listing records", "read"),
      operation("get", "Getting record", "read"),
      operation("search", "Searching records", "read"),
      operation("create", "Creating record", "write"),
      operation("update", "Updating record", "write"),
      operation("delete", "Deleting record", "write"),
    ],
  },
  {
    integrationType: "slack",
    displayName: "Slack",
    cliNames: ["slack"],
    operations: [
      operation("channels", "Listing channels", "read"),
      operation("history", "Reading messages", "read"),
      operation("search", "Searching messages", "read"),
      operation("recent", "Getting recent messages", "read"),
      operation("users", "Listing users", "read"),
      operation("user", "Getting user info", "read"),
      operation("thread", "Reading thread", "read"),
      operation("send", "Sending message", "write"),
      operation("react", "Adding reaction", "write"),
      operation("upload", "Uploading file", "write"),
    ],
  },
  {
    integrationType: "hubspot",
    displayName: "HubSpot",
    cliNames: ["hubspot"],
    operations: [
      operation("contacts.list", "Listing contacts", "read"),
      operation("contacts.get", "Getting contact", "read"),
      operation("contacts.search", "Searching contacts", "read"),
      operation("companies.list", "Listing companies", "read"),
      operation("companies.get", "Getting company", "read"),
      operation("deals.list", "Listing deals", "read"),
      operation("deals.get", "Getting deal", "read"),
      operation("tickets.list", "Listing tickets", "read"),
      operation("tickets.get", "Getting ticket", "read"),
      operation("tasks.list", "Listing tasks", "read"),
      operation("tasks.get", "Getting task", "read"),
      operation("notes.list", "Listing notes", "read"),
      operation("pipelines.deals", "Getting deal pipelines", "read"),
      operation("pipelines.tickets", "Getting ticket pipelines", "read"),
      operation("owners", "Listing owners", "read"),
      operation("contacts.create", "Creating contact", "write"),
      operation("contacts.update", "Updating contact", "write"),
      operation("companies.create", "Creating company", "write"),
      operation("companies.update", "Updating company", "write"),
      operation("deals.create", "Creating deal", "write"),
      operation("deals.update", "Updating deal", "write"),
      operation("tickets.create", "Creating ticket", "write"),
      operation("tickets.update", "Updating ticket", "write"),
      operation("tasks.create", "Creating task", "write"),
      operation("tasks.complete", "Completing task", "write"),
      operation("notes.create", "Creating note", "write"),
    ],
  },
  {
    integrationType: "linkedin",
    displayName: "LinkedIn",
    cliNames: ["linkedin"],
    operations: [
      operation("chats.list", "Listing chats", "read"),
      operation("chats.get", "Getting chat", "read"),
      operation("messages.list", "Listing messages", "read"),
      operation("profile.me", "Getting my profile", "read"),
      operation("profile.get", "Getting profile", "read"),
      operation("profile.company", "Getting company profile", "read"),
      operation("search", "Searching", "read"),
      operation("invite.list", "Listing invitations", "read"),
      operation("connections.list", "Listing connections", "read"),
      operation("posts.list", "Listing posts", "read"),
      operation("posts.get", "Getting post", "read"),
      operation("company.posts", "Listing company posts", "read"),
      operation("messages.send", "Sending message", "write"),
      operation("messages.start", "Starting conversation", "write"),
      operation("invite.send", "Sending invitation", "write"),
      operation("connections.remove", "Removing connection", "write"),
      operation("posts.create", "Creating post", "write"),
      operation("posts.comment", "Commenting on post", "write"),
      operation("posts.react", "Reacting to post", "write"),
      operation("company.post", "Creating company post", "write"),
    ],
  },
  {
    integrationType: "salesforce",
    displayName: "Salesforce",
    cliNames: ["salesforce"],
    operations: [
      operation("query", "Querying records", "read"),
      operation("get", "Getting record", "read"),
      operation("describe", "Getting object metadata", "read"),
      operation("objects", "Listing objects", "read"),
      operation("search", "Searching records", "read"),
      operation("create", "Creating record", "write"),
      operation("update", "Updating record", "write"),
    ],
  },
  {
    integrationType: "dynamics",
    displayName: "Microsoft Dynamics 365",
    cliNames: ["dynamics"],
    operations: [
      operation("whoami", "Getting current user", "read"),
      operation("tables.list", "Listing tables", "read"),
      operation("tables.get", "Getting table metadata", "read"),
      operation("rows.list", "Listing rows", "read"),
      operation("rows.get", "Getting row", "read"),
      operation("rows.create", "Creating row", "write"),
      operation("rows.update", "Updating row", "write"),
      operation("rows.delete", "Deleting row", "write"),
    ],
  },
] as const;

const catalogByIntegration = new Map(
  MANAGED_INTEGRATION_CATALOG.map((descriptor) => [descriptor.integrationType, descriptor]),
);

const catalogByCliName = new Map(
  MANAGED_INTEGRATION_CATALOG.flatMap((descriptor) =>
    descriptor.cliNames.map((cliName) => [cliName, descriptor] as const),
  ),
);

const operationByIntegration = new Map(
  MANAGED_INTEGRATION_CATALOG.map((descriptor) => [
    descriptor.integrationType,
    new Map(descriptor.operations.map((entry) => [entry.key, entry])),
  ]),
);

const operationByMcpToolName = new Map(
  MANAGED_INTEGRATION_CATALOG.flatMap((descriptor) =>
    descriptor.operations.flatMap((entry) =>
      (entry.mcpToolNames ?? []).map(
        (toolName) =>
          [
            toolName,
            {
              integrationType: descriptor.integrationType,
              operation: entry,
            },
          ] as const,
      ),
    ),
  ),
);

const GLOBAL_OPTIONS_WITH_VALUE = new Set(["--account"]);

const managedIntegrationTypeSet = new Set<string>(MANAGED_INTEGRATION_TYPES);

export type ParsedManagedIntegrationCommand = {
  integrationType: ManagedIntegrationType;
  operationKey: string;
  integrationDisplayName: string;
  operationLabel: string;
  accessHint: "read" | "write";
};

function commandBasename(token: string): string {
  const withoutTrailingSlash = token.replace(/\/+$/, "");
  return withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf("/") + 1);
}

function removeShellWrappers(parts: string[]): string[] {
  let cursor = 0;
  while (cursor < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[cursor] ?? "")) {
    cursor += 1;
  }

  const wrapper = commandBasename(parts[cursor] ?? "");
  if (wrapper === "command" || wrapper === "exec") {
    cursor += 1;
  } else if (wrapper === "sudo") {
    cursor += 1;
    while (parts[cursor]?.startsWith("-")) {
      cursor += 1;
    }
  } else if (wrapper === "env") {
    cursor += 1;
    while (parts[cursor]?.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[cursor] ?? "")) {
      cursor += 1;
    }
  }

  if (parts[cursor]) {
    parts[cursor] = commandBasename(parts[cursor]);
  }
  return parts.slice(cursor);
}

function removeLeadingGlobalOptions(parts: string[]): string[] {
  let cursor = 1;
  while (cursor < parts.length) {
    const part = parts[cursor];
    if (!part || part === "--") {
      cursor += 1;
      break;
    }
    if (!part.startsWith("-")) {
      break;
    }

    const [flag] = part.split("=", 1);
    cursor += flag && GLOBAL_OPTIONS_WITH_VALUE.has(flag) && !part.includes("=") ? 2 : 1;
  }
  return [parts[0] ?? "", ...parts.slice(cursor)];
}

function normalizeDirectSkillEntrypoint(parts: string[]): string[] {
  const runtime = commandBasename(parts[0] ?? "");
  let scriptIndex = 0;
  if (runtime === "tsx" || runtime === "node" || runtime === "bun") {
    scriptIndex = runtime === "bun" && parts[1] === "run" ? 2 : 1;
  }

  const script = parts[scriptIndex] ?? "";
  if (!script.includes("/skills/") || !/\.tsx?$/.test(script)) {
    return parts;
  }

  const cliName = commandBasename(script).replace(/\.tsx?$/, "");
  return [cliName, ...parts.slice(scriptIndex + 1)];
}

function canonicalizeOperation(
  integrationType: ManagedIntegrationType,
  parts: string[],
): string | null {
  const operationKey = parts[1];
  if (!operationKey) {
    return null;
  }

  if (integrationType === "hubspot" && parts[2]) {
    return operationKey === "owners" ? "owners" : `${operationKey}.${parts[2]}`;
  }
  if (integrationType === "outlook" && operationKey === "contacts" && parts[2]) {
    return `contacts.${parts[2]}`;
  }
  if (integrationType === "linkedin" && parts[2]) {
    return operationKey === "search" ? "search" : `${operationKey}.${parts[2]}`;
  }
  if (integrationType === "dynamics" && parts[2]) {
    return operationKey === "whoami" ? "whoami" : `${operationKey}.${parts[2]}`;
  }
  return operationKey;
}

function parseManagedIntegrationCliSegment(
  segment: string,
): ParsedManagedIntegrationCommand | null {
  const unwrapped = removeShellWrappers(segment.trim().split(/\s+/).filter(Boolean));
  const parts = removeLeadingGlobalOptions(normalizeDirectSkillEntrypoint(unwrapped));
  const descriptor = catalogByCliName.get(parts[0] ?? "");
  if (!descriptor) {
    return null;
  }

  const operationKey = canonicalizeOperation(descriptor.integrationType, parts);
  if (!operationKey) {
    return null;
  }
  const operationDescriptor = operationByIntegration
    .get(descriptor.integrationType)
    ?.get(operationKey);

  return {
    integrationType: descriptor.integrationType,
    operationKey,
    integrationDisplayName: descriptor.displayName,
    operationLabel: operationDescriptor?.label ?? operationKey,
    accessHint: operationDescriptor?.accessHint ?? "read",
  };
}

export function parseManagedIntegrationCliCommands(
  command: string,
): ParsedManagedIntegrationCommand[] {
  return command
    .split(/&&|\|\||;|\n/)
    .map((segment) => parseManagedIntegrationCliSegment(segment))
    .filter((entry): entry is ParsedManagedIntegrationCommand => entry !== null);
}

export function parseManagedIntegrationCliCommand(
  command: string,
): ParsedManagedIntegrationCommand | null {
  return parseManagedIntegrationCliCommands(command).at(-1) ?? null;
}

export function getManagedIntegrationDescriptor(
  integrationType: ManagedIntegrationType,
): ManagedIntegrationDescriptor {
  const descriptor = catalogByIntegration.get(integrationType);
  if (!descriptor) {
    throw new Error(`Unknown managed Integration Type: ${integrationType}`);
  }
  return descriptor;
}

export function getManagedOperationDescriptor(
  integrationType: ManagedIntegrationType,
  operationKey: string,
): ManagedOperationDescriptor | null {
  return operationByIntegration.get(integrationType)?.get(operationKey) ?? null;
}

export function resolveManagedMcpTool(toolName: string): {
  integrationType: ManagedIntegrationType;
  operationKey: string;
  operation: ManagedOperationDescriptor;
} | null {
  const match = operationByMcpToolName.get(toolName);
  return match
    ? {
        integrationType: match.integrationType,
        operationKey: match.operation.key,
        operation: match.operation,
      }
    : null;
}

export function managedOperationId(
  integrationType: ManagedIntegrationType,
  operationKey: string,
): string {
  return `${integrationType}:${operationKey}`;
}

export function isManagedIntegrationType(value: string): value is ManagedIntegrationType {
  return managedIntegrationTypeSet.has(value);
}
