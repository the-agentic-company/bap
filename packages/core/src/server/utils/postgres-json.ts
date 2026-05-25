const POSTGRES_NUL_BYTE = /\u0000/g;

export function sanitizePostgresText(value: string): string {
  return value.replace(POSTGRES_NUL_BYTE, "\uFFFD");
}

export function sanitizeJsonForPostgres<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizePostgresText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonForPostgres(item)) as T;
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = sanitizeJsonForPostgres(entry);
    }
    return sanitized as T;
  }

  return value;
}
