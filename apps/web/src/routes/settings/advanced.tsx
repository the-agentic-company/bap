import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchSessionContext } from "@/lib/route-guards";

/**
 * `/settings/advanced` is a pure redirect: self-host deployments go to the instance admin
 * surface, cloud deployments go to the support-admin surface. The old Next page called
 * `redirect()` at render time; here it moves to `beforeLoad` so the route never renders a
 * component. Edition is resolved server-side via the shared session context (mirrors the
 * old server-only `isSelfHostedEdition()`).
 */
export const Route = createFileRoute("/settings/advanced")({
  beforeLoad: async () => {
    const { edition } = await fetchSessionContext();
    // `href` escape hatch: `/instance` and `/admin` are owned by other migration areas
    // and may not be in the typed route tree yet.
    throw redirect({ href: edition === "selfhost" ? "/instance" : "/admin" });
  },
});
