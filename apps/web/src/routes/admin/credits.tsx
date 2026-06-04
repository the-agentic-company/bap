import type { ChangeEvent, MouseEvent } from "react";
import { TOP_UP_CREDITS_PER_USD, formatCredits } from "@cmdclaw/core/lib/billing-plans";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Loader2, Plus, Search, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useAdminBillingUserOverview, useAdminManualBillingTopUp } from "@/orpc/hooks/billing";

export const Route = createFileRoute("/admin/credits")({
  head: () => ({ meta: [{ title: "Credits - CmdClaw" }] }),
  component: AdminCreditsPage,
});

type AdminListUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getInitials(name: string | null | undefined, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
    }
    return name.trim()[0]!.toUpperCase();
  }
  return email[0]!.toUpperCase();
}

function formatDateShort(value: string | number | Date | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function UserCardExpanded({ userId, userEmail }: { userId: string; userEmail: string }) {
  const overview = useAdminBillingUserOverview(userId);
  const manualTopUp = useAdminManualBillingTopUp();
  const [topUpUsd, setTopUpUsd] = useState("25");

  const activeWorkspace = overview.data?.activeWorkspace ?? null;
  const feature = overview.data?.feature as
    | {
        balance?: number | null;
        included_usage?: number;
        usage?: number;
        next_reset_at?: number | null;
        breakdown?: Array<{
          interval: string;
          balance?: number;
        }>;
      }
    | null
    | undefined;

  const breakdown = feature?.breakdown ?? [];
  const totalBalance = Math.max(0, Number(feature?.balance ?? 0));
  const topUpBalance = Math.max(
    0,
    Number(breakdown.find((item) => item.interval === "one_off")?.balance ?? 0),
  );
  const showConsumedTopUpHint = topUpBalance === 0 && (overview.data?.recentTopUps.length ?? 0) > 0;
  const topUpPreviewCredits = Math.max(
    0,
    Math.floor(Number(topUpUsd || 0) * TOP_UP_CREDITS_PER_USD),
  );

  const handleTopUpUsdChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTopUpUsd(event.target.value);
  }, []);

  const handleTopUp = useCallback(async () => {
    if (!activeWorkspace) {
      toast.error("Selected user does not have an active workspace.");
      return;
    }

    const usdAmount = Number(topUpUsd);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      toast.error("Enter a positive USD amount.");
      return;
    }

    try {
      const result = await manualTopUp.mutateAsync({
        targetUserId: userId,
        usdAmount,
      });
      toast.success(
        `Granted ${formatCredits(result.creditsGranted)} credits to ${
          overview.data?.targetUser.email ?? userEmail
        }.`,
      );
      await overview.refetch();
    } catch (error) {
      toast.error(toErrorMessage(error, "Failed to grant credits."));
    }
  }, [activeWorkspace, manualTopUp, overview, userId, topUpUsd, userEmail]);

  if (overview.isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (overview.error) {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
        {toErrorMessage(overview.error, "Failed to load billing details.")}
      </div>
    );
  }

  if (!overview.data) {
    return null;
  }

  return (
    <div className="space-y-3 pt-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className={cn(
            "rounded-lg border px-3 py-2",
            activeWorkspace ? "bg-muted/40" : "border-amber-500/30 bg-amber-500/10",
          )}
        >
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            Workspace
          </p>
          <p className="mt-0.5 truncate text-sm font-medium">{activeWorkspace?.name ?? "None"}</p>
          {activeWorkspace && (
            <p className="text-muted-foreground truncate font-mono text-[11px]">
              {activeWorkspace.slug}
            </p>
          )}
        </div>

        <div className="bg-muted/40 rounded-lg border px-3 py-2">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            Plan
          </p>
          <p className="mt-0.5 text-sm font-medium">{overview.data.plan?.name ?? "Free"}</p>
        </div>

        <div className="bg-muted/40 rounded-lg border px-3 py-2">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            Balance
          </p>
          <p className="mt-0.5 font-mono text-sm font-semibold">{formatCredits(totalBalance)}</p>
        </div>
      </div>

      {/* Grant Credits */}
      <div className="rounded-lg border px-3 py-3">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold">Grant Credits</h4>
            <p className="text-muted-foreground mt-0.5 text-xs">
              $1 = {TOP_UP_CREDITS_PER_USD} credits &middot; expires after 12 months
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
              Top-up bal.
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold">{formatCredits(topUpBalance)}</p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="w-28 shrink-0">
            <label className="text-muted-foreground mb-1.5 block text-[11px] font-medium">
              USD
            </label>
            <div className="relative">
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                $
              </span>
              <Input
                type="number"
                min="1"
                step="1"
                value={topUpUsd}
                onChange={handleTopUpUsdChange}
                className="pl-7 font-mono"
              />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground mb-1.5 text-[11px] font-medium">Credits to grant</p>
            <p className="font-mono text-lg leading-9 font-semibold">
              {formatCredits(topUpPreviewCredits)}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleTopUp}
            disabled={manualTopUp.isPending || !activeWorkspace}
            className="shrink-0"
          >
            {manualTopUp.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Grant
          </Button>
        </div>

        {showConsumedTopUpHint ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Granted top-up credits are already being applied against this workspace&apos;s usage, so
            the available top-up balance is currently 0.
          </p>
        ) : null}
      </div>

      {/* Recent Top-Ups */}
      <div className="rounded-lg border px-3 py-3">
        <h4 className="mb-2 text-sm font-semibold">Recent Top-Ups</h4>

        {overview.data.recentTopUps.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-sm">No top-ups recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
                  <th className="px-3 py-2 text-left">Credits</th>
                  <th className="px-3 py-2 text-left">USD</th>
                  <th className="px-3 py-2 text-left">Granted</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.recentTopUps.map((topUp) => (
                  <tr key={topUp.id} className="even:bg-muted/20 border-t">
                    <td className="px-3 py-2 font-mono font-semibold">
                      {formatCredits(topUp.creditsGranted)}
                    </td>
                    <td className="px-3 py-2 font-mono">${topUp.usdAmount}</td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                      {formatDateShort(topUp.createdAt)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                      {formatDateShort(topUp.expiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminCreditsPage() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminListUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async (searchValue: string) => {
    setLoadingUsers(true);

    try {
      const trimmed = searchValue.trim();
      const result = await authClient.admin.listUsers({
        query: {
          searchValue: trimmed.length > 0 ? trimmed : undefined,
          searchField: "email",
          searchOperator: "contains",
          sortBy: "createdAt",
          sortDirection: "desc",
          limit: 20,
        },
      });

      if (result.error) {
        toast.error(result.error.message ?? "Failed to load users.");
        setUsers([]);
        setExpandedUserId(null);
        return;
      }

      const loaded = (result.data?.users ?? []) as AdminListUser[];
      setUsers(loaded);
      setExpandedUserId((current) => {
        if (!current) {
          return null;
        }
        return loaded.some((candidate) => candidate.id === current) ? current : null;
      });
    } catch (error) {
      console.error("Failed to load admin users:", error);
      toast.error("Failed to load users.");
      setUsers([]);
      setExpandedUserId(null);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers("");
  }, [loadUsers]);

  const handleSearchSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await loadUsers(search);
    },
    [loadUsers, search],
  );

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  }, []);

  const handleToggleUser = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const userId = event.currentTarget.value;
    setExpandedUserId((current) => (current === userId ? null : userId));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Credits</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Search users to view billing details and grant credits.
        </p>
      </div>

      <form onSubmit={handleSearchSubmit}>
        <div className="relative max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by email…"
            className="pl-9"
          />
        </div>
      </form>

      {loadingUsers ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="border-border/60 bg-muted/20 rounded-lg border p-8 text-center">
          <Wallet className="text-muted-foreground mx-auto h-6 w-6" />
          <p className="mt-3 text-sm font-medium">No users found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => {
            const isExpanded = user.id === expandedUserId;
            return (
              <div key={user.id} className="rounded-lg border px-4 py-3">
                <button
                  type="button"
                  value={user.id}
                  onClick={handleToggleUser}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    {getInitials(user.name, user.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{user.name || "Unnamed user"}</p>
                      {user.role && (
                        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
                          {user.role}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate font-mono text-xs">{user.email}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </button>

                {isExpanded && <UserCardExpanded userId={user.id} userEmail={user.email} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
