import { createFileRoute } from "@tanstack/react-router";
import CoworkerUsagePage from "./-components/usage-page";

export const Route = createFileRoute("/agents/usage")({
  head: () => ({ meta: [{ title: "Usage" }] }),
  component: CoworkerUsagePage,
});
