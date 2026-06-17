import {
  BILLING_PLANS,
  TOP_UP_CREDITS_PER_USD,
  TOP_UP_EXPIRY_MONTHS,
  type BillingPlanDefinition,
} from "@bap/core/lib/billing-plans";
import { isSelfHostedEdition } from "@bap/core/server/edition";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { T, msg, useGT, useMessages } from "gt-react";
import { Check } from "lucide-react";
import { localizedText } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";

/**
 * Server function for the self-host edition gate. The previous page called
 * `isSelfHostedEdition()` (server-only) during render and `redirect("/")`; in TanStack
 * Start that decision moves into `beforeLoad`, so the redirect happens before any render.
 */
const checkSelfHostEdition = createServerFn({ method: "GET" }).handler(() => ({
  selfHost: isSelfHostedEdition(),
}));

export const Route = createFileRoute("/_public/pricing")({
  beforeLoad: async () => {
    const { selfHost } = await checkSelfHostEdition();
    if (selfHost) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: localizedText("Pricing · Bap", { fr: "Tarifs · Bap" }) },
      {
        name: "description",
        content: localizedText(
          "Start with a shared workspace. Upgrade for a larger shared credit pool as your team grows.",
          {
            fr: "Commencez avec un espace de travail partagé. Passez à une réserve de crédits partagée plus importante à mesure que votre équipe grandit.",
          },
        ),
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
      msg("Manual credit top-ups"),
      msg("All AI models"),
      msg("Unlimited users"),
      msg("Shared workspace access"),
      msg("Community support"),
    ],
    featurePrefix: msg("Workspace includes"),
  },
  pro: {
    highlighted: true,
    features: [
      msg("2,500 monthly shared credits"),
      msg("1-month credit rollover"),
      msg("On-demand top-ups"),
      msg("Priority support"),
      msg("Shared across unlimited users"),
    ],
    featurePrefix: msg("All features in Free, plus:"),
  },
  business: {
    features: [
      msg("5,000 monthly shared credits"),
      msg("3-month credit rollover"),
      msg("Workspace billing & admin"),
      msg("On-demand top-ups"),
      msg("Priority support"),
      msg("Shared across unlimited users"),
    ],
    featurePrefix: msg("All features in Pro, plus:"),
  },
  enterprise: {
    features: [
      msg("Custom credit allocation"),
      msg("12-month credit rollover"),
      msg("Dedicated account manager"),
      msg("SSO & advanced security"),
      msg("Custom integrations"),
      msg("SLA & onboarding"),
    ],
    featurePrefix: msg("All features in Business, plus:"),
  },
};

const PLAN_COPY = {
  free: {
    source: {
      name: "Free",
      description: "Shared workspace for trying Bap with manual top-ups.",
      ctaLabel: "Start free",
      monthlyPriceLabel: "$0",
    },
    messages: {
      name: msg("Free"),
      description: msg("Shared workspace for trying Bap with manual top-ups."),
      ctaLabel: msg("Start free"),
      monthlyPriceLabel: msg("$0"),
    },
  },
  pro: {
    source: {
      name: "Pro",
      description: "Shared workspace plan with a monthly included credit budget.",
      ctaLabel: "Start Pro",
      monthlyPriceLabel: "$25",
    },
    messages: {
      name: msg("Pro"),
      description: msg("Shared workspace plan with a monthly included credit budget."),
      ctaLabel: msg("Start Pro"),
      monthlyPriceLabel: msg("$25"),
    },
  },
  business: {
    source: {
      name: "Business",
      description: "Flat org plan with shared credits across the workspace.",
      ctaLabel: "Start Business",
      monthlyPriceLabel: "$50",
    },
    messages: {
      name: msg("Business"),
      description: msg("Flat org plan with shared credits across the workspace."),
      ctaLabel: msg("Start Business"),
      monthlyPriceLabel: msg("$50"),
    },
  },
  enterprise: {
    source: {
      name: "Enterprise",
      description: "Contact-led org plan with long rollover and manual provisioning.",
      ctaLabel: "Contact sales",
      monthlyPriceLabel: "Contact us",
    },
    messages: {
      name: msg("Enterprise"),
      description: msg("Contact-led org plan with long rollover and manual provisioning."),
      ctaLabel: msg("Contact sales"),
      monthlyPriceLabel: msg("Contact us"),
    },
  },
} satisfies Record<
  BillingPlanDefinition["id"],
  {
    source: Pick<BillingPlanDefinition, "name" | "description" | "ctaLabel" | "monthlyPriceLabel">;
    messages: { name: string; description: string; ctaLabel: string; monthlyPriceLabel: string };
  }
>;

for (const [planId, copy] of Object.entries(PLAN_COPY)) {
  const plan = BILLING_PLANS[planId as BillingPlanDefinition["id"]];
  for (const field of ["name", "description", "ctaLabel", "monthlyPriceLabel"] as const) {
    if (copy.source[field] !== plan[field]) {
      throw new Error(`Pricing copy for ${planId}.${field} must match BILLING_PLANS.`);
    }
  }
}

function PlanCard({ plan }: { plan: BillingPlanDefinition }) {
  const t = useGT();
  const m = useMessages();
  const meta = PLAN_META[plan.id];
  const copy = PLAN_COPY[plan.id];
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
      <h3 className="text-lg font-semibold">{m(copy.messages.name)}</h3>
      <p
        className={["mt-1 text-sm", highlighted ? "text-neutral-400" : "text-neutral-500"].join(
          " ",
        )}
      >
        {m(copy.messages.description)}
      </p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">
          {m(copy.messages.monthlyPriceLabel)}
        </span>
        {plan.monthlyPriceUsd !== null && plan.monthlyPriceUsd > 0 && (
          <span
            className={["text-sm", highlighted ? "text-neutral-500" : "text-neutral-400"].join(" ")}
          >
            <T>/ month</T>
          </span>
        )}
      </div>

      <div
        className={["mt-1 text-xs", highlighted ? "text-neutral-500" : "text-neutral-400"].join(
          " ",
        )}
      >
        {plan.contactSales
          ? t("custom pricing")
          : plan.monthlyPriceUsd === 0
            ? t("no credit card required")
            : t("shared across unlimited users")}
      </div>

      <div className="mt-6">
        {plan.contactSales ? (
          <Button
            asChild
            variant="outline"
            className="w-full border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
          >
            <a href="mailto:hello@heybap.com?subject=Bap%20Enterprise">
              <T>Contact sales</T>
            </a>
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
            <Link to="/login">{m(copy.messages.ctaLabel)}</Link>
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
          {meta?.featurePrefix ? m(meta.featurePrefix) : null}
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
                {m(feature)}
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
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <T>Pricing</T>
          </h1>
          <p className="mt-3 text-base text-neutral-500">
            <T>
              Start with a shared workspace. Upgrade for a larger shared credit pool as your team
              grows.
            </T>
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
            <T>
              Credits are computed from model token usage plus sandbox runtime. Top-ups convert at
              $1&nbsp;=&nbsp;
            </T>
            {TOP_UP_CREDITS_PER_USD} <T>credits and expire after</T> {TOP_UP_EXPIRY_MONTHS}{" "}
            <T>months.</T>
          </p>
        </div>
      </div>
    </main>
  );
}
