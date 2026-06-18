import { createFileRoute } from "@tanstack/react-router";
import CoworkersPage from "../-components/coworkers-page";

export const Route = createFileRoute("/agents/folders/$folderId")({
  head: () => ({ meta: [{ title: "Coworker Folder" }] }),
  component: AgentsFolderRoute,
});

function AgentsFolderRoute() {
  const { folderId } = Route.useParams();
  return <CoworkersPage currentFolderId={folderId} />;
}
