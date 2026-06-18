/**
 * Pure LinkedIn / Unipile identifier normalization.
 *
 * These functions are the stable test surface for the skill: they turn the many
 * shapes a caller might pass (full profile URL, company URL, bare handle, raw DSN)
 * into the canonical identifier the Unipile endpoints expect. No I/O.
 */

/**
 * Turn a raw Unipile DSN into the API base URL, tolerating leading scheme and
 * trailing slashes. Returns "" when the DSN is empty (the caller treats that as
 * "not configured").
 */
export function buildUnipileBaseUrl(dsn: string): string {
  const normalizedDsn = dsn
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return normalizedDsn ? `https://${normalizedDsn}/api/v1` : "";
}

/**
 * Extract the public profile handle from a `linkedin.com/in/<handle>` URL, or pass
 * through a bare handle unchanged. Returns null for empty input or a non-LinkedIn
 * absolute URL (which has no extractable handle).
 */
export function normalizeLinkedInProfileIdentifier(raw: unknown): string | null {
  return normalizeLinkedInPath(raw, /linkedin\.com\/in\/([^/?#]+)/i);
}

/**
 * Extract the company slug from a `linkedin.com/company/<slug>` URL, or pass through
 * a bare slug unchanged. Same null semantics as the profile normalizer.
 */
export function normalizeLinkedInCompanyIdentifier(raw: unknown): string | null {
  return normalizeLinkedInPath(raw, /linkedin\.com\/company\/([^/?#]+)/i);
}

function normalizeLinkedInPath(raw: unknown, pathPattern: RegExp): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }

  const pathMatch = value.match(pathPattern);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return null;
  }

  return value;
}
