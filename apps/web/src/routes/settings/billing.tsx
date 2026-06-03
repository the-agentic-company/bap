import type { ChangeEvent, MouseEvent } from "react";
import {
  BILLING_PLANS,
  TOP_UP_CREDITS_PER_USD,
  formatCredits,
} from "@cmdclaw/core/lib/billing-plans";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, ExternalLink, Loader2, Sparkles, Zap } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientEditionCapabilities } from "@/lib/edition";
import { fetchSessionContext } from "@/lib/route-guards";
import {
  useAttachBillingPlan,
  useBillingOverview,
  useCancelBillingPlan,
  useManualBillingTopUp,
  useOpenBillingPortal,
} from "@/orpc/hooks";

const TOP_UP_PRESETS = [10, 25, 50, 100];
const EMPTY_WORKSPACE_OPTIONS: Array<{ id: string; name: string }> = [];

/**
 * Billing-admin gate. The `/settings` layout already requires a session; this guard moves
 * the old client-side `router.replace("/settings")` redirect to the route boundary so
 * non-admins (or self-host, where billing is disabled) never render the page. Cloud is the
 * only edition with billing, so the check is effectively cloud + admin.
 */
export const Route = createFileRoute("/settings/billing")({
  beforeLoad: async () => {
    const context = await fetchSessionContext();
    if (context.edition !== "cloud" || !context.isAdmin) {
      throw redirect({ to: "/settings" });
    }
  },
  head: () => ({ meta: [{ title: "Billing - CmdClaw" }] }),
  component: BillingPage,
});

function BillingPage() {
  const {
    data: overview,
    isLoading,
    refetch,
  } = useBillingOverview(clientEditionCapabilities.hasBilling);
  const attachPlan = useAttachBillingPlan();
  const openPortal = useOpenBillingPortal();
  const cancelPlan = useCancelBillingPlan();
  const manualTopUp = useManualBillingTopUp();

  const [topUpUsd, setTopUpUsd] = useState("25");

  const activeWorkspaceId = overview?.owner.ownerId;
  const currentPlan = overview?.plan ?? BILLING_PLANS.free;
  const workspaceOptions = overview?.workspaces ?? EMPTY_WORKSPACE_OPTIONS;
  const availableTargetPlans = useMemo(() => {
    return Object.values(BILLING_PLANS);
  }, []);

  const feature = overview?.feature as
    | {
        balance?: number | null;
        included_usage?: number;
        next_reset_at?: number | null;
        rollovers?: { balance: number; expires_at: number };
        breakdown?: Array<{
          interval: string;
          balance?: number;
        }>;
      }
    | null
    | undefined;

  const handleAttachPlan = useCallback(
    async (planId: "free" | "pro" | "business" | "enterprise") => {
      try {
        const result = await attachPlan.mutateAsync({
          ownerType: "workspace",
          workspaceId: activeWorkspaceId ?? undefined,
          planId,
          successUrl:
            typeof window !== "undefined"
              ? `${window.location.origin}/settings/billing`
              : undefined,
        });
        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }
        toast.success(`Plan updated to ${BILLING_PLANS[planId].name}.`);
        await refetch();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update plan.");
      }
    },
    [activeWorkspaceId, attachPlan, refetch],
  );

  const handleOpenPortal = useCallback(async () => {
    try {
      const result = await openPortal.mutateAsync({
        ownerType: "workspace",
        workspaceId: activeWorkspaceId ?? undefined,
        returnUrl:
          typeof window !== "undefined" ? `${window.location.origin}/settings/billing` : undefined,
      });
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open billing portal.");
    }
  }, [activeWorkspaceId, openPortal]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelPlan.mutateAsync({
        ownerType: "workspace",
        workspaceId: activeWorkspaceId ?? undefined,
        productId:
          currentPlan.id === "business" || currentPlan.id === "enterprise" ? currentPlan.id : "pro",
      });
      toast.success("Cancellation requested.");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel plan.");
    }
  }, [activeWorkspaceId, cancelPlan, currentPlan.id, refetch]);

  const handleManualTopUp = useCallback(async () => {
    const usdAmount = Number(topUpUsd);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      toast.error("Enter a positive USD amount.");
      return;
    }

    try {
      await manualTopUp.mutateAsync({
        ownerType: "workspace",
        workspaceId: activeWorkspaceId ?? undefined,
        usdAmount,
      });
      toast.success(
        `Added ${formatCredits(Math.floor(usdAmount * TOP_UP_CREDITS_PER_USD))} credits.`,
      );
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add credits.");
    }
  }, [activeWorkspaceId, manualTopUp, refetch, topUpUsd]);

  const handleTopUpUsdChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTopUpUsd(event.target.value);
  }, []);

  const handlePlanButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const planId = event.currentTarget.dataset.planId as
        | "free"
        | "pro"
        | "business"
        | "enterprise"
        | undefined;
      if (!planId) {
        return;
      }
      void handleAttachPlan(planId);
    },
    [handleAttachPlan],
  );

  const handleTopUpPresetClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setTopUpUsd(event.currentTarget.dataset.amount ?? "25");
  }, []);

  const topUpCredits = Math.max(0, Math.floor(Number(topUpUsd || 0) * TOP_UP_CREDITS_PER_USD));
  const topUpBalance = Math.max(
    0,
    Number(feature?.breakdown?.find((item) => item.interval === "one_off")?.balance ?? 0),
  );
  const hasRecentTopUps = (overview?.recentTopUps?.length ?? 0) > 0;
  const showConsumedTopUpHint = topUpBalance === 0 && hasRecentTopUps;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Billing</h2>
          <p className="text-muted-foreground mt-1 text-sm">Manage your plan and credits.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenPortal}
          disabled={openPortal.isPending}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Billing portal
        </Button>
      </div>

      {/* Plan cards */}
      <section>
        {activeWorkspaceId ? (
          <div className="text-muted-foreground mb-4 rounded-lg border px-3 py-2 text-[13px]">
            Managing workspace billing for{" "}
            <span className="text-foreground font-medium">
              {workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId)?.name ??
                "workspace"}
            </span>
          </div>
        ) : null}

        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium">Choose a plan</h3>
          {currentPlan.id !== "free" && currentPlan.id !== "enterprise" && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelPlan.isPending}
              className="text-muted-foreground hover:text-destructive text-xs underline-offset-4 transition-colors hover:underline disabled:opacity-50"
            >
              Cancel plan
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {availableTargetPlans.map((plan, index) => {
            const isCurrent = plan.id === currentPlan.id;
            const buttonLabel = isCurrent ? "Current plan" : plan.ctaLabel;
            return (
              <Fragment key={plan.id}>
                {index === 2 && (
                  <div className="text-muted-foreground col-span-full mt-3 mb-1 flex items-center gap-2 text-xs">
                    <div className="bg-border h-px flex-1" />
                    <span>Higher shared-credit plans</span>
                    <div className="bg-border h-px flex-1" />
                  </div>
                )}
                <div
                  className={`relative rounded-xl border p-5 transition-all ${
                    isCurrent
                      ? "border-foreground/20 bg-accent/50 ring-foreground/5 ring-1"
                      : "hover:border-foreground/15 border-border"
                  }`}
                >
                  {isCurrent && (
                    <div className="bg-foreground text-background absolute -top-2.5 right-4 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
                      <Check className="h-3 w-3" />
                      Current
                    </div>
                  )}

                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{plan.name}</h4>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span className="text-2xl font-semibold tracking-tight">
                          {plan.monthlyPriceLabel}
                        </span>
                        {plan.monthlyPriceUsd !== null && plan.monthlyPriceUsd > 0 && (
                          <span className="text-muted-foreground text-xs">/mo</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-muted-foreground mt-3 text-[13px] leading-relaxed">
                    {plan.description}
                  </p>

                  <div className="mt-4 space-y-2 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Sparkles className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <span>
                        {plan.includedCredits > 0
                          ? `${formatCredits(plan.includedCredits)} shared credits/mo`
                          : "No included credits"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <span>
                        {plan.rolloverMonths === 0
                          ? "No rollover"
                          : `${plan.rolloverMonths}-month rollover`}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5">
                    {plan.contactSales ? (
                      <Button asChild variant="outline" className="w-full" size="sm">
                        <a href="mailto:hello@cmdclaw.ai?subject=CmdClaw%20Enterprise">
                          Contact sales
                        </a>
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        size="sm"
                        variant={isCurrent ? "outline" : "default"}
                        disabled={attachPlan.isPending || isCurrent}
                        data-plan-id={plan.id}
                        onClick={handlePlanButtonClick}
                      >
                        {buttonLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </section>

      {/* Credits balance + Top-up */}
      <section className="rounded-xl border p-5">
        <h3 className="text-sm font-medium">Credits</h3>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Your workspace credit pool is used for all AI interactions. Plan credits refresh monthly,
          top-ups expire after 12 months.
        </p>
        {showConsumedTopUpHint ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Granted top-up credits are already being applied against your workspace usage, so the
            available top-up balance is currently 0.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
            <div className="text-muted-foreground text-xs">Top-up balance</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
              {formatCredits(topUpBalance)}
            </div>
          </div>
          <div className="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
            <div className="text-muted-foreground text-xs">Included monthly</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
              {formatCredits(currentPlan.includedCredits)}
            </div>
          </div>
          <div className="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
            <div className="text-muted-foreground text-xs">Next reset</div>
            <div className="mt-1.5 text-lg font-semibold">
              {feature?.next_reset_at
                ? new Date(feature.next_reset_at * 1000).toLocaleDateString()
                : "Not scheduled"}
            </div>
          </div>
        </div>

        <div className="bg-accent/40 mt-4 rounded-lg p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">Top up</div>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                $1 = {TOP_UP_CREDITS_PER_USD} credits, added instantly.
              </p>
            </div>

            <div className="flex w-full max-w-sm flex-col gap-2.5">
              <div className="flex gap-1.5">
                {TOP_UP_PRESETS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    data-amount={String(amount)}
                    onClick={handleTopUpPresetClick}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                      topUpUsd === String(amount)
                        ? "border-foreground/20 bg-background text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/60 border-transparent"
                    }`}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                    $
                  </span>
                  <Input
                    value={topUpUsd}
                    onChange={handleTopUpUsdChange}
                    className="pl-7 tabular-nums"
                    type="number"
                    min="1"
                    step="1"
                  />
                </div>
                <Button
                  onClick={handleManualTopUp}
                  disabled={manualTopUp.isPending}
                  className="shrink-0"
                >
                  Add {formatCredits(topUpCredits)} credits
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
