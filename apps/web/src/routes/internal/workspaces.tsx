// oxlint-disable jsx-a11y/control-has-associated-label

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Check,
  Cuboid,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBillingOverview } from "@/orpc/hooks/billing";
import {
  useAdminAddWorkspaceMembers,
  useAdminCreateWorkspace,
  useAdminJoinWorkspace,
  useAdminRemoveWorkspaceMember,
  useAdminRenameWorkspace,
  useAdminWorkspaces,
} from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/internal/workspaces")({
  head: () => ({ meta: [{ title: "Workspaces - Bap" }] }),
  component: AdminWorkspacesPage,
});

type WorkspaceMember = {
  email: string;
  name: string;
  role: string;
};

type WorkspaceData = {
  id: string;
  name: string;
  slug: string | null;
  billingPlanId: string;
  createdAt: string | Date | null;
  coworkerCount: number;
  members: WorkspaceMember[];
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "N/A";
  }
  return new Date(value).toLocaleDateString();
}

function InlineMember({
  member,
  workspaceId,
  onRemove,
  isRemoving,
  isLast,
}: {
  member: WorkspaceMember;
  workspaceId: string;
  onRemove: (workspaceId: string, email: string) => void;
  isRemoving: boolean;
  isLast: boolean;
}) {
  const handleRemove = useCallback(() => {
    onRemove(workspaceId, member.email);
  }, [onRemove, workspaceId, member.email]);

  return (
    <span className="hover:bg-muted/40 group inline-flex items-center gap-0.5 rounded px-1 py-px transition-colors">
      <span className="text-muted-foreground text-xs">
        {member.email}
        {member.role === "owner" && (
          <span className="text-muted-foreground/60 ml-0.5 text-[10px]">({member.role})</span>
        )}
        {!isLast && <span className="text-muted-foreground/40 ml-0.5">,</span>}
      </span>
      <button
        type="button"
        onClick={handleRemove}
        disabled={isRemoving}
        className="text-muted-foreground hover:text-destructive shrink-0 rounded-sm p-px opacity-0 transition-all group-hover:opacity-100 disabled:opacity-50"
        title={`Remove ${member.email}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function AddMembersForm({
  workspaceId,
  onAdd,
  isAdding,
}: {
  workspaceId: string;
  onAdd: (workspaceId: string, emails: string[]) => void;
  isAdding: boolean;
}) {
  const [input, setInput] = useState("");

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const emails = input
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter(Boolean);
      if (emails.length === 0) {
        return;
      }
      onAdd(workspaceId, emails);
      setInput("");
    },
    [input, onAdd, workspaceId],
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        value={input}
        onChange={handleChange}
        placeholder="emails (comma-separated)"
        className="placeholder:text-muted-foreground/50 text-muted-foreground h-auto min-w-0 flex-1 border-b border-transparent bg-transparent py-px text-xs outline-none focus:border-current"
        disabled={isAdding}
        autoFocus
      />
      <button
        type="submit"
        disabled={isAdding || !input.trim()}
        className="text-muted-foreground hover:text-foreground shrink-0 text-xs transition-colors disabled:opacity-30"
      >
        {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      </button>
    </form>
  );
}

function CreateWorkspaceForm({
  onCreate,
  isCreating,
}: {
  onCreate: (name: string, ownerEmail: string) => void;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleEmailChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      if (trimmedName.length < 2 || !trimmedEmail) {
        return;
      }
      onCreate(trimmedName, trimmedEmail);
      setName("");
      setEmail("");
    },
    [name, email, onCreate],
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Input
        value={name}
        onChange={handleNameChange}
        placeholder="Workspace name"
        className="h-8 max-w-48 text-sm"
        disabled={isCreating}
      />
      <Input
        value={email}
        onChange={handleEmailChange}
        placeholder="Owner email"
        type="email"
        className="h-8 max-w-56 text-sm"
        disabled={isCreating}
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={isCreating || name.trim().length < 2 || !email.trim()}
      >
        {isCreating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create
          </>
        )}
      </Button>
    </form>
  );
}

function EditableName({
  workspaceId,
  name,
  onRename,
  isRenaming,
}: {
  workspaceId: string;
  name: string;
  onRename: (workspaceId: string, name: string) => void;
  isRenaming: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setValue(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [name]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name && trimmed.length >= 2) {
      onRename(workspaceId, trimmed);
    }
    setEditing(false);
  }, [value, name, workspaceId, onRename]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        submit();
      } else if (event.key === "Escape") {
        setEditing(false);
      }
    },
    [submit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onBlur={submit}
        onKeyDown={handleKeyDown}
        disabled={isRenaming}
        className="focus:border-foreground/30 truncate border-b border-transparent bg-transparent text-sm font-medium outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="group flex items-center gap-1 truncate text-sm font-medium hover:underline"
      title="Click to rename"
    >
      {name}
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
    </button>
  );
}

function WorkspaceCard({
  workspace,
  isMember,
  onJoin,
  isJoining,
  onRemoveMember,
  isRemoving,
  onAddMembers,
  isAdding,
  onRename,
  isRenaming,
}: {
  workspace: WorkspaceData;
  isMember: boolean;
  onJoin: (workspaceId: string) => void;
  isJoining: boolean;
  onRemoveMember: (workspaceId: string, email: string) => void;
  isRemoving: boolean;
  onAddMembers: (workspaceId: string, emails: string[]) => void;
  isAdding: boolean;
  onRename: (workspaceId: string, name: string) => void;
  isRenaming: boolean;
}) {
  const [showAddForm, setShowAddForm] = useState(false);

  const handleJoin = useCallback(() => {
    onJoin(workspace.id);
  }, [onJoin, workspace.id]);

  const toggleAddForm = useCallback(() => {
    setShowAddForm((prev) => !prev);
  }, []);

  return (
    <div className="bg-card rounded-xl border p-5 transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <EditableName
              workspaceId={workspace.id}
              name={workspace.name}
              onRename={onRename}
              isRenaming={isRenaming}
            />
            <span className="text-muted-foreground bg-muted/60 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
              {workspace.billingPlanId}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground bg-muted/60 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                  <Users className="h-2.5 w-2.5" />
                  {workspace.members.length}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {workspace.members.length} user{workspace.members.length === 1 ? "" : "s"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground bg-muted/60 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                  <Cuboid className="h-2.5 w-2.5" />
                  {workspace.coworkerCount}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {workspace.coworkerCount} coworker{workspace.coworkerCount === 1 ? "" : "s"}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {workspace.slug ?? workspace.id}
            <span className="mx-1.5 opacity-40">&middot;</span>
            {formatDate(workspace.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMember ? (
            <span className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
              <Check className="h-3 w-3" />
              Joined
            </span>
          ) : (
            <Button variant="outline" size="sm" disabled={isJoining} onClick={handleJoin}>
              {isJoining ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Join
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Members inline */}
      <div className="mt-3 max-h-24 overflow-y-auto">
        {workspace.members.length > 0 ? (
          <div className="flex flex-wrap items-center gap-y-0.5">
            {workspace.members.map((member, i) => (
              <InlineMember
                key={member.email}
                member={member}
                workspaceId={workspace.id}
                onRemove={onRemoveMember}
                isRemoving={isRemoving}
                isLast={i === workspace.members.length - 1}
              />
            ))}
            {!showAddForm && (
              <button
                type="button"
                onClick={toggleAddForm}
                className="text-muted-foreground hover:text-foreground hover:bg-muted/40 ml-1 inline-flex items-center gap-0.5 rounded px-1 py-px text-xs transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={toggleAddForm}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add members
          </button>
        )}
      </div>

      {/* Add form - revealed on click */}
      {showAddForm && (
        <div className="mt-2">
          <AddMembersForm workspaceId={workspace.id} onAdd={onAddMembers} isAdding={isAdding} />
        </div>
      )}
    </div>
  );
}

export function AdminWorkspacesPage() {
  const { data: workspacesData, isLoading } = useAdminWorkspaces();
  const { data: billingOverview } = useBillingOverview();
  const joinWorkspace = useAdminJoinWorkspace();
  const addMembers = useAdminAddWorkspaceMembers();
  const removeMember = useAdminRemoveWorkspaceMember();
  const renameWorkspace = useAdminRenameWorkspace();
  const createWorkspace = useAdminCreateWorkspace();
  const [search, setSearch] = useState("");

  const myWorkspaceIds = useMemo(() => {
    if (!billingOverview?.workspaces) {
      return new Set<string>();
    }
    return new Set(billingOverview.workspaces.map((ws) => ws.id));
  }, [billingOverview?.workspaces]);

  const stats = useMemo(() => {
    if (!workspacesData) {
      return { total: 0, members: 0, coworkers: 0, joined: 0 };
    }
    return {
      total: workspacesData.length,
      members: workspacesData.reduce((sum, ws) => sum + ws.members.length, 0),
      coworkers: workspacesData.reduce((sum, ws) => sum + ws.coworkerCount, 0),
      joined: workspacesData.filter((ws) => myWorkspaceIds.has(ws.id)).length,
    };
  }, [workspacesData, myWorkspaceIds]);

  const filteredWorkspaces = useMemo(() => {
    if (!workspacesData) {
      return [];
    }
    const query = search.trim().toLowerCase();
    if (!query) {
      return workspacesData;
    }
    return workspacesData.filter(
      (ws) =>
        ws.name.toLowerCase().includes(query) ||
        (ws.slug && ws.slug.toLowerCase().includes(query)) ||
        ws.members.some((m) => m.email.toLowerCase().includes(query)),
    );
  }, [workspacesData, search]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  }, []);

  const handleJoin = useCallback(
    async (workspaceId: string) => {
      try {
        const ws = await joinWorkspace.mutateAsync({ workspaceId });
        toast.success(`Joined "${ws.name}" as admin and switched to it.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to join workspace.");
      }
    },
    [joinWorkspace],
  );

  const handleAddMembers = useCallback(
    async (workspaceId: string, emails: string[]) => {
      try {
        const result = await addMembers.mutateAsync({ workspaceId, emails });
        const count = result.added.length;
        toast.success(
          count > 0
            ? `Added ${count} member${count === 1 ? "" : "s"}.`
            : "No matching users were added (they may not have accounts yet).",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add members.");
      }
    },
    [addMembers],
  );

  const handleCreate = useCallback(
    async (name: string, ownerEmail: string) => {
      try {
        const ws = await createWorkspace.mutateAsync({ name, ownerEmail });
        toast.success(`Created workspace "${ws.name}".`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create workspace.");
      }
    },
    [createWorkspace],
  );

  const handleRename = useCallback(
    async (workspaceId: string, name: string) => {
      try {
        await renameWorkspace.mutateAsync({ workspaceId, name });
        toast.success(`Workspace renamed to "${name}".`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rename workspace.");
      }
    },
    [renameWorkspace],
  );

  const handleRemoveMember = useCallback(
    async (workspaceId: string, email: string) => {
      try {
        await removeMember.mutateAsync({ workspaceId, email });
        toast.success(`Removed ${email} from workspace.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove member.");
      }
    },
    [removeMember],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workspaces</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Browse all workspaces. Add or remove members to manage access.
          </p>
        </div>
        <CreateWorkspaceForm onCreate={handleCreate} isCreating={createWorkspace.isPending} />
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={handleSearchChange}
          placeholder="Filter by name, slug, or member email"
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {stats.total} workspaces
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {stats.members} members
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {stats.coworkers} coworkers
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {stats.joined} joined
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : filteredWorkspaces.length === 0 ? (
        <div className="border-border/60 bg-muted/20 rounded-xl border border-dashed p-8 text-center">
          <Building2 className="text-muted-foreground mx-auto h-6 w-6" />
          <p className="mt-3 text-sm font-medium">
            {search ? "No workspaces match your search" : "No workspaces found"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredWorkspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              isMember={myWorkspaceIds.has(ws.id)}
              onJoin={handleJoin}
              isJoining={joinWorkspace.isPending}
              onRemoveMember={handleRemoveMember}
              isRemoving={removeMember.isPending}
              onAddMembers={handleAddMembers}
              isAdding={addMembers.isPending}
              onRename={handleRename}
              isRenaming={renameWorkspace.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
