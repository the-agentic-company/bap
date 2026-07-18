export type BapToolErrorCategory =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "user_action_required"
  | "upstream_failure";

type ResultRecord = Record<string, unknown>;

function asResultRecord(value: unknown): ResultRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ResultRecord)
    : { value };
}

function classifyError(error: unknown): BapToolErrorCategory {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("not found") || message.includes("no conversation")) return "not_found";
  if (
    message.includes("forbidden") ||
    message.includes("unauthorized") ||
    message.includes("belong")
  ) {
    return "forbidden";
  }
  if (message.includes("conflict") || message.includes("cannot be") || message.includes("only a")) {
    return "conflict";
  }
  if (message.includes("auth") || message.includes("user input")) return "user_action_required";
  if (
    message.includes("requires") ||
    message.includes("must") ||
    message.includes("include") ||
    message.includes("supported")
  ) {
    return "invalid_input";
  }
  return "upstream_failure";
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The Bap operation failed.";
  return error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+(?:token|signature|credential|code)=[^\s&]+/gi, "[redacted URL]");
}

export function buildBapToolResult(params: {
  action: string;
  workspaceId?: string;
  result: unknown;
}) {
  const source = asResultRecord(params.result);
  const { status = "completed", workspaceId: resultWorkspaceId, nextCursor, ...data } = source;
  return {
    status,
    ...((params.workspaceId ?? resultWorkspaceId)
      ? { workspaceId: params.workspaceId ?? resultWorkspaceId }
      : {}),
    action: params.action,
    data,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function buildBapToolError(params: {
  action: string;
  workspaceId?: string;
  error: unknown;
}) {
  const category = classifyError(params.error);
  return {
    status: "failed" as const,
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    action: params.action,
    error: {
      category,
      message: safeErrorMessage(params.error),
      retryable: category === "upstream_failure",
    },
  };
}
