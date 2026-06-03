import { createFileRoute } from "@tanstack/react-router";
import CoworkerHistoryPage from "./-components/history-page";

export const Route = createFileRoute("/agents/history")({
  head: () => ({ meta: [{ title: "Coworker History" }] }),
  component: CoworkerHistoryPage,
});
