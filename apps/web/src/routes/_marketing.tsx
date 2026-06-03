import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

/**
 * Pathless layout route for public marketing pages (access = public, no auth).
 *
 * Shell selection is route nesting, not a global pathname switch: every page under
 * `_marketing/*` renders inside this layout while keeping its exact public URL (the
 * `_marketing` segment is pathless, so `/pricing`, `/avatar`, etc. are unchanged).
 *
 * The React Query client + QueryClientProvider come from the root via the SSR Query
 * integration (see src/router.tsx / src/routes/__root.tsx), so this layout only adds the
 * marketing-shell concerns these pages need at runtime — the toast surface used by the
 * avatar generator, template browser, and bug report form.
 */
export const Route = createFileRoute("/_marketing")({
  component: MarketingLayout,
});

function MarketingLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
