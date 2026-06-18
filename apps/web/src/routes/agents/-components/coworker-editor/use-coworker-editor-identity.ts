import { useParams as useTanStackParams, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { getCoworkerRouteSlug } from "@/lib/coworker-routes";
import { useCoworkerList } from "@/orpc/hooks/coworkers";
import { isUuidRouteSlug } from "./coworker-editor-utils";
import type { CoworkerTab } from "./types";

type UseCoworkerEditorIdentityInput = {
  coworkerIdOverride?: string;
  embedded: boolean;
};

/**
 * Resolves the coworker editor's identity and route position from the URL.
 *
 * Given the route params/pathname/search, it resolves the active coworker id
 * and display slug (override, list match, or raw uuid), parses the active base
 * tab, extracts the selected run id from either the `run` query param or the
 * nested `/runs/:id` pathname, computes whether the view is a runs route, and
 * builds the redirect path used by the impersonation gate.
 *
 * This is pure route/identity derivation — it does not load the coworker
 * itself, so the controller can key the coworker query off the id it returns.
 */
export function useCoworkerEditorIdentity({
  coworkerIdOverride,
  embedded,
}: UseCoworkerEditorIdentityInput) {
  const params = useTanStackParams({ strict: false, shouldThrow: false }) as { id?: string };
  const routeCoworkerSlug = params?.id;
  const coworkerList = useCoworkerList();
  const coworkerListItem = useMemo(
    () =>
      coworkerIdOverride
        ? null
        : (coworkerList.data?.find(
            (item) => item.username === routeCoworkerSlug || item.id === routeCoworkerSlug,
          ) ?? null),
    [coworkerIdOverride, coworkerList.data, routeCoworkerSlug],
  );
  const routeCoworkerId = isUuidRouteSlug(routeCoworkerSlug) ? routeCoworkerSlug : undefined;
  const coworkerId = coworkerIdOverride ?? coworkerListItem?.id ?? routeCoworkerId;
  const coworkerRouteSlug = coworkerIdOverride
    ? coworkerIdOverride
    : coworkerListItem
      ? getCoworkerRouteSlug(coworkerListItem)
      : routeCoworkerSlug;
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);

  const baseTabParam = searchParams.get("tab");
  const routeBaseTab: CoworkerTab | null =
    baseTabParam === "chat" ||
    baseTabParam === "instruction" ||
    baseTabParam === "runs" ||
    baseTabParam === "docs" ||
    baseTabParam === "toolbox" ||
    baseTabParam === "admin"
      ? baseTabParam
      : null;
  const routeSearchRunId = routeBaseTab === "runs" ? searchParams.get("run") : null;
  const routeRunId = useMemo(() => {
    if (routeSearchRunId) {
      return routeSearchRunId;
    }

    if (embedded || !coworkerId || !pathname) {
      return null;
    }

    const prefix = `/agents/edit/${routeCoworkerSlug}/runs/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }

    const runId = pathname.slice(prefix.length);
    return runId.length > 0 ? runId : null;
  }, [coworkerId, embedded, pathname, routeCoworkerSlug, routeSearchRunId]);
  const isNestedRunsRoute =
    !embedded && (pathname?.startsWith(`/agents/edit/${routeCoworkerSlug}/runs`) ?? false);
  const isRunsRoute = routeBaseTab === "runs" || isNestedRunsRoute;
  const currentRoutePath = useMemo(() => {
    if (embedded && coworkerId) {
      return `/agents?agent=${encodeURIComponent(coworkerId)}`;
    }
    const query = searchParams.toString();
    return query && pathname
      ? `${pathname}?${query}`
      : (pathname ?? `/agents/edit/${coworkerRouteSlug}`);
  }, [coworkerId, coworkerRouteSlug, embedded, pathname, searchParams]);

  return {
    coworkerId,
    coworkerRouteSlug,
    coworkerListIsLoading: coworkerList.isLoading,
    routeBaseTab,
    routeRunId,
    isNestedRunsRoute,
    isRunsRoute,
    currentRoutePath,
  };
}
