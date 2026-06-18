import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UsageDashboard } from "@/components/usage-dashboard";
import { useAdminUsageDashboard } from "@/orpc/hooks/admin";
import { useAdminWorkspaces } from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/internal/usage")({
  head: () => ({ meta: [{ title: "Usage - Bap" }] }),
  component: AdminUsagePage,
});

function AdminUsagePage() {
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
      if (workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }
      return "all";
    });
  }, [workspaces]);

  const usageQuery = useAdminUsageDashboard(workspaceId);

  const handleWorkspaceChange = useCallback((id: string) => {
    setWorkspaceId(id);
  }, []);

  return (
    <UsageDashboard
      data={usageQuery.data}
      isLoading={workspacesQuery.isLoading || (usageQuery.isLoading && !usageQuery.data)}
      error={workspacesQuery.error ?? usageQuery.error}
      workspaces={workspaces}
      workspaceId={workspaceId}
      onWorkspaceChange={handleWorkspaceChange}
    />
  );
}
