const INTERNAL_APP_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "localhost"]);

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

export function isInternalAppHostname(hostname: string): boolean {
  return INTERNAL_APP_HOSTNAMES.has(hostname);
}

export function getRequestAwareOrigin(input: Request | URL | string): string {
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
