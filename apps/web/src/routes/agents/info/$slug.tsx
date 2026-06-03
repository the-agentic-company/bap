import { createFileRoute } from "@tanstack/react-router";
import { CoworkerInfoPage } from "../-components/coworker-info-page";

/**
 * /agents/info/$slug (was src/app/agents/info/[slug]/page.tsx).
 *
 * `run` / `tab` search params drive the selected run and active tab on the info page; they
 * are validated here as a behavior-affecting search contract. The component reads them via
 * the route-local navigation compat layer.
 */
export const Route = createFileRoute("/agents/info/$slug")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { run?: string; tab?: string } => ({
    run: typeof search.run === "string" ? search.run : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  head: () => ({ meta: [{ title: "Coworker" }] }),
  component: CoworkerInfoRoute,
});

function CoworkerInfoRoute() {
  const { slug } = Route.useParams();
  return <CoworkerInfoPage coworkerSlug={slug} />;
}
