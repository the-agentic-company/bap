import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { T } from "gt-react";

/**
 * Support shell layout. Replaces the previous `src/app/support/layout.tsx` as a TanStack
 * layout route for the `/support` group (help center / contact page).
 *
 * This is a public (access=public) shell: `/support` was listed in the previous proxy's
 * `publicRoutes`, and the migration PRD lists "support" among the public pages that must
 * keep rendering for anyone. So this carries NO `beforeLoad` auth guard — gating it would
 * break the frozen public-URL behavior. (API/oRPC authorization stays inside handlers.)
 *
 * It renders the header / footer chrome and an <Outlet /> for the nested support page,
 * which keeps its exact URL: /support. Mirrors the sibling `legal` shell.
 */
export const Route = createFileRoute("/support")({
  component: SupportLayout,
});

function SupportLayout() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container flex h-14 items-center px-4">
          <Link to="/" className="text-sm font-medium">
            <T>CmdClaw</T>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Outlet />
      </main>
      <footer className="border-t px-4 py-6">
        <div className="text-muted-foreground flex flex-col items-center gap-4 text-center text-sm md:flex-row md:justify-between md:text-left">
          <p>
            <T>&copy;</T> {new Date().getFullYear()} <T>CmdClaw. All rights reserved.</T>
          </p>
          <nav className="flex gap-4">
            <Link to="/pricing" className="hover:underline">
              <T>Pricing</T>
            </Link>
            <Link to="/legal/terms" className="hover:underline">
              <T>Terms</T>
            </Link>
            <Link to="/legal/privacy-policy" className="hover:underline">
              <T>Privacy</T>
            </Link>
            <Link to="/support" className="hover:underline">
              <T>Support</T>
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
