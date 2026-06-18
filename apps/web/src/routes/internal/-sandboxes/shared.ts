export type Provider = "e2b" | "daytona";

export function formatRelativeTime(value: Date | string | null) {
  if (!value) {
    return "--";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleString();
}

export function formatUptime(startedAt: Date | string | null) {
  if (!startedAt) {
    return "--";
  }
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(start.getTime())) {
    return "--";
  }
  const diffMs = Date.now() - start.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

export function truncateId(id: string) {
  return id.length > 12 ? `${id.slice(0, 12)}...` : id;
}

export function formatCredits(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (n >= 10) {
    return n.toFixed(0);
  }
  return n.toFixed(1);
}

export function getEnvBaseUrl(env: string | null): string {
  switch (env) {
    case "prod":
      return "https://heybap.com";
    case "staging":
      return "https://staging.heybap.com";
    default:
      return "";
  }
}

export const ENV_COLORS: Record<string, string> = {
  dev: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  staging: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  prod: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export const PROVIDER_META: Record<
  Provider,
  { label: string; dotClass: string; pillClass: string; stroke: string; fill: string }
> = {
  e2b: {
    label: "E2B",
    dotClass: "bg-violet-500",
    pillClass:
      "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/20",
    stroke: "var(--color-violet-500, #8b5cf6)",
    fill: "var(--color-violet-500, #8b5cf6)",
  },
  daytona: {
    label: "Daytona",
    dotClass: "bg-amber-500",
    pillClass:
      "bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20",
    stroke: "var(--color-amber-500, #f59e0b)",
    fill: "var(--color-amber-500, #f59e0b)",
  },
};

export type SandboxRow = {
  provider: Provider;
  sandboxId: string;
  templateId: string | null;
  state: "running" | "paused" | "stopped" | "error" | "unknown";
  startedAt: Date | string | null;
  endAt: Date | string | null;
  cpuCount: number | null;
  memoryMB: number | null;
  metadata: Record<string, string>;
  environment: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  conversationType: string | null;
  model: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  coworkerName: string | null;
  coworkerUsername: string | null;
  coworkerTriggerType: string | null;
  coworkerId: string | null;
};

export type SortKey =
  | "provider"
  | "sandboxId"
  | "environment"
  | "state"
  | "startedAt"
  | "userEmail"
  | "details";
export type SortDir = "asc" | "desc";

export function getDetailsText(row: SandboxRow): string {
  if (row.conversationType === "coworker") {
    return row.coworkerUsername ?? row.coworkerName ?? "coworker";
  }
  if (row.conversationType === "chat") {
    return row.conversationTitle ?? "chat";
  }
  return row.conversationType ?? "";
}

export function getSortValue(row: SandboxRow, key: SortKey): string | number {
  switch (key) {
    case "provider":
      return row.provider;
    case "sandboxId":
      return row.sandboxId;
    case "environment":
      return row.environment ?? "";
    case "state":
      return row.state;
    case "startedAt":
      return row.startedAt ? new Date(row.startedAt).getTime() : 0;
    case "userEmail":
      return row.userEmail ?? "";
    case "details":
      return getDetailsText(row);
  }
}

export type ConfirmState = {
  title: string;
  description: string;
  action: () => Promise<void>;
} | null;
