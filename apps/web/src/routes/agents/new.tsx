import { createFileRoute } from "@tanstack/react-router";
import NewCoworkerPage from "./-components/new-coworker-page";

export const Route = createFileRoute("/agents/new")({
  head: () => ({ meta: [{ title: "New Coworker" }] }),
  component: NewCoworkerPage,
});
