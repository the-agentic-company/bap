import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * /agents/runs layout (was src/app/agents/runs/layout.tsx — a passthrough wrapper).
 * Kept as an explicit layout route so the runs index and the /agents/runs/$id detail
 * branch share a boundary.
 */
export const Route = createFileRoute("/agents/runs")({
  component: () => <Outlet />,
});
