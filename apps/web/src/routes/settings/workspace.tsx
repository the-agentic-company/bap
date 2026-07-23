import type { ChangeEvent, FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkspaceAvatar } from "@/components/workspace-avatar";
import { clientEditionCapabilities } from "@/lib/edition";
import { useBillingOverview, useSwitchWorkspace } from "@/orpc/hooks/billing";
import {
  useCancelWorkspaceInvitation,
  useInviteWorkspaceMembers,
  useRemoveWorkspaceImage,
  useRenameWorkspace,
  useUpdateWorkspaceImage,
  useWorkspaceMembers,
} from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/settings/workspace")({
  head: () => ({ meta: [{ title: "Workspace Settings - Bap" }] }),
  component: WorkspaceSettingsPage,
});

const EMPTY_WORKSPACE_OPTIONS: Array<{
  id: string;
  name: string;
  imageUrl?: string | null;
  role?: string;
}> = [];

type InviteRole = "admin" | "member";

const WORKSPACE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WORKSPACE_IMAGE_MIME_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"] as const;

type WorkspaceImageMimeType = (typeof WORKSPACE_IMAGE_MIME_TYPES)[number];

function isWorkspaceImageMimeType(value: string): value is WorkspaceImageMimeType {
  return WORKSPACE_IMAGE_MIME_TYPES.includes(value as WorkspaceImageMimeType);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Failed to read file.")),
      {
        once: true,
      },
    );
    reader.addEventListener(
      "load",
      () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const [, contentBase64 = ""] = result.split(",", 2);
        resolve(contentBase64);
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

function WorkspaceRow({
  imageUrl,
  name,
  role,
  isActive,
  isPending,
  onSwitch,
  workspaceId,
}: {
  imageUrl?: string | null;
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
      <div className="flex min-w-0 items-center gap-3">
        <WorkspaceAvatar name={name} imageUrl={imageUrl} className="h-9 w-9 rounded-md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-muted-foreground truncate text-xs capitalize">{role}</p>
        </div>
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

function PendingInvitationRow({
  email,
  invitationId,
  role,
  canCancel,
  isCanceling,
  onCancel,
}: {
  email: string;
  invitationId: string;
  role: string;
  canCancel: boolean;
  isCanceling: boolean;
  onCancel: (id: string) => Promise<void> | void;
}) {
  const t = useGT();
  const handleCancel = useCallback(() => {
    void onCancel(invitationId);
  }, [invitationId, onCancel]);

  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{email}</p>
        <p className="text-muted-foreground truncate text-sm">
          <T>Invitation pending</T>
        </p>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground text-xs capitalize">{role}</span>
        {canCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("Cancel invitation")}
            disabled={isCanceling}
            onClick={handleCancel}
          >
            {isCanceling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceSettingsPage() {
  const t = useGT();

  const navigate = useNavigate();
  const { data, isLoading } = useBillingOverview();
  const inviteMembers = useInviteWorkspaceMembers();
  const cancelInvitation = useCancelWorkspaceInvitation();
  const renameWorkspace = useRenameWorkspace();
  const updateWorkspaceImage = useUpdateWorkspaceImage();
  const removeWorkspaceImage = useRemoveWorkspaceImage();
  const switchWorkspace = useSwitchWorkspace();
  const workspaceImageInputRef = useRef<HTMLInputElement>(null);
  const [inviteEmailsInput, setInviteEmailsInput] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");

  const activeWorkspaceId = data?.owner.ownerId;
  const workspaceOptions = data?.workspaces ?? EMPTY_WORKSPACE_OPTIONS;
  const activeWorkspace = workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId);
  const activeWorkspaceName = activeWorkspace?.name ?? "Workspace";
  const activeWorkspaceImageUrl = activeWorkspace?.imageUrl ?? null;
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(activeWorkspaceId);

  const canInviteMembers =
    membersData?.membershipRole === "owner" || membersData?.membershipRole === "admin";
  const canUpdateWorkspaceImage = Boolean(membersData?.membershipRole);
  const members = membersData?.members ?? [];
  const invitations = membersData?.invitations ?? [];
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

  const handleInviteRoleChange = useCallback((value: string) => {
    setInviteRole(value as InviteRole);
  }, []);

  const handleWorkspaceNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setWorkspaceNameInput(event.target.value);
  }, []);

  const handleTriggerWorkspaceImageUpload = useCallback(() => {
    workspaceImageInputRef.current?.click();
  }, []);

  const handleWorkspaceImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file || !activeWorkspaceId) {
        return;
      }

      if (!isWorkspaceImageMimeType(file.type)) {
        toast.error(t("Use a PNG, JPEG, WebP, or GIF image."));
        return;
      }

      if (file.size > WORKSPACE_IMAGE_MAX_BYTES) {
        toast.error(t("Workspace image must be 10 MB or smaller."));
        return;
      }

      try {
        await updateWorkspaceImage.mutateAsync({
          workspaceId: activeWorkspaceId,
          mimeType: file.type,
          contentBase64: await readFileAsBase64(file),
        });
        toast.success(t("Workspace picture updated."));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update workspace picture.");
      }
    },
    [activeWorkspaceId, t, updateWorkspaceImage],
  );

  const handleRemoveWorkspaceImage = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }

    try {
      await removeWorkspaceImage.mutateAsync({ workspaceId: activeWorkspaceId });
      toast.success(t("Workspace picture removed."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove workspace picture.");
    }
  }, [activeWorkspaceId, removeWorkspaceImage, t]);

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
          role: inviteRole,
        });
        const invitedCount = Array.isArray(result)
          ? result.length
          : Array.isArray((result as { invited?: unknown }).invited)
            ? (result as { invited: string[] }).invited.length
            : 0;
        toast.success(
          invitedCount > 0
            ? `Invited ${invitedCount} member${invitedCount === 1 ? "" : "s"}.`
            : "No invitations were created.",
        );
        setInviteEmailsInput("");
        setInviteRole("member");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to invite members.");
      }
    },
    [activeWorkspaceId, inviteMembers, inviteRole, parsedInviteEmails, t],
  );

  const handleCancelInvitation = useCallback(
    async (invitationId: string) => {
      if (!activeWorkspaceId) {
        return;
      }

      try {
        await cancelInvitation.mutateAsync({
          workspaceId: activeWorkspaceId,
          invitationId,
        });
        toast.success(t("Invitation canceled."));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to cancel invitation.");
      }
    },
    [activeWorkspaceId, cancelInvitation, t],
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
                imageUrl={workspace.imageUrl}
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
            <T>Workspace picture</T>
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            <T>Shown in the sidebar and workspace switcher.</T>
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceAvatar
              name={activeWorkspaceName}
              imageUrl={activeWorkspaceImageUrl}
              className="h-14 w-14 rounded-xl text-lg"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{activeWorkspaceName}</p>
              <p className="text-muted-foreground text-sm">
                <T>PNG, JPEG, WebP, or GIF. Max 10 MB.</T>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={workspaceImageInputRef}
              type="file"
              aria-label={t("Workspace picture")}
              accept={WORKSPACE_IMAGE_MIME_TYPES.join(",")}
              className="hidden"
              onChange={handleWorkspaceImageChange}
              disabled={!canUpdateWorkspaceImage || updateWorkspaceImage.isPending}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleTriggerWorkspaceImageUpload}
              disabled={!canUpdateWorkspaceImage || updateWorkspaceImage.isPending}
            >
              {updateWorkspaceImage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              <span>
                <T>Upload</T>
              </span>
            </Button>
            {activeWorkspaceImageUrl ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleRemoveWorkspaceImage}
                disabled={!canUpdateWorkspaceImage || removeWorkspaceImage.isPending}
              >
                {removeWorkspaceImage.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span>
                  <T>Remove</T>
                </span>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

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
              <Select
                value={inviteRole}
                onValueChange={handleInviteRoleChange}
                disabled={!canInviteMembers || inviteMembers.isPending}
              >
                <SelectTrigger aria-label={t("Role")} className="sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="member">
                    <T>Member</T>
                  </SelectItem>
                  <SelectItem value="admin">
                    <T>Admin</T>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={!canInviteMembers || inviteMembers.isPending}>
                {inviteMembers.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Invite members"
                )}
              </Button>
            </form>

            {!canInviteMembers ? (
              <p className="text-muted-foreground mt-3 text-sm">
                <T>Workspace admin access is required to add members.</T>
              </p>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                <T>Invited people get access after accepting their workspace invitation.</T>
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

        {invitations.length > 0 ? (
          <div className="mt-5 space-y-3">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <T>Pending invitations</T>
            </p>
            {invitations.map((invitation) => (
              <PendingInvitationRow
                key={invitation.id}
                email={invitation.email}
                invitationId={invitation.id}
                role={invitation.role}
                canCancel={canInviteMembers}
                isCanceling={cancelInvitation.isPending}
                onCancel={handleCancelInvitation}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
