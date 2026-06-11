import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";
import { requireSession } from "@/lib/route-guards";
import CoworkersPage, { type CoworkerItem } from "./-components/coworkers-page";

type InitialCoworkersLoaderData = {
  coworkers: CoworkerItem[];
  sharedCount: number;
  tags: Array<{ id: string; name: string; color: string | null; coworkerCount: number }>;
  totalCount: number;
};

const EMPTY_INITIAL_COWORKERS_DATA: InitialCoworkersLoaderData = {
  coworkers: [],
  sharedCount: 0,
  tags: [],
  totalCount: 0,
};

function serializeDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return typeof value === "string" || typeof value === "number" ? new Date(value) : null;
}

function serializeInitialCoworker(row: Record<string, unknown>): CoworkerItem {
  const allowedIntegrations = Array.isArray(row.allowedIntegrations) ? row.allowedIntegrations : [];
  const allowedSkillSlugs = Array.isArray(row.allowedSkillSlugs) ? row.allowedSkillSlugs : [];
  const recentRuns = Array.isArray(row.recentRuns) ? row.recentRuns : [];
  const tags = Array.isArray(row.tags) ? row.tags : [];

  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    username: typeof row.username === "string" ? row.username : null,
    description: typeof row.description === "string" ? row.description : null,
    folderId: typeof row.folderId === "string" ? row.folderId : null,
    status: row.status === "off" ? "off" : "on",
    autoApprove: row.autoApprove === true,
    model: typeof row.model === "string" ? row.model : "",
    authSource: row.authSource === "user" || row.authSource === "shared" ? row.authSource : null,
    triggerType: typeof row.triggerType === "string" ? row.triggerType : "manual",
    integrations: [],
    toolAccessMode: row.toolAccessMode === "selected" ? "selected" : "all",
    allowedIntegrations: allowedIntegrations as CoworkerItem["allowedIntegrations"],
    allowedCustomIntegrations: [],
    allowedWorkspaceMcpServerIds: [],
    allowedSkillSlugs: allowedSkillSlugs.filter((slug): slug is string => typeof slug === "string"),
    schedule: null,
    requiresUserInput: row.requiresUserInput === true,
    userInputPrompt: typeof row.userInputPrompt === "string" ? row.userInputPrompt : null,
    recentRuns: recentRuns.flatMap((run) => {
      if (!run || typeof run !== "object") {
        return [];
      }
      const runRecord = run as Record<string, unknown>;
      return [
        {
          id: String(runRecord.id),
          coworkerId:
            typeof runRecord.coworkerId === "string" ? runRecord.coworkerId : String(row.id),
          status: typeof runRecord.status === "string" ? runRecord.status : "unknown",
          generationId: typeof runRecord.generationId === "string" ? runRecord.generationId : null,
          conversationId:
            typeof runRecord.conversationId === "string" ? runRecord.conversationId : null,
          startedAt: serializeDate(runRecord.startedAt) ?? new Date(0),
          finishedAt: serializeDate(runRecord.finishedAt),
          errorMessage: null,
          source: "manual" as const,
        },
      ];
    }),
    isPinned: row.isPinned === true,
    sharedAt: serializeDate(row.sharedAt),
    updatedAt: serializeDate(row.updatedAt) ?? new Date(0),
    lastRunStatus: typeof row.lastRunStatus === "string" ? row.lastRunStatus : "",
    lastRunAt: serializeDate(row.lastRunAt) ?? new Date(0),
    tags: tags.flatMap((tag) => {
      if (!tag || typeof tag !== "object") {
        return [];
      }
      const tagRecord = tag as Record<string, unknown>;
      return [
        {
          id: String(tagRecord.id),
          name: typeof tagRecord.name === "string" ? tagRecord.name : "",
          color: typeof tagRecord.color === "string" ? tagRecord.color : null,
        },
      ];
    }),
  };
}

const loadInitialCoworkers = createServerFn({ method: "GET" }).handler(async () => {
  const [
    { getRequest },
    { getRequestSession },
    { resolveSessionPrincipalWorkspaceId },
    { queryInitialCoworkers },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/server/session-auth"),
    import("@/server/session-principal-workspace"),
    import("@/server/initial-coworkers"),
  ]);
  const request = getRequest();
  const sessionData = await getRequestSession(request.headers);
  const userId = sessionData?.user?.id;

  if (!userId) {
    return EMPTY_INITIAL_COWORKERS_DATA;
  }

  const workspaceId = await resolveSessionPrincipalWorkspaceId(userId);
  const result = await queryInitialCoworkers({
    userId,
    workspaceId,
  });

  return {
    coworkers: result.coworkers.map((row) =>
      serializeInitialCoworker(row as Record<string, unknown>),
    ),
    sharedCount: result.sharedCount,
    tags: result.tags,
    totalCount: result.totalCount,
  };
});

/**
 * Agents shell layout (was src/app/agents/layout.tsx).
 *
 * Protected access lives in `beforeLoad`: an unauthenticated request is redirected to
 * /login (or worktree auto-login) with a callbackUrl back to the originally requested path.
 *
 * The shell still selects its outer chrome from the current pathname, but that is now a
 * presentational concern reading TanStack Router location rather than a global pathname switch.
 */
export const Route = createFileRoute("/agents")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  loader: ({ location }) =>
    location.pathname === "/agents" || location.pathname === "/agents/"
      ? loadInitialCoworkers()
      : EMPTY_INITIAL_COWORKERS_DATA,
  component: AgentsLayout,
});

function AgentsLayout() {
  const { sessionContext } = Route.useRouteContext();
  const initialCoworkers = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const isRunsRoute = pathname.startsWith("/agents/runs");
  const isOrgChartRoute = pathname === "/agents/org-chart";
  const isCoworkerEditorRoute = pathname.startsWith("/agents/edit/");
  const isCoworkerInfoRoute = pathname.startsWith("/agents/info/");
  const isAgentsIndexRoute = pathname === "/agents" || pathname === "/agents/";

  useEffect(() => {
    const handleOpenDrawer = () => setRecentDrawerOpen(true);
    window.addEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
    return () => window.removeEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
  }, []);

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      {isRunsRoute || isOrgChartRoute || isCoworkerInfoRoute ? (
        <Outlet />
      ) : isCoworkerEditorRoute ? (
        <div className="bg-background flex h-full min-h-0 w-full flex-1 overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <div className="bg-background min-h-screen">
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
            {isAgentsIndexRoute ? (
              <CoworkersPage
                initialCoworkerSharedCount={initialCoworkers.sharedCount}
                initialCoworkerTags={initialCoworkers.tags}
                initialCoworkerTotalCount={initialCoworkers.totalCount}
                initialCoworkers={initialCoworkers.coworkers}
              />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      )}

      <MobileRecentDrawer
        open={recentDrawerOpen}
        onOpenChange={setRecentDrawerOpen}
        mode="coworkers"
      />
    </AuthenticatedAppRootShell>
  );
}
