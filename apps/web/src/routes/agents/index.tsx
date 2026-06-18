import { createFileRoute } from "@tanstack/react-router";
import CoworkersPage from "./-components/coworkers-page";
import { loadInitialCoworkerInventory } from "./-lib/initial-coworker-inventory-loader";

/**
 * /agents — coworkers landing grid (was src/app/agents/page.tsx).
 * Protected by the parent /agents layout `beforeLoad` guard.
 */
export const Route = createFileRoute("/agents/")({
  loader: () => loadInitialCoworkerInventory(),
  pendingMs: 10_000,
  staleTime: 30_000,
  head: () => ({ meta: [{ title: "Coworkers" }] }),
  component: AgentsIndexRoute,
});

function AgentsIndexRoute() {
  const initialInventory = Route.useLoaderData();
  return (
    <CoworkersPage
      initialCoworkerSharedCount={initialInventory.sharedCount}
      initialCoworkerTotalCount={initialInventory.totalCount}
      initialCoworkers={initialInventory.coworkers}
      initialFolders={initialInventory.folders}
    />
  );
}
