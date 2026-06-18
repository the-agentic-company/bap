import { createFileRoute } from "@tanstack/react-router";
import CoworkersPage from "./-components/coworkers-page";
import { loadInitialCoworkers } from "./-lib/initial-coworkers-loader";

/**
 * /agents — coworkers landing grid (was src/app/agents/page.tsx).
 * Protected by the parent /agents layout `beforeLoad` guard.
 */
export const Route = createFileRoute("/agents/")({
  loader: () => loadInitialCoworkers(),
  head: () => ({ meta: [{ title: "Coworkers" }] }),
  component: AgentsIndexRoute,
});

function AgentsIndexRoute() {
  const initialCoworkers = Route.useLoaderData();
  return (
    <CoworkersPage
      initialCoworkerSharedCount={initialCoworkers.sharedCount}
      initialCoworkerTotalCount={initialCoworkers.totalCount}
      initialCoworkers={initialCoworkers.coworkers}
    />
  );
}
