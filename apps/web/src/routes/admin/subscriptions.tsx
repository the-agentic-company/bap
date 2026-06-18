import { createFileRoute } from "@tanstack/react-router";
import { AdminSubscriptionsPage } from "@/routes/internal/subscriptions";

export const Route = createFileRoute("/admin/subscriptions")({
  head: () => ({ meta: [{ title: "Shared Bap Models - Bap" }] }),
  component: AdminSubscriptionsPage,
});
