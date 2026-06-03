import { Link } from "@tanstack/react-router";

/**
 * Root error boundary fallback. Kept intentionally minimal for v1 of the TanStack Start
 * migration; route groups can add their own richer error boundaries on top of this.
 *
 * Uses TanStack Router's <Link> (the framework's navigation primitive). The `to="/"`
 * reference resolves once the home route lands in a later page-migration phase.
 */
export function RootErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <Link to="/" className="text-brand text-sm font-medium underline-offset-4 hover:underline">
        Return home
      </Link>
    </main>
  );
}
