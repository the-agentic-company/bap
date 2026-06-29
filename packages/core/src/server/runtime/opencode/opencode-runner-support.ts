import type { RuntimeHarnessClient } from "../../sandbox/core/types";
import type { GenerationContext } from "../../services/generation/types";
import { generationLifecyclePolicy } from "../../services/lifecycle-policy";
import { extractOpenCodeMessageErrorFromSessionMessages } from "./opencode-runtime-driver";

export const OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS = 2;
export const OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS = 8_000;
export const OPENCODE_STATUS_POLL_INTERVAL_MS = 500;
export const RUNTIME_NO_PROGRESS_USER_MESSAGE =
  "The runtime stopped responding before producing any output. Please retry.";
export const RUNTIME_PROGRESS_STALLED_USER_MESSAGE =
  "The runtime stopped making progress. Please retry.";
export const SANDBOX_MISSING_USER_MESSAGE =
  "The sandbox stopped while this run was still active. Retry the task to continue.";
export const SANDBOX_CAPACITY_LIMIT_USER_MESSAGE =
  "Sandbox capacity limit reached for your organization. This run could not start. Please contact support to increase your capacity.";

export function resolveSandboxMissingUserMessage(ctx: GenerationContext): string {
  const originalErrorName = ctx.debugInfo?.originalErrorName;
  const originalErrorMessage = ctx.debugInfo?.originalErrorMessage;
  if (
    originalErrorName === "DaytonaValidationError" &&
    originalErrorMessage?.includes("limit exceeded")
  ) {
    return SANDBOX_CAPACITY_LIMIT_USER_MESSAGE;
  }
  return SANDBOX_MISSING_USER_MESSAGE;
}

export async function probeOpenCodeAssistantMessageError(input: {
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
}): Promise<string | null> {
  const result = await input.runtimeClient.messages({
    sessionID: input.sessionId,
    limit: 20,
  });
  if (result.error) {
    return null;
  }
  return extractOpenCodeMessageErrorFromSessionMessages(result.data);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = extractStructuredErrorMessage(error);
    if (message) {
      return message;
    }
    const json = safeJsonStringify(error);
    if (json) {
      return json;
    }
  }
  return String(error);
}

function extractStructuredErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  const nestedCandidates = [record.error, record.data, record.details];
  for (const candidate of nestedCandidates) {
    const nested = extractStructuredErrorMessage(candidate);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

export function isBootstrapTimeoutError(error: unknown): boolean {
  return formatErrorMessage(error).startsWith("Error: Agent preparation timed out after ");
}

export function resolveRuntimeNoProgressTimeoutMs(ctx: GenerationContext): number {
  const override = ctx.executionPolicy.debugRuntimeNoProgressTimeoutMs;
  if (override === undefined) {
    return generationLifecyclePolicy.runtimeProgressStallMs;
  }
  if (
    !Number.isInteger(override) ||
    override < 1_000 ||
    override > generationLifecyclePolicy.runtimeProgressStallMs
  ) {
    throw new Error(
      `debugRuntimeNoProgressTimeoutMs must be an integer between 1000 and ${generationLifecyclePolicy.runtimeProgressStallMs}`,
    );
  }
  return override;
}
