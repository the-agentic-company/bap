import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CoworkerOverviewDashboard } from "@/components/coworker-overview-dashboard";
import { useAdminCoworkerOverview } from "@/orpc/hooks/admin";
import { useAdminWorkspaces } from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/admin/coworker-overview")({
  head: () => ({ meta: [{ title: "Coworker Overview - CmdClaw" }] }),
  component: AdminCoworkerOverviewPage,
});

function AdminCoworkerOverviewPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>("all");

  const workspacesQuery = useAdminWorkspaces();
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data]);

  useEffect(() => {
    setWorkspaceId((current) => {
      if (!current) {
        return "all";
      }
      if (current === "all") {
        return current;
      }
      if (workspaces.some((ws) => ws.id === current)) {
        return current;
      }
      return "all";
    });
  }, [workspaces]);

  const overviewQuery = useAdminCoworkerOverview(workspaceId);

  const handleWorkspaceChange = useCallback((id: string) => {
    setWorkspaceId(id);
  }, []);

  return (
    <CoworkerOverviewDashboard
      data={overviewQuery.data}
      isLoading={workspacesQuery.isLoading || (overviewQuery.isLoading && !overviewQuery.data)}
      workspaces={workspaces}
      workspaceId={workspaceId}
      onWorkspaceChange={handleWorkspaceChange}
      coworkerLinkPrefix="/agents/edit/"
    />
  );
}
