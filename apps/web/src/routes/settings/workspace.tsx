import type { ChangeEvent, FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientEditionCapabilities } from "@/lib/edition";
import { useBillingOverview, useSwitchWorkspace } from "@/orpc/hooks/billing";
import {
  useInviteWorkspaceMembers,
  useRenameWorkspace,
  useWorkspaceMembers,
} from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/settings/workspace")({
  head: () => ({ meta: [{ title: "Workspace Settings - CmdClaw" }] }),
  component: WorkspaceSettingsPage,
});

const EMPTY_WORKSPACE_OPTIONS: Array<{
  id: string;
  name: string;
  role?: string;
}> = [];

function WorkspaceRow({
  name,
  role,
  isActive,
  isPending,
  onSwitch,
  workspaceId,
}: {
  name: string;
  role: string;
  isActive: boolean;
  isPending: boolean;
  onSwitch: (id: string) => void;
  workspaceId: string;
}) {
  const handleClick = useCallback(() => {
    onSwitch(workspaceId);
  }, [onSwitch, workspaceId]);

  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-xs capitalize">{role}</p>
      </div>
      {isActive ? (
        <span className="text-muted-foreground text-xs font-medium">
          <T>Active</T>
        </span>
      ) : (
        <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Switch"}
        </Button>
      )}
    </div>
  );
}

function WorkspaceSettingsPage() {
  const t = useGT();

  const navigate = useNavigate();
  const { data, isLoading } = useBillingOverview();
  const inviteMembers = useInviteWorkspaceMembers();
  const renameWorkspace = useRenameWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const [inviteEmailsInput, setInviteEmailsInput] = useState("");
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");

  const activeWorkspaceId = data?.owner.ownerId;
  const workspaceOptions = data?.workspaces ?? EMPTY_WORKSPACE_OPTIONS;
  const activeWorkspaceName =
    workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? "Workspace";
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(activeWorkspaceId);

  const canInviteMembers =
    membersData?.membershipRole === "owner" || membersData?.membershipRole === "admin";
  const members = membersData?.members ?? [];
  const parsedInviteEmails = useMemo(
    () =>
      inviteEmailsInput
        .split(/[,\n]/)
        .map((email) => email.trim())
        .filter(Boolean),
    [inviteEmailsInput],
  );
  const nameChanged = workspaceNameInput.trim() !== activeWorkspaceName;

  useEffect(() => {
    setWorkspaceNameInput(activeWorkspaceName);
  }, [activeWorkspaceName]);

  const handleSwitchWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await switchWorkspace.mutateAsync(workspaceId);
        // `href` escape hatch: the home route is owned by another migration area and may
        // not be in the typed route tree yet.
        navigate({ to: "/" });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to switch workspace.");
      }
    },
    [navigate, switchWorkspace],
  );

  const handleInviteEmailsChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setInviteEmailsInput(event.target.value);
  }, []);

  const handleWorkspaceNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setWorkspaceNameInput(event.target.value);
  }, []);

  const handleRenameSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!activeWorkspaceId) {
        return;
      }

      const trimmedName = workspaceNameInput.trim();
      if (trimmedName.length < 2) {
        toast.error(t("Workspace name must be at least 2 characters."));
        return;
      }

      try {
        await renameWorkspace.mutateAsync({
          workspaceId: activeWorkspaceId,
          name: trimmedName,
        });
        toast.success(t("Workspace renamed."));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rename workspace.");
      }
    },
    [activeWorkspaceId, renameWorkspace, workspaceNameInput, t],
  );

  const handleInviteSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!activeWorkspaceId) {
        return;
      }

      if (parsedInviteEmails.length === 0) {
        toast.error(t("Enter at least one email address."));
        return;
      }

      try {
        const result = await inviteMembers.mutateAsync({
          workspaceId: activeWorkspaceId,
          emails: parsedInviteEmails,
        });
        const addedCount = result.added.length;
        toast.success(
          addedCount > 0
            ? `Added ${addedCount} member${addedCount === 1 ? "" : "s"}.`
            : "No matching users were added.",
        );
        setInviteEmailsInput("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add members.");
      }
    },
    [activeWorkspaceId, inviteMembers, parsedInviteEmails, t],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          <T>Workspace</T>
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          <T>Manage settings for your active workspace.</T>
        </p>
      </div>

      {clientEditionCapabilities.edition === "cloud" && workspaceOptions.length > 1 ? (
        <section className="rounded-lg border p-5">
          <div>
            <h3 className="text-sm font-medium">
              <T>Your workspaces</T>
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              <T>Switch between workspaces you belong to.</T>
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {workspaceOptions.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                name={workspace.name}
                role={workspace.role ?? "member"}
                isActive={workspace.id === activeWorkspaceId}
                isPending={switchWorkspace.isPending}
                onSwitch={handleSwitchWorkspace}
                workspaceId={workspace.id}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border p-5">
        <div>
          <h3 className="text-sm font-medium">
            <T>Workspace name</T>
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            <T>Update how this workspace appears across the app.</T>
          </p>
        </div>

        <form onSubmit={handleRenameSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            value={workspaceNameInput}
            onChange={handleWorkspaceNameChange}
            placeholder={t("Enter workspace name")}
            disabled={!canInviteMembers || renameWorkspace.isPending}
          />
          <Button
            type="submit"
            disabled={!canInviteMembers || renameWorkspace.isPending || !nameChanged}
          >
            {renameWorkspace.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save changes"
            )}
          </Button>
        </form>

        {clientEditionCapabilities.hasBilling ? (
          <p className="text-muted-foreground mt-3 text-sm">
            <T>Workspace billing and credit management stay in the Billing and Usage tabs.</T>
          </p>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            <T>This self-hosted deployment keeps one workspace for the whole instance.</T>
          </p>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <div>
          <h3 className="text-sm font-medium">
            <T>Members</T>
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            <T>Review current access for this workspace.</T>
          </p>
        </div>

        {clientEditionCapabilities.edition === "cloud" ? (
          <>
            <form onSubmit={handleInviteSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Input
                value={inviteEmailsInput}
                onChange={handleInviteEmailsChange}
                placeholder={t("alice@example.com, bob@example.com")}
                disabled={!canInviteMembers || inviteMembers.isPending}
              />
              <Button type="submit" disabled={!canInviteMembers || inviteMembers.isPending}>
                {inviteMembers.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Add members"
                )}
              </Button>
            </form>

            {!canInviteMembers ? (
              <p className="text-muted-foreground mt-3 text-sm">
                <T>Workspace admin access is required to add members.</T>
              </p>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                <T>Only users with existing accounts can be added right now.</T>
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            <T>New users automatically join this instance workspace after signup.</T>
          </p>
        )}

        <div className="mt-5 space-y-3">
          {membersLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : members.length > 0 ? (
            members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-lg border px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                </div>
                <span className="text-muted-foreground text-xs capitalize">{member.role}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              <T>No members found in this workspace yet.</T>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
