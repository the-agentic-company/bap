import { env } from "@/env";
import { getTrustedOrigins } from "@/lib/trusted-origins";

/**
 * Framework-neutral CORS helpers for the hosted MCP OAuth endpoints
 * (`/api/mcp/oauth/**`). Mirrors the previous implementation exactly but
 * uses only standard `Request`/`Response`/`Headers`.
 *
 * The allowed origin is computed dynamically against an origin whitelist
 * (trusted origins plus loopback hosts). Unknown origins fall back to the
 * configured app URL so the header is always present.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const trustedOrigins = new Set(getTrustedOrigins());
const DEFAULT_ALLOWED_ORIGIN =
  env.APP_URL ?? env.VITE_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getHostedMcpOauthCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (trustedOrigins.has(origin) || isLoopbackOrigin(origin));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : DEFAULT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Returns a new `Response` cloned from `response` with the dynamic CORS headers
 * applied based on the request `Origin`.
 */
export function withHostedMcpOauthCors(request: Request, response: Response): Response {
  const corsHeaders = getHostedMcpOauthCorsHeaders(request.headers.get("origin"));
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Builds the `204 No Content` preflight response for OPTIONS requests with the
 * dynamic CORS headers applied.
 */
export function hostedMcpOauthOptionsResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getHostedMcpOauthCorsHeaders(request.headers.get("origin")),
  });
}
