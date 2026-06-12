import { env } from "@/env";

/**
 * Shared `Bearer <APP_SERVER_SECRET>` check used by the internal server-to-server
 * endpoints (admin remote integrations, MCP credentials, Slack relay, CLI testing).
 * Returns false when no secret is configured so these endpoints fail closed.
 */
export function isAuthorizedByServerSecret(request: Request): boolean {
  const expected = env.APP_SERVER_SECRET ? `Bearer ${env.APP_SERVER_SECRET}` : "";
  return Boolean(expected) && request.headers.get("authorization") === expected;
}
