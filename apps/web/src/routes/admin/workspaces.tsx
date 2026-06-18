import { createFileRoute } from "@tanstack/react-router";
import { AdminWorkspacesPage } from "@/routes/internal/workspaces";

export const Route = createFileRoute("/admin/workspaces")({
  head: () => ({ meta: [{ title: "Workspaces - Bap" }] }),
  component: AdminWorkspacesPage,
});
