import { createFileRoute } from "@tanstack/react-router";
import CoworkerEditorPage from "../../-components/coworker-editor-page";

export const Route = createFileRoute("/agents/edit/$id/")({
  head: () => ({ meta: [{ title: "Edit Coworker" }] }),
  component: CoworkerEditorPage,
});
