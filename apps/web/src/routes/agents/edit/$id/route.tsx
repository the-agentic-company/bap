import { createFileRoute } from "@tanstack/react-router";

/**
 * /agents/edit/$id layout. The editor UI itself is rendered by the leaf routes (index +
 * nested runs) so the `:id` segment is owned here and child routes inherit it.
 *
 * `tab` / `run` search params drive the editor's selected tab and selected run. They are
 * validated here as a behavior-affecting search contract; the shared editor component reads
 * them through the route-local navigation compat layer.
 */
export const Route = createFileRoute("/agents/edit/$id")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: string; run?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    run: typeof search.run === "string" ? search.run : undefined,
  }),
});
