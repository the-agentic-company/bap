import { createMiddleware } from "@tanstack/react-start";

/**
 * Request-wide security headers.
 *
 * Applied as a TanStack Start request middleware (see src/start.ts) so every router and
 * server-function response carries baseline hardening headers. This is intentionally
 * narrow: page-auth routing does NOT belong here (route guards own that). API and oRPC
 * handlers keep setting their own no-store/cache/CORS headers — this only adds defaults
 * and never overrides a header a handler already set.
 */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-DNS-Prefetch-Control", "off"],
];

export function withSecurityHeaders(source: Response): Response {
  const response = new Response(source.body, source);

  for (const [header, value] of SECURITY_HEADERS) {
    if (!response.headers.has(header)) {
      response.headers.set(header, value);
    }
  }

  return response;
}

export const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    const result = await next();

    return {
      ...result,
      response: withSecurityHeaders(result.response),
    };
  },
);
