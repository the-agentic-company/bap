import { Link } from "@tanstack/react-router";
import { T } from "gt-react";
import { useEffect, useRef } from "react";
import { reportRootErrorObservation } from "@/lib/client-observations";

/**
 * Root error boundary fallback. Kept intentionally minimal for v1 of the TanStack Start
 * migration; route groups can add their own richer error boundaries on top of this.
 *
 * Uses TanStack Router's <Link> (the framework's navigation primitive). The `to="/"`
 * reference resolves once the home route lands in a later page-migration phase.
 */
export function RootErrorBoundary({ error }: { error: unknown }) {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "An unexpected error occurred.";
  const eventIdRef = useRef<string | undefined>(undefined);
  const observedErrorRef = useRef<unknown>(undefined);

  useEffect(() => {
    try {
      if (observedErrorRef.current !== error) {
        observedErrorRef.current = error;
        eventIdRef.current =
          globalThis.crypto?.randomUUID?.() ??
          `root-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      reportRootErrorObservation(error, eventIdRef.current);
    } catch {
      // Observability is best-effort and must not break the root fallback.
    }
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">
        <T>Something went wrong</T>
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <Link to="/" className="text-brand text-sm font-medium underline-offset-4 hover:underline">
        <T>Return home</T>
      </Link>
    </main>
  );
}
