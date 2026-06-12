import { createFileRoute, Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { requireSession } from "@/lib/route-guards";

/**
 * Standalone protected account snapshot page.
 *
 * Recreates the previous `/accounts` route at the exact same URL. In the previous route tree this
 * page rendered with no app-shell chrome (it was absent from the sidebar-visibility lists),
 * so it is modeled as a flat protected route rather than nesting under the `_app` shell.
 *
 * Access is protected: `beforeLoad` runs the shared session guard, redirecting
 * unauthenticated users to `/login` (or worktree auto-login) and returning them to
 * `/accounts` after sign-in. Global providers (oRPC, React Query, toasts) are owned by the
 * router/root scaffold. Session data is still read client-side via Better Auth's client,
 * matching the original behavior (this is not a data-layer rewrite).
 */
export const Route = createFileRoute("/accounts")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  head: () => ({ meta: [{ title: "Account - CmdClaw" }] }),
  component: AccountsPage,
});

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="bg-muted/50 rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
        {label}
      </p>
      <p className="text-sm font-medium break-all">{value}</p>
    </div>
  );
}

function AccountsPage() {
  const t = useGT();

  const { sessionContext } = Route.useRouteContext();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    authClient
      .getSession()
      .then((res) => {
        setSessionData(res?.data ?? null);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const user = sessionData?.user;
  const activeSession = sessionData?.session;

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="flex flex-1 flex-col gap-4">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                <T>Account</T>
              </h1>
              <p className="text-muted-foreground text-sm">
                <T>Quick snapshot of who is signed in right now.</T>
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/login">
                <T>Open login</T>
              </Link>
            </Button>
          </div>

          <div className="mt-5 space-y-4">
            {status === "loading" && (
              <div
                className="bg-muted/70 h-28 animate-pulse rounded-lg"
                aria-label={t("Loading session")}
              />
            )}

            {status === "error" && (
              <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                <T>Unable to load your session right now. Please try again in a moment.</T>
              </div>
            )}

            {status === "ready" && user && (
              <div className="bg-muted/50 space-y-4 rounded-xl border p-4">
                <div>
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                    <T>Signed in as</T>
                  </p>
                  <p className="text-lg leading-tight font-semibold">
                    {user.name || user.email || "Current user"}
                  </p>
                  {user.email && <p className="text-muted-foreground text-sm">{user.email}</p>}
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoRow label={t("User ID")} value={user.id ?? "Not available"} />
                  <InfoRow label={t("Session ID")} value={activeSession?.id ?? "Not available"} />
                  <InfoRow
                    label={t("Session status")}
                    value={activeSession ? "Active" : "Missing"}
                  />
                  <InfoRow
                    label={t("Expires at")}
                    value={
                      activeSession?.expiresAt
                        ? typeof activeSession.expiresAt === "string"
                          ? activeSession.expiresAt
                          : activeSession.expiresAt.toISOString()
                        : "Not available"
                    }
                  />
                </div>
              </div>
            )}

            {status === "ready" && !user && (
              <div className="bg-muted/50 space-y-3 rounded-lg border p-4">
                <p className="text-muted-foreground text-sm">
                  <T>No user is currently signed in. Use the login link to start a session.</T>
                </p>
                <Button asChild size="sm">
                  <Link to="/login">
                    <T>Go to login</T>
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthenticatedAppRootShell>
  );
}
