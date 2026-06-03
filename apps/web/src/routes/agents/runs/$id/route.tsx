import { createFileRoute } from "@tanstack/react-router";
import CoworkerRunLayout from "../../-components/run-detail-layout";

/**
 * /agents/runs/$id layout (was src/app/agents/runs/[id]/layout.tsx). Renders the run header
 * chrome (usage dialog, share/copy controls, open-in-builder) and an Outlet for the run page.
 */
export const Route = createFileRoute("/agents/runs/$id")({
  component: CoworkerRunLayout,
});
