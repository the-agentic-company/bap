export function toCredentialExpiryDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCredentialExpiry(value: Date | string | null | undefined): string | null {
  const date = toCredentialExpiryDate(value);
  if (!date) {
    return null;
  }

  const formatted = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return date.getTime() <= Date.now() ? `Expired on ${formatted}` : `Expires on ${formatted}`;
}

export function formatCredentialExpiryShort(value: Date | string | null | undefined): string | null {
  const date = toCredentialExpiryDate(value);
  if (!date) {
    return null;
  }

  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.getTime() <= Date.now() ? `Expired ${label}` : `Expires ${label}`;
}

export function toDateInputValue(value: Date | string | null | undefined): string {
  const date = toCredentialExpiryDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}
