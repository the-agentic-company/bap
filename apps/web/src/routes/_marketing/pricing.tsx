import {
  BILLING_PLANS,
  TOP_UP_CREDITS_PER_USD,
  TOP_UP_EXPIRY_MONTHS,
  formatCredits,
  type BillingPlanDefinition,
} from "@cmdclaw/core/lib/billing-plans";
import { isSelfHostedEdition } from "@cmdclaw/core/server/edition";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Server function for the self-host edition gate. The old Next page called
 * `isSelfHostedEdition()` (server-only) during render and `redirect("/")`; in TanStack
 * Start that decision moves into `beforeLoad`, so the redirect happens before any render.
 */
const checkSelfHostEdition = createServerFn({ method: "GET" }).handler(() => ({
  selfHost: isSelfHostedEdition(),
}));

export const Route = createFileRoute("/_marketing/pricing")({
  beforeLoad: async () => {
    const { selfHost } = await checkSelfHostEdition();
    if (selfHost) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Pricing · CmdClaw" },
      {
        name: "description",
        content:
          "Start with a shared workspace. Upgrade for a larger shared credit pool as your team grows.",
      },
    ],
  }),
  component: PricingPage,
});

const PLAN_META: Record<
  string,
  {
    features: string[];
    highlighted?: boolean;
    featurePrefix?: string;
  }
> = {
  free: {
    features: [
      "Manual credit top-ups",
      "All AI models",
      "Unlimited users",
      "Shared workspace access",
      "Community support",
    ],
    featurePrefix: "Workspace includes",
  },
  pro: {
    highlighted: true,
    features: [
      `${formatCredits(2500)} monthly shared credits`,
      "1-month credit rollover",
      "On-demand top-ups",
      "Priority support",
      "Shared across unlimited users",
    ],
    featurePrefix: "All features in Free, plus:",
  },
  business: {
    features: [
      `${formatCredits(5000)} monthly shared credits`,
      "3-month credit rollover",
      "Workspace billing & admin",
      "On-demand top-ups",
      "Priority support",
      "Shared across unlimited users",
    ],
    featurePrefix: "All features in Pro, plus:",
  },
  enterprise: {
    features: [
      "Custom credit allocation",
      "12-month credit rollover",
      "Dedicated account manager",
      "SSO & advanced security",
      "Custom integrations",
      "SLA & onboarding",
    ],
    featurePrefix: "All features in Business, plus:",
  },
};

function PlanCard({ plan }: { plan: BillingPlanDefinition }) {
  const meta = PLAN_META[plan.id];
  const highlighted = meta?.highlighted;

  return (
    <section
      className={[
        "relative flex h-full flex-col rounded-2xl border p-6",
        highlighted
          ? "border-neutral-900 bg-neutral-950 text-white"
          : "border-neutral-200 bg-white text-neutral-950",
      ].join(" ")}
    >
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p
        className={["mt-1 text-sm", highlighted ? "text-neutral-400" : "text-neutral-500"].join(
          " ",
        )}
      >
        {plan.description}
      </p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{plan.monthlyPriceLabel}</span>
        {plan.monthlyPriceUsd !== null && plan.monthlyPriceUsd > 0 && (
          <span
            className={["text-sm", highlighted ? "text-neutral-500" : "text-neutral-400"].join(" ")}
          >
            / month
          </span>
        )}
      </div>

      <div
        className={["mt-1 text-xs", highlighted ? "text-neutral-500" : "text-neutral-400"].join(
          " ",
        )}
      >
        {plan.contactSales
          ? "custom pricing"
          : plan.monthlyPriceUsd === 0
            ? "no credit card required"
            : "shared across unlimited users"}
      </div>

      <div className="mt-6">
        {plan.contactSales ? (
          <Button
            asChild
            variant="outline"
            className="w-full border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
          >
            <a href="mailto:hello@cmdclaw.ai?subject=CmdClaw%20Enterprise">Contact sales</a>
          </Button>
        ) : (
          <Button
            asChild
            className={[
              "w-full",
              highlighted
                ? "bg-white text-neutral-950 hover:bg-neutral-100"
                : "bg-neutral-900 text-white hover:bg-neutral-800",
            ].join(" ")}
          >
            <Link to="/login">{plan.ctaLabel}</Link>
          </Button>
        )}
      </div>

      <div
        className={[
          "mt-6 border-t pt-5",
          highlighted ? "border-neutral-800" : "border-neutral-100",
        ].join(" ")}
      >
        <p
          className={["mb-3 text-xs", highlighted ? "text-neutral-500" : "text-neutral-400"].join(
            " ",
          )}
        >
          {meta?.featurePrefix}
        </p>
        <ul className="space-y-2.5">
          {meta?.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <Check
                className={[
                  "mt-0.5 size-3.5 shrink-0",
                  highlighted ? "text-neutral-500" : "text-neutral-400",
                ].join(" ")}
              />
              <span className={highlighted ? "text-neutral-300" : "text-neutral-600"}>
                {feature}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PricingPage() {
  const plans = Object.values(BILLING_PLANS);
  const allPlans = [
    plans.find((p) => p.id === "free")!,
    plans.find((p) => p.id === "pro")!,
    plans.find((p) => p.id === "business")!,
    plans.find((p) => p.id === "enterprise")!,
  ];

  return (
    <main className="min-h-screen bg-white text-neutral-950">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-20 sm:pt-24">
        {/* Header */}
        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pricing</h1>
          <p className="mt-3 text-base text-neutral-500">
            Start with a shared workspace. Upgrade for a larger shared credit pool as your team
            grows.
          </p>
        </div>

        {/* Plan cards */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {allPlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>

        {/* Credits info */}
        <div className="mx-auto mt-16 max-w-xl text-center text-sm text-neutral-400">
          <p>
            Credits are computed from model token usage plus sandbox runtime. Top-ups convert at
            $1&nbsp;=&nbsp;{TOP_UP_CREDITS_PER_USD} credits and expire after {TOP_UP_EXPIRY_MONTHS}{" "}
            months.
          </p>
        </div>
      </div>
    </main>
  );
}
