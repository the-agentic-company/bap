import { createFileRoute } from "@tanstack/react-router";
import CoworkersPage from "../-components/coworkers-page";
import { loadInitialCoworkers } from "../-lib/initial-coworkers-loader";

export const Route = createFileRoute("/agents/folders/$folderId")({
  loader: () => loadInitialCoworkers(),
  head: () => ({ meta: [{ title: "Coworker Folder" }] }),
  component: AgentsFolderRoute,
});

function AgentsFolderRoute() {
  const { folderId } = Route.useParams();
  const initialCoworkers = Route.useLoaderData();
  return (
    <CoworkersPage
      currentFolderId={folderId}
      initialCoworkerSharedCount={initialCoworkers.sharedCount}
      initialCoworkerTotalCount={initialCoworkers.totalCount}
      initialCoworkers={initialCoworkers.coworkers}
    />
  );
}
