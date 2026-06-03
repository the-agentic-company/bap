import { createFileRoute } from "@tanstack/react-router";
import { CoworkerInfoPrototype } from "./-components/coworker-info-prototype";

/**
 * /prototype/coworker/info/$slug (was src/app/prototype/coworker/info/[slug]/page.tsx).
 *
 * access = public: there is no Next layout for the prototype tree and no auth guard, so this is
 * a standalone public route rendered directly under the root. The product data it shows is
 * fetched through oRPC/React Query in the client component and remains subject to oRPC's own
 * authorization — a public page route is not API authorization.
 *
 * `run` is a behavior-affecting search param selecting which coworker run the page shows; it is
 * validated here as the search contract. The component reads it via the route-local navigation
 * compat layer. The dynamic head is static text, so no loader is needed.
 */
export const Route = createFileRoute("/prototype/coworker/info/$slug")({
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    run: typeof search.run === "string" ? search.run : undefined,
  }),
  head: () => ({ meta: [{ title: "Coworker info prototype | CmdClaw" }] }),
  component: PrototypeCoworkerInfoRoute,
});

function PrototypeCoworkerInfoRoute() {
  const { slug } = Route.useParams();
  return <CoworkerInfoPrototype coworkerSlug={slug} />;
}
