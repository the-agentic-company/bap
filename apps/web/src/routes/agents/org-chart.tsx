import { createFileRoute } from "@tanstack/react-router";
import OrgChartPage from "./-components/org-chart-page";

export const Route = createFileRoute("/agents/org-chart")({
  head: () => ({ meta: [{ title: "Org Chart" }] }),
  component: OrgChartPage,
});
