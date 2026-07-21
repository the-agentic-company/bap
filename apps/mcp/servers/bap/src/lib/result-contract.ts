type BapToolErrorCategory =
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

function includesAny(message: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => message.includes(candidate));
}

function classifyError(error: unknown): BapToolErrorCategory {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (includesAny(message, ["not found", "no conversation"])) return "not_found";
  if (includesAny(message, ["forbidden", "unauthorized", "belong"])) return "forbidden";
  if (includesAny(message, ["conflict", "cannot be", "only a"])) return "conflict";
  if (includesAny(message, ["auth", "user input"])) return "user_action_required";
  if (includesAny(message, ["requires", "must", "include", "supported"])) return "invalid_input";
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
