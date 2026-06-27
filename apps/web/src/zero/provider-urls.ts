const DEFAULT_LOCAL_ZERO_CACHE_PORT = "4848";

export type BrowserLocation = Pick<Location, "host" | "hostname" | "port" | "protocol">;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function formatUrlHostname(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

export function resolveZeroCacheURL(
  configuredURL: string | undefined,
  location: BrowserLocation | undefined,
): string | undefined {
  if (configuredURL) {
    return configuredURL;
  }

  if (!location) {
    return undefined;
  }

  if (isLoopbackHostname(location.hostname)) {
    return `http://${formatUrlHostname(location.hostname)}:${DEFAULT_LOCAL_ZERO_CACHE_PORT}`;
  }

  return `${location.protocol}//${location.host}/zero`;
}

export function resolveZeroQueryURL(
  configuredURL: string | undefined,
  location: BrowserLocation | undefined,
): string | undefined {
  if (configuredURL) {
    return configuredURL;
  }

  if (!location) {
    return undefined;
  }

  return `${location.protocol}//${location.host}/api/zero/query`;
}
