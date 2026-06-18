import { T } from "gt-react";
import { UsageDashboard } from "@/components/usage-dashboard";
import { useWorkspaceUsageDashboard } from "@/orpc/hooks/coworkers";

export default function CoworkerUsagePage() {
  const usageQuery = useWorkspaceUsageDashboard();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          <T>Usage</T>
        </h1>
      </div>
      <UsageDashboard
        data={usageQuery.data}
        isLoading={usageQuery.isLoading && !usageQuery.data}
        error={usageQuery.error}
      />
    </div>
  );
}
