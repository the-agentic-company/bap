import { QueryClient } from "@tanstack/react-query";

/**
 * Shared React Query client factory.
 *
 * Preserves the defaults from the previous `ORPCProvider` (1 minute stale time,
 * no refetch on window focus). A fresh client is created per request on the server and
 * once on the client, in line with TanStack Start's SSR Query integration.
 *
 * The session-principal cache-clearing behavior (clearing the cache when the signed-in
 * user changes) lives in the client provider that consumes this client; the factory only
 * owns construction + defaults so server and client share one source of truth.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
      },
    },
  });
}
