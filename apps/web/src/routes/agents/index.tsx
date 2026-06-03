import { createFileRoute } from "@tanstack/react-router";
import CoworkersPage from "./-components/coworkers-page";

/**
 * /agents — coworkers landing grid (was src/app/agents/page.tsx).
 * Protected by the parent /agents layout `beforeLoad` guard.
 */
export const Route = createFileRoute("/agents/")({
  head: () => ({ meta: [{ title: "Coworkers" }] }),
  component: CoworkersPage,
});
