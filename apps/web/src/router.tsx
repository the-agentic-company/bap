import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";

/**
 * Router context shared with every route's `beforeLoad`/`loader`.
 *
 * `queryClient` is the single React Query client for the request (server) or session
 * (client). Route guards and loaders can prefetch through it; the SSR Query integration
 * dehydrates/hydrates it across the SSR boundary.
 */
export interface RouterAppContext {
  queryClient: QueryClient;
}

export function getRouter() {
  const queryClient = createQueryClient();

  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
    } satisfies RouterAppContext,
    // Public route smoke pages and detail pages own their own boundaries; the root route
    // provides the default error / not-found fallbacks (see src/routes/__root.tsx).
    defaultPreload: "intent",
    // React Query is the cache of record for product data, so let it own SSR staleness
    // rather than double-caching loader data.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  // Wire TanStack Router's SSR Query integration: dehydrate on the server, hydrate on the
  // client, and wrap the app in a QueryClientProvider bound to the request's client.
  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
