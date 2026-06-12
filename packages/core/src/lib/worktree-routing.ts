export const DEFAULT_LOCALCAN_CALLBACK_BASE_URL = "https://localcan.baptistecolle.com";
export const WORKTREE_PUBLIC_ROUTE_PREFIX = "/__worktrees";

type PublicCallbackBaseInput = {
  callbackBaseUrl?: string | null;
  appUrl?: string | null;
  viteAppUrl?: string | null;
  nodeEnv?: string | null;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseUrl(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0";
}

export function resolvePublicCallbackBaseUrl(input: PublicCallbackBaseInput): string {
  const candidates = [input.callbackBaseUrl, input.appUrl, input.viteAppUrl];
  const parsedCandidates = candidates
    .map((candidate) => {
      const parsed = parseUrl(candidate);
      return parsed
        ? {
            raw: candidate!.trim(),
            parsed,
          }
        : null;
    })
    .filter((candidate): candidate is { raw: string; parsed: URL } => candidate !== null);

  const publicCandidate = parsedCandidates.find(({ parsed }) => !isLoopbackHost(parsed.hostname));
  if (publicCandidate) {
    return trimTrailingSlash(publicCandidate.raw);
  }

  const firstCandidate = parsedCandidates[0];
  if (firstCandidate) {
    if (input.nodeEnv !== "production" && isLoopbackHost(firstCandidate.parsed.hostname)) {
      return DEFAULT_LOCALCAN_CALLBACK_BASE_URL;
    }
    return trimTrailingSlash(firstCandidate.raw);
  }

  return input.nodeEnv !== "production" ? DEFAULT_LOCALCAN_CALLBACK_BASE_URL : "";
}

export function buildWorktreePublicCallbackBaseUrl(
  input: PublicCallbackBaseInput & { instanceId: string },
): string {
  const baseUrl = resolvePublicCallbackBaseUrl(input);
  if (!baseUrl) {
    return "";
  }

  const parsed = new URL(baseUrl);
  const routePrefix = `${WORKTREE_PUBLIC_ROUTE_PREFIX}/${encodeURIComponent(input.instanceId)}`;
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath === routePrefix) {
    return trimTrailingSlash(parsed.toString());
  }

  parsed.pathname = `${normalizedPath}${routePrefix}`.replace(/\/{2,}/g, "/");
  return trimTrailingSlash(parsed.toString());
}

export function matchWorktreePublicRoute(
  pathname: string,
): { instanceId: string; forwardedPath: string } | null {
  const prefix = `${WORKTREE_PUBLIC_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const remainder = pathname.slice(prefix.length);
  const [encodedInstanceId, ...rest] = remainder.split("/");
  if (!encodedInstanceId) {
    return null;
  }

  let instanceId: string;
  try {
    instanceId = decodeURIComponent(encodedInstanceId);
  } catch {
    return null;
  }

  return {
    instanceId,
    forwardedPath: `/${rest.join("/")}`.replace(/\/{2,}/g, "/") || "/",
  };
}
