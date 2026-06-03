import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

/**
 * Legal shell layout. Replaces the Next `src/app/legal/layout.tsx` client wrapper as a
 * TanStack layout route for the `/legal/*` group (privacy policy, terms of service).
 *
 * This is a public (access=public) shell, so it carries no `beforeLoad` auth guard. It
 * renders the chrome (header / footer) and an <Outlet /> for the nested legal pages, which
 * keep their exact URLs: /legal/privacy-policy and /legal/terms.
 */
export const Route = createFileRoute("/legal")({
  component: LegalLayout,
});

function LegalLayout() {
  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="container flex h-14 items-center px-4">
          <Link to="/" className="text-sm font-medium">
            CmdClaw
          </Link>
        </div>
      </header>
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <Outlet />
      </main>
      <footer className="border-t py-6">
        <div className="text-muted-foreground container flex flex-col items-center gap-4 px-4 text-center text-sm md:flex-row md:justify-between md:text-left">
          <p>&copy; {new Date().getFullYear()} CmdClaw. All rights reserved.</p>
          <nav className="flex gap-4">
            <Link to="/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link to="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link to="/legal/privacy-policy" className="hover:underline">
              Privacy
            </Link>
            <Link to="/support" className="hover:underline">
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
