import { getMcpServerDefinition } from "../../shared/registry";

export type RoutedMcpRequest = {
  slug: string;
  target: URL;
};

const WELL_KNOWN_PREFIX = "/.well-known/oauth-protected-resource";

export function matchProtectedResourceMetadataRequest(requestUrl: URL): { slug: string } | null {
  const specMatch = requestUrl.pathname.match(
    /^\/\.well-known\/oauth-protected-resource\/([^/]+)\/?$/,
  );
  if (specMatch?.[1]) {
    const slug = specMatch[1];
    return getMcpServerDefinition(slug) ? { slug } : null;
  }

  const legacySpecMatch = requestUrl.pathname.match(
    /^\/\.well-known\/oauth-protected-resource\/([^/]+)\/mcp\/?$/,
  );
  if (legacySpecMatch?.[1]) {
    const slug = legacySpecMatch[1];
    return getMcpServerDefinition(slug) ? { slug } : null;
  }

  const legacyMatch = requestUrl.pathname.match(
    /^\/([^/]+)\/\.well-known\/oauth-protected-resource\/?$/,
  );
  if (legacyMatch?.[1]) {
    const slug = legacyMatch[1];
    return getMcpServerDefinition(slug) ? { slug } : null;
  }

  return null;
}

function normalizeProxyPath(pathname: string): string {
  if (pathname === "/mcp" || pathname.startsWith("/auth/")) {
    return pathname;
  }

  if (pathname.startsWith("/mcp/") || pathname.startsWith(`${WELL_KNOWN_PREFIX}/`)) {
    return pathname;
  }

  return `/mcp${pathname}`;
}

export function routeMcpRequest(
  requestUrl: URL,
  env: Record<string, string | undefined>,
): RoutedMcpRequest | null {
  const segments = requestUrl.pathname.split("/").filter(Boolean);
  const [slug, ...rest] = segments;
  if (!slug) {
    return null;
  }

  const server = getMcpServerDefinition(slug);
  if (!server) {
    return null;
  }

  if (slug === "modulr" && rest.join("/") === "documents/download") {
    return null;
  }

  const targetBase = env[server.internalTargetEnvVar]?.trim();
  if (!targetBase) {
    throw new Error(`Missing target for MCP server "${slug}" (${server.internalTargetEnvVar}).`);
  }

  const downstreamPath = normalizeProxyPath(`/${rest.join("/") || "mcp"}`);
  const target = new URL(downstreamPath + requestUrl.search, targetBase);

  return {
    slug,
    target,
  };
}
