import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { T, useGT } from "gt-react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSelfHostInstance } from "@/lib/route-guards";
import { getInstanceHealthStatus, type InstanceHealthStatus } from "@/server/instance/health";

/**
 * Self-hosted instance management page (was src/app/instance/page.tsx).
 *
 * access=self-host: this surface only exists in the self-host edition. The previous page
 * called `isSelfHostedEdition()` during render and `redirect("/admin")` for the cloud
 * edition; that gate moves to `beforeLoad` via the shared self-host instance guard, which
 * redirects the cloud edition home and unauthenticated requests to `/login` (with a
 * `callbackUrl` back to `/instance`) before any render.
 *
 * The deployment/control-plane health status is server-only bootstrap data for this page,
 * so it is fetched in the route `loader` through a server function (preserving the old
 * server-component `await getInstanceHealthStatus()`), rather than moving to oRPC/React Query.
 */
const fetchInstanceHealth = createServerFn({ method: "GET" }).handler(
  (): Promise<InstanceHealthStatus> => getInstanceHealthStatus(),
);

export const Route = createFileRoute("/instance")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSelfHostInstance(location.href),
  }),
  loader: () => fetchInstanceHealth(),
  head: () => ({
    meta: [
      { title: "Instance · CmdClaw" },
      {
        name: "description",
        content: "Deployment health and control-plane status for this self-hosted instance.",
      },
    ],
  }),
  component: InstancePage,
});

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
      </div>
      <span
        className={`rounded-full px-2 py-1 text-xs font-medium ${
          ok
            ? "bg-green-500/10 text-green-700 dark:text-green-300"
            : "bg-destructive/10 text-destructive"
        }`}
      >
        {ok ? "Healthy" : "Issue"}
      </span>
    </div>
  );
}

function InstancePage() {
  const t = useGT();

  const { sessionContext } = Route.useRouteContext();
  const health = Route.useLoaderData();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="bg-background min-h-full">
        <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-10 md:px-6 md:pt-10">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">
                <T>Instance</T>
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                <T>Deployment health and control-plane status for this self-hosted instance.</T>
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                health.ok
                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {health.ok ? "Healthy" : "Attention needed"}
            </span>
          </div>

          <div className="space-y-3">
            <CheckRow
              label={t("Database")}
              ok={health.checks.database.ok}
              detail={health.checks.database.detail}
            />
            <CheckRow
              label={t("Redis")}
              ok={health.checks.redis.ok}
              detail={health.checks.redis.detail}
            />
            <CheckRow
              label={t("S3 storage")}
              ok={health.checks.s3.ok}
              detail={health.checks.s3.detail}
            />
            <CheckRow label="E2B" ok={health.checks.e2b.ok} detail={health.checks.e2b.detail} />
            <CheckRow
              label={t("Cloud control plane")}
              ok={health.checks.controlPlane.ok}
              detail={health.checks.controlPlane.detail}
            />
          </div>

          <div className="mt-6 rounded-lg border px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span>
                <span className="text-muted-foreground">
                  <T>Edition:</T>
                </span>{" "}
                {health.edition}
              </span>
              <span>
                <span className="text-muted-foreground">
                  <T>Checked:</T>
                </span>{" "}
                {new Date(health.checkedAt).toLocaleString()}
              </span>
              <span>
                <span className="text-muted-foreground">
                  <T>Sandbox backend:</T>
                </span>{" "}
                E2B
              </span>
            </div>
          </div>
        </main>
      </div>
    </AuthenticatedAppRootShell>
  );
}
