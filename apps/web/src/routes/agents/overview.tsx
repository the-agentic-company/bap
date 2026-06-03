import { createFileRoute } from "@tanstack/react-router";
import CoworkerOverviewPage from "./-components/overview-page";

export const Route = createFileRoute("/agents/overview")({
  head: () => ({ meta: [{ title: "Coworker Overview" }] }),
  component: CoworkerOverviewPage,
});
