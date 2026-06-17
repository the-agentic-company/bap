import { createFileRoute } from "@tanstack/react-router";
import RunHistoryPage from "./-components/history-page";

export const Route = createFileRoute("/agents/history")({
  head: () => ({ meta: [{ title: "Run History" }] }),
  component: RunHistoryPage,
});
