import { createFileRoute } from "@tanstack/react-router";
import CoworkersGridPage from "./-components/grid-page";

export const Route = createFileRoute("/agents/grid")({
  head: () => ({ meta: [{ title: "All Coworkers" }] }),
  component: CoworkersGridPage,
});
