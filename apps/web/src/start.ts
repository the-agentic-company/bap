import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { initializeWebObservabilityAtStartup } from "@/server/start/observability-startup";
import { requestObservabilityMiddleware } from "@/server/start/request-observability-middleware";
import { securityHeadersMiddleware } from "@/server/start/security-headers-middleware";

void initializeWebObservabilityAtStartup();

/**
 * TanStack Start instance: the single place for request-wide concerns.
 *
 * Intentionally narrow per the migration spec:
 * - server-function CSRF protection (TanStack's own CSRF middleware),
 * - baseline security headers,
 * - a light request/observability guard.
 *
 * Page-auth routing is NOT here — that lives in route `beforeLoad` guards (see
 * src/lib/route-guards.ts). API/oRPC authorization stays inside the handlers.
 */
export const startInstance = createStart(() => ({
  // CSRF protection runs as a request middleware (it validates the incoming request's
  // Origin / Sec-Fetch-Site before any server function executes). Observability bootstrap
  // and security headers wrap every request/response.
  requestMiddleware: [
    requestObservabilityMiddleware,
    // Scope CSRF to server-function RPC requests only (TanStack Start's documented default).
    // Without this filter the middleware rejects every request — public page navigations
    // (`Sec-Fetch-Site: none`), health probes, OAuth/webhook callbacks (cross-site), and the
    // oRPC endpoint all 403. Server functions are the same-origin RPC surface CSRF protects;
    // oRPC/API and webhook handlers enforce their own auth/signature checks.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    securityHeadersMiddleware,
  ],
}));
