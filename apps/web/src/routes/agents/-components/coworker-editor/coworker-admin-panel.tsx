import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBillingOverview, useSwitchWorkspace } from "@/orpc/hooks/billing";
import { useCoworker, useMoveCoworkerWorkspace } from "@/orpc/hooks/coworkers";
import { useCurrentUser } from "@/orpc/hooks/user";
import { RemoteIntegrationAdminPanel } from "./remote-integration-admin-panel";
import type { RemoteIntegrationTargetEnv, RemoteIntegrationUserOption } from "./types";

type CoworkerAdminPanelProps = {
  coworkerId?: string;
  availableTargets: RemoteIntegrationTargetEnv[];
  selectedTargetEnv: RemoteIntegrationTargetEnv | null;
  remoteUserQuery: string;
  remoteUserOptions: RemoteIntegrationUserOption[];
  selectedRemoteUser: RemoteIntegrationUserOption | null;
  isSearching: boolean;
  isRunDisabled: boolean;
  isRunning: boolean;
  onTargetEnvChange: (value: string) => void;
  onRemoteUserQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectRemoteUser: (user: RemoteIntegrationUserOption) => void;
  onRun: () => void | Promise<void>;
};

export function CoworkerAdminPanel({
  coworkerId,
  availableTargets,
  selectedTargetEnv,
  remoteUserQuery,
  remoteUserOptions,
  selectedRemoteUser,
  isSearching,
  isRunDisabled,
  isRunning,
  onTargetEnvChange,
  onRemoteUserQueryChange,
  onSelectRemoteUser,
  onRun,
}: CoworkerAdminPanelProps) {
  const t = useGT();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const billingOverview = useBillingOverview();
  const { data: coworker } = useCoworker(coworkerId);
  const moveCoworkerWorkspace = useMoveCoworkerWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const [workspaceMoveTargetId, setWorkspaceMoveTargetId] = useState("");

  const workspaceOptions = useMemo(
    () => billingOverview.data?.workspaces ?? [],
    [billingOverview.data?.workspaces],
  );
  const currentWorkspaceId = coworker?.workspaceId ?? billingOverview.data?.owner.ownerId ?? null;
  const currentWorkspaceName =
    workspaceOptions.find((workspace) => workspace.id === currentWorkspaceId)?.name ?? null;
  const workspaceMoveTargets = useMemo(() => {
    if (!coworker || currentUser.data?.id !== coworker.ownerId || !currentWorkspaceId) {
      return [];
    }

    return workspaceOptions
      .filter((workspace) => workspace.id !== currentWorkspaceId)
      .map((workspace) => ({ id: workspace.id, name: workspace.name }));
  }, [coworker, currentUser.data?.id, currentWorkspaceId, workspaceOptions]);

  useEffect(() => {
    setWorkspaceMoveTargetId((current) => {
      if (workspaceMoveTargets.some((workspace) => workspace.id === current)) {
        return current;
      }
      return workspaceMoveTargets[0]?.id ?? "";
    });
  }, [workspaceMoveTargets]);

  const handleWorkspaceMoveTargetChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setWorkspaceMoveTargetId(event.target.value);
  }, []);

  const handleMoveWorkspace = useCallback(async () => {
    if (!coworkerId || !workspaceMoveTargetId || moveCoworkerWorkspace.isPending) {
      return;
    }

    const targetWorkspace = workspaceMoveTargets.find(
      (workspace) => workspace.id === workspaceMoveTargetId,
    );
    const confirmed = window.confirm(
      [
        `Move this coworker to ${targetWorkspace?.name ?? "the selected workspace"}?`,
        "Folder placement, workspace sharing, selected Workspace MCP Servers, and Builder Chat context will be reset.",
      ].join("\n\n"),
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await moveCoworkerWorkspace.mutateAsync({
        coworkerId,
        targetWorkspaceId: workspaceMoveTargetId,
      });
      await switchWorkspace.mutateAsync(workspaceMoveTargetId);
      toast.success(t("Coworker moved."));
      await navigate({
        to: "/agents/edit/$id",
        params: { id: result.id },
      });
    } catch (error) {
      console.error("Failed to move coworker:", error);
      toast.error(error instanceof Error ? error.message : t("Failed to move coworker."));
    }
  }, [
    coworkerId,
    moveCoworkerWorkspace,
    navigate,
    switchWorkspace,
    t,
    workspaceMoveTargetId,
    workspaceMoveTargets,
  ]);

  return (
    <div className="space-y-3">
      {workspaceMoveTargets.length > 0 ? (
        <section className="border-border bg-muted/20 rounded-lg border p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <ArrowRightLeft className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-foreground text-xs font-medium">
                  <T>Move workspace</T>
                </p>
                <p className="text-muted-foreground mt-0.5 max-w-[60ch] text-xs">
                  <T>Current workspace</T>: {currentWorkspaceName ?? "Unknown"}.{" "}
                  <T>
                    Moving resets folder placement, sharing, selected Workspace MCP Servers, and
                    Builder Chat context.
                  </T>
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={workspaceMoveTargetId}
                onChange={handleWorkspaceMoveTargetChange}
                disabled={moveCoworkerWorkspace.isPending || switchWorkspace.isPending}
                className="border-input bg-background h-8 min-w-0 rounded-md border px-2 text-xs"
                aria-label={t("Target workspace")}
              >
                {workspaceMoveTargets.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={handleMoveWorkspace}
                disabled={
                  moveCoworkerWorkspace.isPending ||
                  switchWorkspace.isPending ||
                  !workspaceMoveTargetId
                }
              >
                {moveCoworkerWorkspace.isPending || switchWorkspace.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowRightLeft className="h-3 w-3" />
                )}
                <T>Move</T>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      <RemoteIntegrationAdminPanel
        availableTargets={availableTargets}
        selectedTargetEnv={selectedTargetEnv}
        remoteUserQuery={remoteUserQuery}
        remoteUserOptions={remoteUserOptions}
        selectedRemoteUser={selectedRemoteUser}
        isSearching={isSearching}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        onTargetEnvChange={onTargetEnvChange}
        onRemoteUserQueryChange={onRemoteUserQueryChange}
        onSelectRemoteUser={onSelectRemoteUser}
        onRun={onRun}
      />
    </div>
  );
}
