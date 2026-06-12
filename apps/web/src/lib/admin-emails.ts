export const INVITE_ONLY_LOGIN_ERROR = "invite_only";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseEmailList(value: string | undefined): string[] {
  return value?.split(",").map(normalizeEmail).filter(Boolean) ?? [];
}

function resolveAdminEmails(): Set<string> {
  const configured = parseEmailList(process.env.APP_ADMIN_EMAILS);
  if (configured.length > 0) {
    return new Set(configured);
  }

  return new Set(parseEmailList(process.env.APP_DEFAULT_USER_EMAIL));
}

export function shouldGrantAdminRole(email: string): boolean {
  return resolveAdminEmails().has(normalizeEmail(email));
}

export function getAdminEmails(): string[] {
  return [...resolveAdminEmails()].toSorted();
}

export function normalizeAdminEmail(email: string): string {
  return normalizeEmail(email);
}
