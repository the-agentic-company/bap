const LOCALCAN_HOST_SUFFIX = ".localcan.dev";

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function parseForwardedHeader(value: string | null): { host?: string; proto?: string } {
  const first = firstHeaderValue(value);
  if (!first) {
    return {};
  }

  const result: { host?: string; proto?: string } = {};
  for (const part of first.split(";")) {
    const [rawKey, rawValue] = part.split("=", 2);
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim().replace(/^"|"$/g, "");
    if (!key || !value) {
      continue;
    }
    if (key === "host") {
      result.host = value;
    } else if (key === "proto") {
      result.proto = value;
    }
  }

  return result;
}

function normalizeProtocol(value: string | null | undefined): "http" | "https" | null {
  const normalized = value?.trim().replace(/:$/, "").toLowerCase();
  return normalized === "http" || normalized === "https" ? normalized : null;
}

function originFromParts(protocol: string, host: string): string | null {
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

export function resolveGatewayPublicOrigin(request: Request, requestUrl = new URL(request.url)) {
  const explicit = firstHeaderValue(request.headers.get("x-bap-public-origin"));
  if (explicit && URL.canParse(explicit)) {
    return new URL(explicit).origin;
  }

  const forwarded = parseForwardedHeader(request.headers.get("forwarded"));
  const forwardedHost = forwarded.host ?? firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto =
    forwarded.proto ?? firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost ?? requestUrl.host;
  const requestedProtocol = normalizeProtocol(requestUrl.protocol);
  let protocol = normalizeProtocol(forwardedProto) ?? requestedProtocol ?? "http";

  if (!forwardedProto && protocol === "http" && host.endsWith(LOCALCAN_HOST_SUFFIX)) {
    protocol = "https";
  }

  return originFromParts(protocol, host) ?? requestUrl.origin;
}
