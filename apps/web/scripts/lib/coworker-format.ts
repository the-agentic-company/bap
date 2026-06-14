import { extname } from "node:path";
import { formatPersistedChatTranscript } from "../../src/components/chat/chat-transcript";

export type CoworkerFormat = "text" | "markdown" | "json";

export const TERMINAL_STATUSES = new Set(["completed", "cancelled", "error", "success", "failed"]);

export function splitCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

export function inferMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".html":
    case ".htm":
      return "text/html";
    case ".csv":
      return "text/csv";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    on: "[ON]",
    off: "[OFF]",
    running: "[RUNNING]",
    completed: "[DONE]",
    success: "[DONE]",
    failed: "[FAILED]",
    error: "[ERROR]",
    cancelled: "[CANCELLED]",
    awaiting_approval: "[AWAITING APPROVAL]",
    awaiting_auth: "[AWAITING AUTH]",
    needs_user_input: "[NEEDS YOUR INPUT]",
  };
  return badges[status] ?? `[${status.toUpperCase()}]`;
}

export function parsePayload(payload: string | undefined): unknown {
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid JSON for --payload");
  }
}

export type CoworkerDetails = {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  autoApprove: boolean;
  model: string;
  authSource: string | null;
  triggerType: string;
  prompt: string;
  promptDo: string | null;
  promptDont: string | null;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
  toolAccessMode: string;
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  allowedSkillSlugs: string[];
  schedule: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  runs: Array<{
    id: string;
    status: string;
    startedAt: Date | string;
    finishedAt: Date | string | null;
    errorMessage: string | null;
  }>;
};

export function printCoworkerSummary(coworker: {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  triggerType: string;
  schedule?: unknown;
  lastRunStatus?: string | null;
  lastRunAt?: Date | string | null;
}): void {
  const displayName = coworker.name.trim() || "(unnamed)";
  const lastRun = coworker.lastRunStatus
    ? ` | last run: ${statusBadge(coworker.lastRunStatus)} ${formatDate(coworker.lastRunAt)}`
    : "";

  console.log(`${statusBadge(coworker.status)} ${displayName}`);
  console.log(`  id: ${coworker.id}`);
  console.log(`  username: ${coworker.username ? `@${coworker.username}` : "-"}`);
  console.log(`  description: ${coworker.description ?? "-"}`);
  console.log(`  trigger: ${coworker.triggerType}${lastRun}`);
  if (coworker.schedule) {
    console.log(`  schedule: ${JSON.stringify(coworker.schedule)}`);
  }
  console.log("");
}

export function formatCoworkerDetailsMarkdown(details: CoworkerDetails): string {
  const lines = [
    `# ${details.name.trim() || "Unnamed Coworker"}`,
    "",
    `- ID: \`${details.id}\``,
    `- Status: ${details.status}`,
    `- Username: ${details.username ? `@${details.username}` : "-"}`,
    `- Description: ${details.description ?? "-"}`,
    `- Trigger: ${details.triggerType}`,
    `- Tool Access Mode: ${details.toolAccessMode}`,
    `- Auto Approve: ${details.autoApprove ? "yes" : "no"}`,
    `- Needs User Input: ${details.requiresUserInput ? "yes" : "no"}`,
    `- Created: ${formatDate(details.createdAt)}`,
    `- Updated: ${formatDate(details.updatedAt)}`,
    `- Allowed Integrations: ${details.allowedIntegrations.join(", ") || "-"}`,
    `- Custom Integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`,
    `- Allowed Skills: ${details.allowedSkillSlugs.join(", ") || "-"}`,
    "",
    "## Prompt",
    "",
    details.prompt || "(empty)",
  ];

  if (details.promptDo) {
    lines.push("", "## Prompt Do", "", details.promptDo);
  }
  if (details.promptDont) {
    lines.push("", "## Prompt Don't", "", details.promptDont);
  }
  if (details.userInputPrompt) {
    lines.push("", "## User Input Prompt", "", details.userInputPrompt);
  }
  if (details.schedule) {
    lines.push("", "## Schedule", "", "```json", JSON.stringify(details.schedule, null, 2), "```");
  }
  if (details.runs.length > 0) {
    lines.push("", "## Recent Runs", "");
    for (const run of details.runs) {
      lines.push(
        `- \`${run.id}\` ${statusBadge(run.status)} started ${formatDate(run.startedAt)}${run.finishedAt ? `, finished ${formatDate(run.finishedAt)}` : ""}${run.errorMessage ? `, error: ${run.errorMessage}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function printCoworkerDetails(
  details: CoworkerDetails,
  format: CoworkerFormat = "text",
): void {
  if (format === "json") {
    console.log(JSON.stringify(details, null, 2));
    return;
  }

  if (format === "markdown") {
    console.log(formatCoworkerDetailsMarkdown(details));
    return;
  }

  console.log(`${statusBadge(details.status)} ${details.name.trim() || "(unnamed)"}`);
  console.log(`  id: ${details.id}`);
  console.log(`  username: ${details.username ? `@${details.username}` : "-"}`);
  console.log(`  description: ${details.description ?? "-"}`);
  console.log(`  trigger: ${details.triggerType}`);
  console.log(`  model: ${details.model}`);
  console.log(`  auth source: ${details.authSource ?? "-"}`);
  console.log(`  tool access: ${details.toolAccessMode}`);
  console.log(`  auto approve: ${details.autoApprove ? "yes" : "no"}`);
  console.log(`  needs user input: ${details.requiresUserInput ? "yes" : "no"}`);
  if (details.userInputPrompt) {
    console.log(`  user input prompt: ${details.userInputPrompt}`);
  }
  console.log(`  created: ${formatDate(details.createdAt)}`);
  console.log(`  updated: ${formatDate(details.updatedAt)}`);
  console.log(`  allowed integrations: ${details.allowedIntegrations.join(", ") || "-"}`);
  console.log(`  custom integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`);
  console.log(`  allowed skills: ${details.allowedSkillSlugs.join(", ") || "-"}`);
  console.log(`  prompt: ${details.prompt || "(empty)"}`);
  if (details.promptDo) {
    console.log(`  prompt do: ${details.promptDo}`);
  }
  if (details.promptDont) {
    console.log(`  prompt don't: ${details.promptDont}`);
  }
  if (details.schedule) {
    console.log(`  schedule: ${JSON.stringify(details.schedule)}`);
  }
  if (details.runs.length > 0) {
    console.log("  recent runs:");
    for (const run of details.runs) {
      const finishedAt = run.finishedAt ? ` | finished ${formatDate(run.finishedAt)}` : "";
      const errorMessage = run.errorMessage ? ` | error: ${run.errorMessage}` : "";
      console.log(
        `    - ${statusBadge(run.status)} ${run.id} | started ${formatDate(run.startedAt)}${finishedAt}${errorMessage}`,
      );
    }
  }
}

export function formatConversationTranscript(
  messages: Array<{
    id: string;
    role: string;
    content: string;
    contentParts: unknown[] | null;
    attachments: Array<{ filename: string; mimeType: string }>;
    sandboxFiles: Array<{ path: string; filename: string; mimeType: string; fileId: string }>;
  }>,
): string {
  const transcriptMessages = messages.map((message) => ({
    ...message,
    contentParts: message.contentParts ?? undefined,
  })) as Parameters<typeof formatPersistedChatTranscript>[0];

  return formatPersistedChatTranscript(transcriptMessages);
}

export function formatToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
