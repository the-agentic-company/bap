import { and, desc, eq, sql } from "drizzle-orm";
import {
  BILLING_CREDIT_FEATURE_ID,
  BILLING_PLANS,
} from "../../lib/billing-plans";
import { db } from "@bap/db/client";
import { billingLedger, billingTopUp } from "@bap/db/schema";
import { getAutumnClient } from "./autumn";
import { type BillingOwner, ensureBillingCustomer } from "./billing-owner";

export type BillingFeatureSnapshot = {
  balance?: number | null;
  included_usage?: number;
  usage?: number;
  next_reset_at?: number | null;
  rollovers?: { balance: number; expires_at: number };
  breakdown?: Array<{
    interval: string;
    balance?: number;
    usage?: number;
    included_usage?: number;
    next_reset_at?: number;
  }>;
};

function hasNumericBalance(
  feature: BillingFeatureSnapshot | null,
): feature is BillingFeatureSnapshot & {
  balance: number;
} {
  return typeof feature?.balance === "number" && Number.isFinite(feature.balance);
}

function hasNumericOneOffBalance(feature: BillingFeatureSnapshot | null): boolean {
  return (
    feature?.breakdown?.some(
      (item) => item.interval === "one_off" && typeof item.balance === "number",
    ) ?? false
  );
}

async function getStoredTopUpBalanceForOwner(owner: BillingOwner): Promise<number> {
  const now = new Date();
  const activeTopUps = await db.query.billingTopUp.findMany({
    where: and(
      owner.ownerType === "workspace"
        ? eq(billingTopUp.workspaceId, owner.ownerId)
        : eq(billingTopUp.userId, owner.ownerId),
      sql`${billingTopUp.expiresAt} > ${now}`,
    ),
    columns: {
      creditsGranted: true,
    },
  });

  const totalGranted = activeTopUps.reduce((sum, topUp) => sum + topUp.creditsGranted, 0);
  if (totalGranted <= 0) {
    return 0;
  }

  if (BILLING_PLANS[owner.planId].includedCredits > 0) {
    return totalGranted;
  }

  const [usageSummary] = await db
    .select({
      creditsCharged: sql<number>`coalesce(sum(${billingLedger.creditsCharged}), 0)`,
    })
    .from(billingLedger)
    .where(
      owner.ownerType === "workspace"
        ? eq(billingLedger.workspaceId, owner.ownerId)
        : eq(billingLedger.userId, owner.ownerId),
    );

  return Math.max(0, totalGranted - Number(usageSummary?.creditsCharged ?? 0));
}

function mergeStoredTopUpBalance(
  feature: BillingFeatureSnapshot | null,
  storedTopUpBalance: number,
): BillingFeatureSnapshot | null {
  if (storedTopUpBalance <= 0) {
    return feature;
  }

  const mergedBreakdown = [
    ...(feature?.breakdown?.filter((item) => item.interval !== "one_off") ?? []),
    { interval: "one_off", balance: storedTopUpBalance },
  ];

  return {
    ...(feature ?? {}),
    balance: hasNumericBalance(feature)
      ? Math.max(0, feature.balance, storedTopUpBalance)
      : storedTopUpBalance,
    breakdown: mergedBreakdown,
  };
}

export async function getBillingSnapshotForOwner(owner: BillingOwner) {
  const recentTopUps = await db.query.billingTopUp.findMany({
    where:
      owner.ownerType === "workspace"
        ? eq(billingTopUp.workspaceId, owner.ownerId)
        : eq(billingTopUp.userId, owner.ownerId),
    orderBy: [desc(billingTopUp.createdAt)],
    limit: 20,
  });

  let llmCreditsFeature: BillingFeatureSnapshot | null = null;
  const autumnClient = getAutumnClient();
  if (autumnClient) {
    try {
      await ensureBillingCustomer(owner);
      const result = await autumnClient.check({
        customer_id: owner.autumnCustomerId,
        feature_id: BILLING_CREDIT_FEATURE_ID,
        required_balance: 0,
      });
      llmCreditsFeature = (result.data as BillingFeatureSnapshot | undefined) ?? null;
    } catch (error) {
      console.error("[Billing] Failed to fetch Autumn credit balance", error);
    }
  }

  if (!hasNumericBalance(llmCreditsFeature) || !hasNumericOneOffBalance(llmCreditsFeature)) {
    const storedTopUpBalance = await getStoredTopUpBalanceForOwner(owner);
    llmCreditsFeature = mergeStoredTopUpBalance(llmCreditsFeature, storedTopUpBalance);
  }

  return {
    plan: BILLING_PLANS[owner.planId],
    feature: llmCreditsFeature,
    recentTopUps,
  };
}
