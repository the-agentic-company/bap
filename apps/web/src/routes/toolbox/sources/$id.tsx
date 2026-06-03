import { createFileRoute } from "@tanstack/react-router";
import { SourceDetailPage } from "../-components/source-detail-page";

/**
 * /toolbox/sources/$id — workspace MCP server detail / edit view
 * (was src/app/toolbox/sources/[id]/page.tsx).
 *
 * Protected by the parent /toolbox layout `beforeLoad` guard. The OAuth completion flags
 * `oauth` / `oauth_error` are behavior-affecting (they drive the post-connect toast), so they
 * are validated at the route boundary. The page keeps its own user-facing "Source not found"
 * state for unknown ids.
 */
type SourceDetailSearch = {
  oauth?: string;
  oauth_error?: string;
};

export const Route = createFileRoute("/toolbox/sources/$id")({
  validateSearch: (search: Record<string, unknown>): SourceDetailSearch => {
    const oauth = typeof search.oauth === "string" ? search.oauth : undefined;
    const oauthError = typeof search.oauth_error === "string" ? search.oauth_error : undefined;
    return {
      ...(oauth ? { oauth } : {}),
      ...(oauthError ? { oauth_error: oauthError } : {}),
    };
  },
  head: () => ({ meta: [{ title: "MCP Server - CmdClaw" }] }),
  component: SourceDetailPage,
});
