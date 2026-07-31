import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Clock3, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useBillingOverview } from "@/orpc/hooks/billing";
import {
  useSetWorkspaceSessionIdleTimeout,
  useSetWorkspaceTwoFactorRequirement,
  useWorkspaceMembers,
} from "@/orpc/hooks/workspace";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Workspace Security - Bap" }] }),
  component: AdminWorkspaceSettingsPage,
});

type WorkspaceMember = {
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
  userId: string;
};

const EMPTY_MEMBERS: WorkspaceMember[] = [];

function SettingsSkeleton() {
  return (
    <div className="space-y-8" aria-label="Loading Workspace security settings">
      <div className="space-y-2">
        <div className="bg-muted h-6 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-80 max-w-full animate-pulse rounded" />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <div className="space-y-3 p-5">
          <div className="bg-muted h-5 w-40 animate-pulse rounded" />
          <div className="bg-muted h-4 w-full max-w-xl animate-pulse rounded" />
        </div>
        <div className="border-t p-5">
          <div className="bg-muted h-9 w-full animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}

export function AdminWorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { data: billingOverview, isLoading: overviewLoading } = useBillingOverview();
  const activeWorkspaceId = billingOverview?.owner.ownerId;
  const activeWorkspace = billingOverview?.workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(activeWorkspaceId);
  const setTwoFactorRequirement = useSetWorkspaceTwoFactorRequirement();
  const setSessionIdleTimeout = useSetWorkspaceSessionIdleTimeout();
  const [confirmDisable, setConfirmDisable] = useState(false);

  const members = membersData?.members ?? EMPTY_MEMBERS;
  const requiresTwoFactor = activeWorkspace?.requiresTwoFactor === true;
  const sessionIdleTimeoutMinutes = activeWorkspace?.sessionIdleTimeoutMinutes ?? null;
  const canManagePolicy =
    membersData?.membershipRole === "owner" || membersData?.membershipRole === "admin";
  const enrolledCount = useMemo(
    () => members.filter((member) => member.twoFactorEnabled).length,
    [members],
  );

  const updatePolicy = useCallback(
    async (required: boolean) => {
      if (!activeWorkspaceId) {
        return;
      }

      try {
        await setTwoFactorRequirement.mutateAsync({
          workspaceId: activeWorkspaceId,
          required,
        });
        setConfirmDisable(false);
        toast.success(
          required
            ? "Authenticator app MFA is now required."
            : "Authenticator app MFA is now optional.",
        );

        if (required) {
          void navigate({
            href: "/two-factor/setup?callbackUrl=%2Fadmin%2Fsettings",
          });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the MFA policy.");
      }
    },
    [activeWorkspaceId, navigate, setTwoFactorRequirement],
  );

  const handlePolicyChange = useCallback(
    (required: boolean) => {
      if (required) {
        void updatePolicy(true);
        return;
      }
      setConfirmDisable(true);
    },
    [updatePolicy],
  );

  const handleConfirmDisable = useCallback(() => {
    void updatePolicy(false);
  }, [updatePolicy]);

  const handleCancelDisable = useCallback(() => {
    setConfirmDisable(false);
  }, []);

  const handleSessionIdleTimeoutChange = useCallback(
    async (value: string) => {
      if (!activeWorkspaceId) {
        return;
      }

      const timeoutMinutes =
        value === "disabled" ? null : (Number(value) as 15 | 30 | 60 | 240 | 480 | 1440);
      try {
        await setSessionIdleTimeout.mutateAsync({ workspaceId: activeWorkspaceId, timeoutMinutes });
        toast.success(
          timeoutMinutes === null
            ? "Idle session timeout disabled."
            : "Idle session timeout updated.",
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update the session policy.",
        );
      }
    },
    [activeWorkspaceId, setSessionIdleTimeout],
  );

  const handleSessionIdleTimeoutSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      void handleSessionIdleTimeoutChange(event.target.value);
    },
    [handleSessionIdleTimeoutChange],
  );

  if (overviewLoading || membersLoading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
          {activeWorkspace?.name ?? "Active Workspace"}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">Workspace security</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Set the authentication standard for everyone with access to this Workspace.
        </p>
      </header>

      <section className="overflow-hidden rounded-xl border">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-2xl gap-3">
            <span className="bg-brand-light text-brand-dark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Require authenticator app MFA</h3>
                <span
                  className={
                    requiresTwoFactor
                      ? "border-brand/20 bg-brand-light text-brand-dark inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      : "border-border bg-muted text-muted-foreground inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  }
                >
                  {requiresTwoFactor ? "Enforced" : "Optional"}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">
                Members who have not enrolled must set up a time-based code before they can use this
                Workspace. Password sign-ins require the code after enrollment.
              </p>
            </div>
          </div>
          <Switch
            aria-label="Require authenticator app MFA for this Workspace"
            checked={requiresTwoFactor}
            disabled={!canManagePolicy || setTwoFactorRequirement.isPending}
            onCheckedChange={handlePolicyChange}
          />
        </div>

        {confirmDisable ? (
          <div className="bg-amber-500/10 flex flex-col gap-4 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium">Make MFA optional?</p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  Enrolled members keep MFA, but other members will no longer be required to set it
                  up.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" onClick={handleCancelDisable}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={setTwoFactorRequirement.isPending}
                onClick={handleConfirmDisable}
              >
                Make optional
              </Button>
            </div>
          </div>
        ) : null}

        {!canManagePolicy ? (
          <div className="text-muted-foreground border-t px-5 py-3 text-sm">
            Workspace admin access is required to change this policy.
          </div>
        ) : null}
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-2xl gap-3">
            <span className="bg-brand-light text-brand-dark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Clock3 className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Idle session timeout</h3>
              <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">
                Sign members out after they stop interacting with Bap. Background updates do not
                keep a session active.
              </p>
            </div>
          </div>
          <label className="shrink-0">
            <span className="sr-only">Idle session timeout</span>
            <select
              className="border-input bg-background h-9 min-w-40 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              value={sessionIdleTimeoutMinutes?.toString() ?? "disabled"}
              disabled={!canManagePolicy || setSessionIdleTimeout.isPending}
              onChange={handleSessionIdleTimeoutSelectChange}
            >
              <option value="disabled">Disabled</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </label>
        </div>
        {!canManagePolicy ? (
          <div className="text-muted-foreground border-t px-5 py-3 text-sm">
            Workspace admin access is required to change this policy.
          </div>
        ) : null}
      </section>

      <section className="mt-10">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Member readiness</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {enrolledCount} of {members.length} members enrolled
            </p>
          </div>
          {requiresTwoFactor && enrolledCount < members.length ? (
            <p className="text-amber-700 text-xs font-medium">
              {members.length - enrolledCount} blocked until setup
            </p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border">
          {members.length > 0 ? (
            members.map((member, index) => (
              <div
                key={member.userId}
                className={`flex items-center justify-between gap-4 px-4 py-3 ${
                  index > 0 ? "border-t" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.name || member.email}</p>
                  <p className="text-muted-foreground truncate text-xs">{member.email}</p>
                </div>
                <span
                  className={
                    member.twoFactorEnabled
                      ? "text-emerald-700 inline-flex shrink-0 items-center gap-1.5 text-xs font-medium"
                      : "text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs font-medium"
                  }
                >
                  {member.twoFactorEnabled ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {member.twoFactorEnabled ? "Enrolled" : "Not enrolled"}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">
              No members found in this Workspace.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
