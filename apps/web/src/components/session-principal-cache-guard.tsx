import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Clears the React Query cache when the signed-in principal changes.
 *
 * Ported from the old Next.js `ORPCProvider`: polls the Better Auth session, and on a
 * user-id transition clears the client query cache so a previous user's data can't leak
 * into the next session. Reads the request's QueryClient from the React Query context that
 * the TanStack Start SSR Query integration provides (see src/router.tsx).
 */
export function SessionPrincipalCacheGuard() {
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const lastSessionUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    const syncSessionUserState = async () => {
      try {
        const sessionResult = await authClient.getSession();
        if (!active) {
          return;
        }
        const currentUserId = sessionResult?.data?.user?.id ?? null;
        const previousUserId = lastSessionUserIdRef.current;
        if (previousUserId === undefined) {
          lastSessionUserIdRef.current = currentUserId;
          return;
        }
        if (previousUserId !== currentUserId) {
          lastSessionUserIdRef.current = currentUserId;
          queryClient.clear();
          console.info("[Auth] Session principal changed, cleared client query cache", {
            previousUserId,
            currentUserId,
            pathname,
          });
          return;
        }
        lastSessionUserIdRef.current = currentUserId;
      } catch (error) {
        console.error("[Auth] Failed to sync session principal for cache guard", error);
      }
    };

    const runSync = () => {
      void syncSessionUserState();
    };

    runSync();
    const interval = window.setInterval(runSync, 10_000);
    const onFocus = () => runSync();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        runSync();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname, queryClient]);

  return null;
}
