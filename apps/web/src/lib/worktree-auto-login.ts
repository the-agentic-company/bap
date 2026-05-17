import { sanitizeReturnPath } from "@/server/control-plane/return-path";

export const WORKTREE_AUTO_LOGIN_UNAVAILABLE_ERROR = "worktree_auto_login_unavailable";

const LOOPBACK_APP_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "::1", "[::1]", "localhost"]);

function toUrl(input: Request | URL | string): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function isLoopbackAppHostname(hostname: string): boolean {
  return LOOPBACK_APP_HOSTNAMES.has(hostname);
}

export function isWorktreeAutoLoginConfigured(): boolean {
  return Boolean(process.env.CMDCLAW_INSTANCE_ROOT?.trim());
}

export function canUseWorktreeAutoLoginForRequest(input: Request | URL | string): boolean {
  return isWorktreeAutoLoginConfigured() && isLoopbackAppHostname(toUrl(input).hostname);
}

export function buildWorktreeAutoLoginPath(callbackUrl: string, fallback = "/chat"): string {
  const sanitizedCallbackUrl = sanitizeReturnPath(callbackUrl, fallback);
  return `/api/dev/worktree-auth?callbackUrl=${encodeURIComponent(sanitizedCallbackUrl)}`;
}
