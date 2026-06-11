const DEFAULT_LOCAL_ZERO_CACHE_PORT = "4848";
const DEFAULT_LOCAL_ZERO_QUERY_HOST = "host.docker.internal";

export type BrowserLocation = Pick<Location, "hostname" | "port">;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveZeroCacheURL(
  configuredURL: string | undefined,
  location: BrowserLocation | undefined,
): string | undefined {
  if (configuredURL) {
    return configuredURL;
  }

  if (!location || !isLoopbackHostname(location.hostname)) {
    return undefined;
  }

  return `http://${location.hostname}:${DEFAULT_LOCAL_ZERO_CACHE_PORT}`;
}

export function resolveZeroQueryURL(
  configuredURL: string | undefined,
  location: BrowserLocation | undefined,
): string | undefined {
  if (configuredURL) {
    return configuredURL;
  }

  if (!location || !isLoopbackHostname(location.hostname)) {
    return undefined;
  }

  const appPort = location.port || "3000";
  return `http://${DEFAULT_LOCAL_ZERO_QUERY_HOST}:${appPort}/api/zero/query`;
}
