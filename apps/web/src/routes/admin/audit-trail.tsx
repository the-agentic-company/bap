import { createFileRoute } from "@tanstack/react-router";
import RunHistoryPage from "@/routes/agents/-components/history-page";

export const Route = createFileRoute("/admin/audit-trail")({
  head: () => ({ meta: [{ title: "Audit Trail - Bap" }] }),
  component: AdminAuditTrailPage,
});

function AdminAuditTrailPage() {
  return <RunHistoryPage />;
}
