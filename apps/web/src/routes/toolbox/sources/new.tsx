import { createFileRoute } from "@tanstack/react-router";
import { NewSourcePage } from "../-components/new-source-page";

/**
 * /toolbox/sources/new — add a workspace MCP server
 * (was src/app/toolbox/sources/new/page.tsx).
 *
 * Protected by the parent /toolbox layout `beforeLoad` guard. The `kind` search param selects
 * the source type (currently only `mcp`); it is validated at the route boundary so the typed
 * link from the toolbox list (`/toolbox/sources/new?kind=mcp`) stays valid.
 */
type NewSourceSearch = {
  kind?: string;
};

export const Route = createFileRoute("/toolbox/sources/new")({
  validateSearch: (search: Record<string, unknown>): NewSourceSearch => {
    const kind = typeof search.kind === "string" ? search.kind : undefined;
    return kind ? { kind } : {};
  },
  head: () => ({ meta: [{ title: "Add MCP Server - CmdClaw" }] }),
  component: NewSourcePage,
});
