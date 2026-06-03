import { createFileRoute } from "@tanstack/react-router";
import CoworkerEditorPage from "../../../-components/coworker-editor-page";

export const Route = createFileRoute("/agents/edit/$id/runs/$runId")({
  head: () => ({ meta: [{ title: "Coworker Run" }] }),
  component: CoworkerEditorPage,
});
