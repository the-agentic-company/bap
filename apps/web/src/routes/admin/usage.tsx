import { createFileRoute } from "@tanstack/react-router";
import CoworkerUsagePage from "@/routes/agents/-components/usage-page";

export const Route = createFileRoute("/admin/usage")({
  head: () => ({ meta: [{ title: "Usage - Bap" }] }),
  component: AdminUsagePage,
});

function AdminUsagePage() {
  return <CoworkerUsagePage />;
}
