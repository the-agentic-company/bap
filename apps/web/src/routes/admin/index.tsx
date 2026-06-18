import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Search } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { useBillingOverview } from "@/orpc/hooks/billing";
import { useWorkspaceMembers } from "@/orpc/hooks/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "User Management - Bap" }] }),
  component: AdminWorkspaceUsersPage,
});

type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

const EMPTY_WORKSPACE_MEMBERS: WorkspaceMember[] = [];

function getDisplayRole(role: string) {
  return role === "owner" || role === "admin" ? "Admin" : "User";
}

function RoleBadge({ role }: { role: string }) {
  const displayRole = getDisplayRole(role);
  const isAdmin = displayRole === "Admin";

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium",
        isAdmin
          ? "border-sidebar-primary/20 bg-sidebar-primary/10 text-sidebar-primary"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {displayRole}
    </span>
  );
}

function WorkspaceMemberRow({ member }: { member: WorkspaceMember }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{member.name || member.email}</p>
      <p className="text-muted-foreground truncate text-sm">{member.email}</p>
    </div>
  );
}

const ADMIN_WORKSPACE_USER_COLUMNS: ColumnDef<WorkspaceMember, unknown>[] = [
  {
    accessorKey: "email",
    header: "User",
    cell: ({ row }) => <WorkspaceMemberRow member={row.original} />,
  },
  {
    accessorKey: "role",
    header: "Role",
    meta: { align: "right" as const },
    cell: ({ row }) => <RoleBadge role={row.original.role} />,
  },
];

function AdminWorkspaceUsersPage() {
  const { data: billingOverview, isLoading: overviewLoading } = useBillingOverview();
  const activeWorkspaceId = billingOverview?.owner.ownerId;
  const activeWorkspace = billingOverview?.workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(activeWorkspaceId);
  const members = membersData?.members ?? EMPTY_WORKSPACE_MEMBERS;
  const isLoading = overviewLoading || membersLoading;
  const [globalFilter, setGlobalFilter] = useState("");
  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setGlobalFilter(event.target.value),
    [],
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">User Management</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {activeWorkspace?.name
            ? `People in ${activeWorkspace.name} and their admin access.`
            : "People in the active workspace and their admin access."}
        </p>
      </div>

      <div className="bg-card rounded-lg border">
        <div className="border-b p-3">
          <div className="relative max-w-xs">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
            <Input
              placeholder="Filter by email or name..."
              value={globalFilter}
              onChange={handleFilterChange}
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : members.length > 0 ? (
          <DataTable
            columns={ADMIN_WORKSPACE_USER_COLUMNS}
            data={members}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
          />
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-muted-foreground text-sm">No users found in this workspace.</p>
          </div>
        )}
      </div>
    </div>
  );
}
