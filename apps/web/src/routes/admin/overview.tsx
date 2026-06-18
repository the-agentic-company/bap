import { createFileRoute } from "@tanstack/react-router";
import CoworkerOverviewPage from "@/routes/agents/-components/overview-page";

export const Route = createFileRoute("/admin/overview")({
  head: () => ({ meta: [{ title: "Coworker Overview - Bap" }] }),
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  return <CoworkerOverviewPage coworkerLinkPrefix="/agents/edit/" />;
}
