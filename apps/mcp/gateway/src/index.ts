import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolveGatewayPublicOrigin } from "./public-origin";
import { matchProtectedResourceMetadataRequest, routeMcpRequest } from "./router";
import { shouldManageGatewayChildren, startManagedGatewayChildren } from "./supervisor";
import {
  buildProtectedResourceMetadataPath,
  getMcpServerDefinition,
  MCP_SERVER_REGISTRY,
  type McpServerSlug,
} from "../../shared/registry";

const port = Number.parseInt(process.env.MCP_GATEWAY_PORT ?? process.env.PORT ?? "3010", 10);
const hostname = process.env.HOST ?? "0.0.0.0";
const publicHostname = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
const GATEWAY_AUTHORIZATION_PATH = "/authorize";
const GATEWAY_TOKEN_PATH = "/token";
const GATEWAY_REGISTER_PATH = "/register";
const GATEWAY_AUTH_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
const GATEWAY_OPENID_CONFIGURATION_PATH = "/.well-known/openid-configuration";
const GATEWAY_AUTHORIZATION_ENDPOINT = "authorize";
const GATEWAY_TOKEN_ENDPOINT = "token";
const GATEWAY_REGISTER_ENDPOINT = "register";

type ListeningProcess = {
  pid: number;
  command: string | null;
};

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function getListeningProcess(port: number): ListeningProcess | null {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  let pid: number | null = null;
  let command: string | null = null;

  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("p") && pid === null) {
      const value = Number.parseInt(line.slice(1), 10);
      if (!Number.isNaN(value)) {
        pid = value;
      }
      continue;
    }

    if (line.startsWith("c") && command === null) {
      command = line.slice(1) || null;
    }

    if (pid !== null && command !== null) {
      break;
    }
  }

  if (pid === null) {
    return null;
  }

  return { pid, command };
}

async function assertGatewayPortAvailable(port: number, host: string) {
  if (await isPortAvailable(port, host)) {
    return;
  }

  const processInfo = getListeningProcess(port);
  if (processInfo) {
    const commandSuffix = processInfo.command ? ` (${processInfo.command})` : "";
    throw new Error(
      `Gateway port ${port} is already in use by PID ${processInfo.pid}${commandSuffix}. Kill it with: kill ${processInfo.pid}`,
    );
  }

  throw new Error(
    `Gateway port ${port} is already in use. Run: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
  );
}

function resolveAuthorizationServerOrigin(requestUrl: URL): string {
  const configured =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CMDCLAW_SERVER_URL?.trim();

  if (configured && URL.canParse(configured)) {
    return new URL(configured).origin;
  }

  return requestUrl.origin;
}

function getGatewayCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");

  return {
    "Access-Control-Allow-Origin": origin?.trim() || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Expose-Headers": "WWW-Authenticate",
    Vary: "Origin",
  };
}

function withGatewayCors(request: Request, response: Response): Response {
  const next = new Response(response.body, response);
  const headers = getGatewayCorsHeaders(request);
  Object.entries(headers).forEach(([key, value]) => {
    next.headers.set(key, value);
  });
  return next;
}

function resolveScopedOAuthPath(
  pathname: string,
  endpoint: string,
): { slug: McpServerSlug } | null {
  const match = pathname.match(new RegExp(`^/([^/]+)/${endpoint}/?$`));
  const slug = match?.[1];
  if (!slug || !getMcpServerDefinition(slug)) {
    return null;
  }
  return { slug: slug as McpServerSlug };
}

function resolveScopedAuthorizationServerMetadataPath(
  pathname: string,
): { slug: McpServerSlug } | null {
  const specMatch = pathname.match(
    /^\/\.well-known\/(?:oauth-authorization-server|openid-configuration)\/([^/]+)\/?$/,
  );
  const specSlug = specMatch?.[1];
  if (specSlug && getMcpServerDefinition(specSlug)) {
    return { slug: specSlug as McpServerSlug };
  }

  const legacyMatch = pathname.match(
    /^\/([^/]+)\/\.well-known\/(?:oauth-authorization-server|openid-configuration)\/?$/,
  );
  const legacySlug = legacyMatch?.[1];
  if (legacySlug && getMcpServerDefinition(legacySlug)) {
    return { slug: legacySlug as McpServerSlug };
  }

  return null;
}

function buildGatewayAuthorizationServerMetadata(publicOrigin: string, slug?: McpServerSlug) {
  const issuer = slug
    ? new URL(MCP_SERVER_REGISTRY[slug].publicBasePath, publicOrigin).toString()
    : publicOrigin;
  const endpointPrefix = slug ? `${MCP_SERVER_REGISTRY[slug].publicBasePath}` : "";

  return {
    issuer,
    authorization_endpoint: new URL(
      `${endpointPrefix}${GATEWAY_AUTHORIZATION_PATH}`,
      publicOrigin,
    ).toString(),
    token_endpoint: new URL(`${endpointPrefix}${GATEWAY_TOKEN_PATH}`, publicOrigin).toString(),
    registration_endpoint: new URL(
      `${endpointPrefix}${GATEWAY_REGISTER_PATH}`,
      publicOrigin,
    ).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: slug ? [slug] : Object.keys(MCP_SERVER_REGISTRY),
  };
}

function buildProtectedResourceMetadata(
  publicOrigin: string,
  slug: keyof typeof MCP_SERVER_REGISTRY,
) {
  const server = MCP_SERVER_REGISTRY[slug];
  return {
    resource: new URL(server.publicBasePath, publicOrigin).toString(),
    authorization_servers: [new URL(server.publicBasePath, publicOrigin).toString()],
    scopes_supported: [slug],
    resource_name: server.name,
  };
}

function buildScopedAppProxyRequest(
  request: Request,
  targetPath: string,
  requestUrl: URL,
  publicOrigin: string,
  slug: McpServerSlug,
): Request {
  const scopedRequestUrl = new URL(requestUrl);
  if (!scopedRequestUrl.searchParams.has("resource")) {
    scopedRequestUrl.searchParams.set(
      "resource",
      new URL(MCP_SERVER_REGISTRY[slug].publicBasePath, publicOrigin).toString(),
    );
  }

  return buildAppProxyRequest(request, targetPath, scopedRequestUrl, publicOrigin);
}

function buildProxyRequest(request: Request, target: URL, publicOrigin: string): Request {
  const publicOriginUrl = new URL(publicOrigin);
  const headers = new Headers(request.headers);
  headers.set("host", target.host);
  headers.set("x-cmdclaw-public-origin", publicOrigin);
  headers.set("x-forwarded-host", publicOriginUrl.host);
  headers.set("x-forwarded-proto", publicOriginUrl.protocol.replace(":", ""));
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
    redirect: "manual",
  } as RequestInit & { duplex: "half" });
}

function buildAppProxyRequest(
  request: Request,
  targetPath: string,
  requestUrl: URL,
  publicOrigin: string,
): Request {
  const appOrigin = resolveAuthorizationServerOrigin(requestUrl);
  const target = new URL(targetPath + requestUrl.search, appOrigin);

  return buildProxyRequest(request, target, publicOrigin);
}

async function main() {
  let routingEnv: Record<string, string | undefined> = { ...process.env };
  let shutdownManagedChildren: (() => void) | null = null;

  await assertGatewayPortAvailable(port, hostname);

  if (shouldManageGatewayChildren(process.env)) {
    const managedChildren = await startManagedGatewayChildren({
      env: process.env,
      rootDir: process.cwd(),
    });
    routingEnv = {
      ...routingEnv,
      ...managedChildren.targetEnv,
    };
    shutdownManagedChildren = managedChildren.shutdown;
    console.log(
      `[gateway] managing children: ${managedChildren.children
        .map((child) => `${child.slug}@${child.target}`)
        .join(", ")}`,
    );
  }

  let server: ReturnType<typeof Bun.serve> | null = null;
  try {
    server = Bun.serve({
      port,
      hostname,
      async fetch(request) {
        const requestUrl = new URL(request.url);
        const publicOrigin = resolveGatewayPublicOrigin(request, requestUrl);

        if (request.method === "OPTIONS") {
          return withGatewayCors(request, new Response(null, { status: 204 }));
        }

        if (requestUrl.pathname === "/" || requestUrl.pathname === "") {
          return withGatewayCors(
            request,
            Response.json({
              ok: true,
              servers: Object.keys(MCP_SERVER_REGISTRY),
              managedChildren: shouldManageGatewayChildren(process.env),
              authorizationServer: `${publicOrigin}${GATEWAY_AUTH_SERVER_METADATA_PATH}`,
              protectedResources: Object.keys(MCP_SERVER_REGISTRY).map((slug) =>
                new URL(
                  buildProtectedResourceMetadataPath(slug as keyof typeof MCP_SERVER_REGISTRY),
                  publicOrigin,
                ).toString(),
              ),
              targets: Object.fromEntries(
                Object.entries(routingEnv).filter(
                  ([key]) => key.startsWith("CMDCLAW_") && key.endsWith("_MCP_TARGET"),
                ),
              ),
            }),
          );
        }

        const scopedAuthorizationServerMetadata = resolveScopedAuthorizationServerMetadataPath(
          requestUrl.pathname,
        );
        if (scopedAuthorizationServerMetadata) {
          return withGatewayCors(
            request,
            Response.json(
              buildGatewayAuthorizationServerMetadata(
                publicOrigin,
                scopedAuthorizationServerMetadata.slug,
              ),
              {
                headers: {
                  "Cache-Control": "no-store",
                },
              },
            ),
          );
        }

        if (
          requestUrl.pathname === GATEWAY_AUTH_SERVER_METADATA_PATH ||
          requestUrl.pathname === GATEWAY_OPENID_CONFIGURATION_PATH
        ) {
          return withGatewayCors(
            request,
            Response.json(buildGatewayAuthorizationServerMetadata(publicOrigin), {
              headers: {
                "Cache-Control": "no-store",
              },
            }),
          );
        }

        const scopedAuthorize = resolveScopedOAuthPath(
          requestUrl.pathname,
          GATEWAY_AUTHORIZATION_ENDPOINT,
        );
        if (scopedAuthorize) {
          return withGatewayCors(
            request,
            await fetch(
              buildScopedAppProxyRequest(
                request,
                "/api/mcp/oauth/authorize",
                requestUrl,
                publicOrigin,
                scopedAuthorize.slug,
              ),
            ),
          );
        }

        if (
          requestUrl.pathname === GATEWAY_AUTHORIZATION_PATH ||
          requestUrl.pathname === "/api/mcp/oauth/authorize"
        ) {
          return withGatewayCors(
            request,
            await fetch(
              buildAppProxyRequest(request, "/api/mcp/oauth/authorize", requestUrl, publicOrigin),
            ),
          );
        }

        const scopedToken = resolveScopedOAuthPath(requestUrl.pathname, GATEWAY_TOKEN_ENDPOINT);
        if (scopedToken) {
          return withGatewayCors(
            request,
            await fetch(
              buildAppProxyRequest(request, "/api/mcp/oauth/token", requestUrl, publicOrigin),
            ),
          );
        }

        if (
          requestUrl.pathname === GATEWAY_TOKEN_PATH ||
          requestUrl.pathname === "/api/mcp/oauth/token"
        ) {
          return withGatewayCors(
            request,
            await fetch(
              buildAppProxyRequest(request, "/api/mcp/oauth/token", requestUrl, publicOrigin),
            ),
          );
        }

        const scopedRegister = resolveScopedOAuthPath(
          requestUrl.pathname,
          GATEWAY_REGISTER_ENDPOINT,
        );
        if (scopedRegister) {
          return withGatewayCors(
            request,
            await fetch(
              buildAppProxyRequest(request, "/api/mcp/oauth/register", requestUrl, publicOrigin),
            ),
          );
        }

        if (
          requestUrl.pathname === GATEWAY_REGISTER_PATH ||
          requestUrl.pathname === "/api/mcp/oauth/register"
        ) {
          return withGatewayCors(
            request,
            await fetch(
              buildAppProxyRequest(request, "/api/mcp/oauth/register", requestUrl, publicOrigin),
            ),
          );
        }

        const protectedResourceMatch = matchProtectedResourceMetadataRequest(requestUrl);
        if (protectedResourceMatch) {
          return withGatewayCors(
            request,
            Response.json(
              buildProtectedResourceMetadata(
                publicOrigin,
                protectedResourceMatch.slug as keyof typeof MCP_SERVER_REGISTRY,
              ),
              {
                headers: {
                  "Cache-Control": "no-store",
                },
              },
            ),
          );
        }

        if (requestUrl.pathname === "/.well-known/oauth-protected-resource") {
          return withGatewayCors(
            request,
            Response.json(
              {
                resources: Object.keys(MCP_SERVER_REGISTRY).map((slug) =>
                  new URL(
                    buildProtectedResourceMetadataPath(slug as keyof typeof MCP_SERVER_REGISTRY),
                    publicOrigin,
                  ).toString(),
                ),
              },
              {
                headers: {
                  "Cache-Control": "no-store",
                },
              },
            ),
          );
        }

        let routed;
        try {
          routed = routeMcpRequest(requestUrl, routingEnv);
        } catch (error) {
          return withGatewayCors(
            request,
            new Response(error instanceof Error ? error.message : "Gateway misconfigured", {
              status: 500,
            }),
          );
        }

        if (!routed) {
          return withGatewayCors(request, new Response("Not found", { status: 404 }));
        }

        return withGatewayCors(
          request,
          await fetch(buildProxyRequest(request, routed.target, publicOrigin)),
        );
      },
    });
  } catch (error) {
    shutdownManagedChildren?.();
    throw error;
  }

  let isShuttingDown = false;
  const cleanup = (exitCode?: number) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server?.stop(true);
    shutdownManagedChildren?.();

    if (typeof exitCode === "number") {
      process.exit(exitCode);
    }
  };
  process.once("SIGINT", () => cleanup(0));
  process.once("SIGTERM", () => cleanup(0));
  process.once("exit", () => cleanup());

  console.log(`MCP gateway listening on http://${hostname}:${port}`);
  console.log("[gateway] public MCP endpoints:");
  for (const server of Object.values(MCP_SERVER_REGISTRY)) {
    console.log(`  - http://${publicHostname}:${port}${server.publicBasePath}`);
  }
}

await main();
