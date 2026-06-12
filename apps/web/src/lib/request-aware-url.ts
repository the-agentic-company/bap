const INTERNAL_APP_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "localhost"]);
const PUBLIC_ORIGIN_HEADERS = ["x-bap-public-origin"];
const PUBLIC_HOST_SUFFIXES = [".heybap.com"];
const PUBLIC_HOSTNAMES = new Set(["heybap.com"]);

function toUrl(input: Request | URL | string): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function getConfiguredAppOrigin(): string | undefined {
  const candidate = process.env.APP_URL ?? process.env.VITE_APP_URL;
  if (!candidate) {
    return undefined;
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

function isAllowedForwardedHostname(hostname: string): boolean {
  if (isInternalAppHostname(hostname) || PUBLIC_HOSTNAMES.has(hostname)) {
    return true;
  }
  return PUBLIC_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isAllowedForwardedOrigin(origin: string): boolean {
  try {
    return isAllowedForwardedHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function getForwardedOrigin(request: Request): string | undefined {
  for (const header of PUBLIC_ORIGIN_HEADERS) {
    const value = request.headers.get(header)?.split(",")[0]?.trim();
    if (value && URL.canParse(value) && isAllowedForwardedOrigin(value)) {
      return new URL(value).origin;
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!forwardedHost) {
    return undefined;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "") || "https";
  if (forwardedProto !== "http" && forwardedProto !== "https") {
    return undefined;
  }

  try {
    const origin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
    return isAllowedForwardedOrigin(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
}

export function isInternalAppHostname(hostname: string): boolean {
  return INTERNAL_APP_HOSTNAMES.has(hostname);
}

export function getRequestAwareOrigin(input: Request | URL | string): string {
  if (input instanceof Request) {
    const forwardedOrigin = getForwardedOrigin(input);
    if (forwardedOrigin) {
      return forwardedOrigin;
    }
  }

  const url = toUrl(input);
  if (!isInternalAppHostname(url.hostname)) {
    return url.origin;
  }
  return getConfiguredAppOrigin() ?? url.origin;
}

export function buildRequestAwareUrl(target: string | URL, input: Request | URL | string): URL {
  const requestAwareOrigin = getRequestAwareOrigin(input);
  const resolved = new URL(target.toString(), requestAwareOrigin);

  if (!isInternalAppHostname(resolved.hostname)) {
    return resolved;
  }

  const configuredOrigin = getConfiguredAppOrigin();
  if (!configuredOrigin) {
    return resolved;
  }

  return new URL(`${resolved.pathname}${resolved.search}${resolved.hash}`, configuredOrigin);
}
