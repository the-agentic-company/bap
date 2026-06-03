import { createFileRoute } from "@tanstack/react-router";
import CoworkerRunPage from "../../-components/run-detail-page";

export const Route = createFileRoute("/agents/runs/$id/")({
  head: () => ({ meta: [{ title: "Coworker Run" }] }),
  component: CoworkerRunPage,
});
