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

export function extractStructuredErrorMessage(error: unknown): string | null {
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

export function safeJsonStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

export function summarizeUnknownValue(value: unknown, maxLength = 500): string {
  const raw =
    typeof value === "string" ? value : (safeJsonStringify(value) ?? formatErrorMessage(value));
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}
