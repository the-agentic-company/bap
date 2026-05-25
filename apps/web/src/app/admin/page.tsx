"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Search, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  useAddApprovedLoginEmailAllowlistEntry,
  useAddGoogleAccessAllowlistEntry,
  useSetUserAdminRole,
  useApprovedLoginEmailAllowlist,
  useGoogleAccessAllowlist,
  useRemoveApprovedLoginEmailAllowlistEntry,
  useRemoveGoogleAccessAllowlistEntry,
} from "@/orpc/hooks";
import { getImpersonationErrorMessage } from "./impersonation-errors";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type AdminListUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
};

type UnifiedUserRow = {
  email: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  hasAccount: boolean;
  approvedLoginId: string | null;
  isLoginApproved: boolean;
  isBuiltInApproved: boolean;
  googleAccessId: string | null;
  hasGoogleAccess: boolean;
};

function readImpersonatedBy(sessionData: SessionData | null): string | null {
  if (!sessionData) {
    return null;
  }
  const maybeSession = (sessionData as { session?: { impersonatedBy?: unknown } }).session;
  if (!maybeSession) {
    return null;
  }
  return typeof maybeSession.impersonatedBy === "string" && maybeSession.impersonatedBy.length > 0
    ? maybeSession.impersonatedBy
    : null;
}

function makeEmptyRow(email: string): UnifiedUserRow {
  return {
    email,
    userId: null,
    userName: null,
    userRole: null,
    hasAccount: false,
    approvedLoginId: null,
    isLoginApproved: false,
    isBuiltInApproved: false,
    googleAccessId: null,
    hasGoogleAccess: false,
  };
}

// ---------------------------------------------------------------------------
// Switch cell for login approved
// ---------------------------------------------------------------------------
function LoginApprovedCell({
  email,
  approvedLoginId,
  isLoginApproved,
  isBuiltInApproved,
  addMutation,
  removeMutation,
}: {
  email: string;
  approvedLoginId: string | null;
  isLoginApproved: boolean;
  isBuiltInApproved: boolean;
  addMutation: { mutateAsync: (input: { email: string }) => Promise<unknown> };
  removeMutation: { mutateAsync: (input: { id: string }) => Promise<unknown> };
}) {
  const [pending, setPending] = useState(false);

  const handleChange = useCallback(async () => {
    setPending(true);
    try {
      if (isLoginApproved && approvedLoginId) {
        await removeMutation.mutateAsync({ id: approvedLoginId });
      } else {
        await addMutation.mutateAsync({ email });
      }
    } finally {
      setPending(false);
    }
  }, [email, approvedLoginId, isLoginApproved, addMutation, removeMutation]);

  return (
    <Switch
      checked={isLoginApproved}
      disabled={isBuiltInApproved || pending}
      onCheckedChange={handleChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Switch cell for Google access
// ---------------------------------------------------------------------------
function GoogleAccessCell({
  email,
  googleAccessId,
  hasGoogleAccess,
  addMutation,
  removeMutation,
}: {
  email: string;
  googleAccessId: string | null;
  hasGoogleAccess: boolean;
  addMutation: { mutateAsync: (input: { email: string }) => Promise<unknown> };
  removeMutation: { mutateAsync: (input: { id: string }) => Promise<unknown> };
}) {
  const [pending, setPending] = useState(false);

  const handleChange = useCallback(async () => {
    setPending(true);
    try {
      if (hasGoogleAccess && googleAccessId) {
        await removeMutation.mutateAsync({ id: googleAccessId });
      } else {
        await addMutation.mutateAsync({ email });
      }
    } finally {
      setPending(false);
    }
  }, [email, googleAccessId, hasGoogleAccess, addMutation, removeMutation]);

  return <Switch checked={hasGoogleAccess} disabled={pending} onCheckedChange={handleChange} />;
}

function AdminRoleCell({
  email,
  userId,
  isAdmin,
  disabled,
  onChange,
}: {
  email: string;
  userId: string;
  isAdmin: boolean;
  disabled: boolean;
  onChange: (userId: string, isAdmin: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  const handleChange = useCallback(
    async (checked: boolean) => {
      setPending(true);
      try {
        await onChange(userId, checked);
      } finally {
        setPending(false);
      }
    },
    [onChange, userId],
  );

  return (
    <Switch
      checked={isAdmin}
      disabled={disabled || pending}
      onCheckedChange={handleChange}
      aria-label={`Admin access for ${email}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Impersonate button cell
// ---------------------------------------------------------------------------
function ImpersonateButton({
  userId,
  disabled,
  isWorking,
  onImpersonate,
}: {
  userId: string;
  disabled: boolean;
  isWorking: boolean;
  onImpersonate: (userId: string) => void;
}) {
  const handleClick = useCallback(() => onImpersonate(userId), [onImpersonate, userId]);
  return (
    <Button variant="ghost" size="sm" disabled={disabled || isWorking} onClick={handleClick}>
      {isWorking ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <UserRoundCog className="h-4 w-4" />
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AdminPage() {
  // -- Data sources --
  const { data: approvedLoginData, isLoading: isApprovedLoginLoading } =
    useApprovedLoginEmailAllowlist();
  const { data: googleAccessData, isLoading: isGoogleAccessLoading } = useGoogleAccessAllowlist();

  const addApprovedLoginEntry = useAddApprovedLoginEmailAllowlistEntry();
  const removeApprovedLoginEntry = useRemoveApprovedLoginEmailAllowlistEntry();
  const addGoogleAccessEntry = useAddGoogleAccessAllowlistEntry();
  const removeGoogleAccessEntry = useRemoveGoogleAccessAllowlistEntry();
  const setUserAdminRole = useSetUserAdminRole();

  const [users, setUsers] = useState<AdminListUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // -- Session / impersonation --
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null);
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);

  const impersonatedBy = useMemo(() => readImpersonatedBy(sessionData), [sessionData]);
  const isCurrentlyImpersonating = Boolean(impersonatedBy);
  const currentUserId = sessionData?.user?.id ?? "";

  // -- Add form state --
  const [newEmail, setNewEmail] = useState("");
  const [addLoginApproved, setAddLoginApproved] = useState(true);
  const [addGoogleAccess, setAddGoogleAccess] = useState(false);
  const [addPending, setAddPending] = useState(false);

  // -- Filter --
  const [globalFilter, setGlobalFilter] = useState("");

  // -- Feedback --
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // -- Load session + users --
  useEffect(() => {
    void authClient.getSession().then((r) => setSessionData(r?.data ?? null));
    void (async () => {
      setLoadingUsers(true);
      try {
        const result = await authClient.admin.listUsers({
          query: { sortBy: "createdAt", sortDirection: "desc", limit: 200 },
        });
        setUsers((result.data?.users ?? []) as AdminListUser[]);
      } catch {
        // non-critical — table still shows allowlist-only emails
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, []);

  // -- Merge data sources --
  const approvedLoginEntries = useMemo(
    () => (Array.isArray(approvedLoginData) ? approvedLoginData : []),
    [approvedLoginData],
  );
  const googleAccessEntries = useMemo(
    () => (Array.isArray(googleAccessData) ? googleAccessData : []),
    [googleAccessData],
  );

  const rows = useMemo<UnifiedUserRow[]>(() => {
    const map = new Map<string, UnifiedUserRow>();

    for (const user of users) {
      const key = user.email.toLowerCase();
      const row = map.get(key) ?? makeEmptyRow(key);
      row.userId = user.id;
      row.userName = user.name;
      row.userRole = user.role ?? null;
      row.hasAccount = true;
      map.set(key, row);
    }

    for (const entry of approvedLoginEntries) {
      const key = entry.email.toLowerCase();
      const row = map.get(key) ?? makeEmptyRow(key);
      row.approvedLoginId = entry.id;
      row.isLoginApproved = true;
      row.isBuiltInApproved = Boolean(entry.isBuiltIn);
      map.set(key, row);
    }

    for (const entry of googleAccessEntries) {
      const key = entry.email.toLowerCase();
      const row = map.get(key) ?? makeEmptyRow(key);
      row.googleAccessId = entry.id;
      row.hasGoogleAccess = true;
      map.set(key, row);
    }

    return Array.from(map.values()).toSorted((a, b) => a.email.localeCompare(b.email));
  }, [users, approvedLoginEntries, googleAccessEntries]);

  const handleImpersonate = useCallback(async (targetUserId: string) => {
    setImpersonatingUserId(targetUserId);
    setActionError(null);
    try {
      const result = await authClient.admin.impersonateUser({ userId: targetUserId });
      if (result.error) {
        setActionError(getImpersonationErrorMessage(result.error));
        return;
      }
      window.location.assign("/chat");
    } catch {
      setActionError("Unable to impersonate.");
    } finally {
      setImpersonatingUserId(null);
    }
  }, []);

  const handleAdminRoleChange = useCallback(
    async (userId: string, isAdmin: boolean) => {
      setActionError(null);
      setActionMessage(null);
      try {
        const updatedUser = await setUserAdminRole.mutateAsync({ userId, isAdmin });
        setUsers((currentUsers) =>
          currentUsers.map((currentUser) =>
            currentUser.id === userId ? { ...currentUser, role: updatedUser.role } : currentUser,
          ),
        );
        const targetUser = users.find((currentUser) => currentUser.id === userId);
        const email = targetUser?.email ?? "User";
        setActionMessage(
          isAdmin ? `${email} now has admin access.` : `${email} no longer has admin access.`,
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to update admin access.");
      }
    },
    [setUserAdminRole, users],
  );

  // -- Column defs --
  const columns = useMemo<ColumnDef<UnifiedUserRow, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="font-medium">{row.original.email}</span>,
      },
      {
        accessorKey: "userName",
        header: "Name",
        cell: ({ row }) => row.original.userName ?? null,
      },
      {
        accessorKey: "hasAccount",
        header: "Account",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              row.original.hasAccount ? "bg-green-500" : "bg-muted-foreground/30",
            )}
            title={row.original.hasAccount ? "Has account" : "No account"}
          />
        ),
      },
      {
        accessorKey: "isLoginApproved",
        header: "Login Approved",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <LoginApprovedCell
              email={r.email}
              approvedLoginId={r.approvedLoginId}
              isLoginApproved={r.isLoginApproved}
              isBuiltInApproved={r.isBuiltInApproved}
              addMutation={addApprovedLoginEntry}
              removeMutation={removeApprovedLoginEntry}
            />
          );
        },
      },
      {
        accessorKey: "hasGoogleAccess",
        header: "Google Access",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <GoogleAccessCell
              email={r.email}
              googleAccessId={r.googleAccessId}
              hasGoogleAccess={r.hasGoogleAccess}
              addMutation={addGoogleAccessEntry}
              removeMutation={removeGoogleAccessEntry}
            />
          );
        },
      },
      {
        accessorKey: "userRole",
        header: "Admin",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.hasAccount || !r.userId) {
            return null;
          }
          return (
            <AdminRoleCell
              email={r.email}
              userId={r.userId}
              isAdmin={r.userRole === "admin"}
              disabled={r.userId === currentUserId}
              onChange={handleAdminRoleChange}
            />
          );
        },
      },
      {
        id: "actions",
        header: "Impersonate",
        meta: { align: "right" as const },
        cell: ({ row }) => {
          const r = row.original;
          if (!r.hasAccount || !r.userId) {
            return null;
          }
          const isSelf = r.userId === currentUserId;
          const isWorking = impersonatingUserId === r.userId;
          return (
            <ImpersonateButton
              userId={r.userId}
              disabled={isSelf || isCurrentlyImpersonating}
              isWorking={isWorking}
              onImpersonate={handleImpersonate}
            />
          );
        },
      },
    ],
    [
      currentUserId,
      impersonatingUserId,
      isCurrentlyImpersonating,
      handleImpersonate,
      handleAdminRoleChange,
      addApprovedLoginEntry,
      removeApprovedLoginEntry,
      addGoogleAccessEntry,
      removeGoogleAccessEntry,
    ],
  );

  // -- Add email handler --
  const handleAddEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const normalized = newEmail.trim().toLowerCase();
      if (!normalized) {
        return;
      }
      if (!addLoginApproved && !addGoogleAccess) {
        setActionError("Select at least one access type.");
        return;
      }
      setActionError(null);
      setActionMessage(null);
      setAddPending(true);
      try {
        if (addLoginApproved) {
          await addApprovedLoginEntry.mutateAsync({ email: normalized });
        }
        if (addGoogleAccess) {
          await addGoogleAccessEntry.mutateAsync({ email: normalized });
        }
        setActionMessage(`Added ${normalized}.`);
        setNewEmail("");
        setAddGoogleAccess(false);
        setAddLoginApproved(true);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to add email.");
      } finally {
        setAddPending(false);
      }
    },
    [newEmail, addLoginApproved, addGoogleAccess, addApprovedLoginEntry, addGoogleAccessEntry],
  );

  // -- Stop impersonation --
  const handleStopImpersonating = useCallback(async () => {
    setStoppingImpersonation(true);
    try {
      const result = await authClient.admin.stopImpersonating();
      if (result.error) {
        setActionError(result.error.message ?? "Failed to stop impersonation.");
        return;
      }
      window.location.assign("/admin");
    } catch {
      setActionError("Failed to stop impersonation.");
    } finally {
      setStoppingImpersonation(false);
    }
  }, []);

  const isLoading = isApprovedLoginLoading || isGoogleAccessLoading || loadingUsers;

  const handleNewEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value),
    [],
  );
  const handleLoginApprovedChange = useCallback(
    (v: boolean | "indeterminate") => setAddLoginApproved(v === true),
    [],
  );
  const handleGoogleAccessChange = useCallback(
    (v: boolean | "indeterminate") => setAddGoogleAccess(v === true),
    [],
  );
  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setGlobalFilter(e.target.value),
    [],
  );
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">User Management</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage login access, Google integration access, admin access, and impersonate users.
        </p>
      </div>

      {/* Feedback banner */}
      {(actionError || actionMessage) && (
        <div
          className={cn(
            "mb-4 rounded-lg border p-3 text-sm",
            actionError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
          )}
        >
          {actionError ?? actionMessage}
        </div>
      )}

      {/* Impersonation banner */}
      {isCurrentlyImpersonating && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-amber-900 dark:text-amber-200">
              You are currently impersonating another account.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopImpersonating}
              disabled={stoppingImpersonation}
            >
              {stoppingImpersonation ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Stopping...
                </>
              ) : (
                "Stop impersonating"
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Add email form */}
      <div className="bg-card mb-4 rounded-lg border p-4">
        <form onSubmit={handleAddEmail} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="email"
            placeholder="user@company.com"
            value={newEmail}
            onChange={handleNewEmailChange}
            className="sm:max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={addLoginApproved} onCheckedChange={handleLoginApprovedChange} />
            Login
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={addGoogleAccess} onCheckedChange={handleGoogleAccessChange} />
            Google
          </label>
          <Button type="submit" size="sm" disabled={addPending}>
            {addPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </form>
      </div>

      {/* Filter + table */}
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
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
          />
        )}
      </div>
    </div>
  );
}
