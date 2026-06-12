import { createFileRoute } from "@tanstack/react-router";
import { T } from "gt-react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSession } from "@/lib/route-guards";

/**
 * Global search page (`/search`).
 *
 * Replaces the previous `src/app/search/page.tsx`. This is a standalone protected
 * page: it renders its own full-height shell rather than the app sidebar chrome, so
 * it lives as a top-level route with its own session guard instead of nesting under
 * the `_app` layout.
 *
 * Access is protected: `beforeLoad` runs the shared session guard, redirecting
 * unauthenticated users to `/login` (or worktree auto-login) and returning them to
 * `/search` after sign-in.
 */
export const Route = createFileRoute("/search")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  head: () => ({ meta: [{ title: "Search - CmdClaw" }] }),
  component: SearchPage,
});

function SearchPage() {
  const { sessionContext } = Route.useRouteContext();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="bg-background min-h-screen">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">
            <T>Search</T>
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            <T>Search across coworkers, skills, and integrations.</T>
          </p>
        </div>
      </div>
    </AuthenticatedAppRootShell>
  );
}
