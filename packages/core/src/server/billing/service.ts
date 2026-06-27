import { addMonths } from "date-fns";
import { desc, eq } from "drizzle-orm";
import {
  BILLING_CREDIT_FEATURE_ID,
  TOP_UP_CREDITS_PER_USD,
  TOP_UP_EXPIRY_MONTHS,
  type BillingPlanId,
} from "../../lib/billing-plans";
import { db } from "@bap/db/client";
import { billingLedger, billingTopUp, workspace } from "@bap/db/schema";
import { getAutumnClient } from "./autumn";
import { calculateCredits } from "./credit-calculator";
import {
  type BillingOwner,
  ensureBillingCustomer,
  getExistingBillingOwnerForUser,
  resolveBillingOwnerForConversation,
  resolveBillingOwnerForUser,
} from "./billing-owner";
import { getBillingSnapshotForOwner } from "./credit-snapshot";
import { listWorkspacesForUser } from "./workspace-lifecycle";

// Re-export the moved interfaces so `@bap/core/server/billing/service` keeps
// exposing the same symbols to every existing caller. The implementations now
// live in focused modules: `workspace-lifecycle` (workspace + membership),
// `billing-owner` (the BillingOwner value object + resolution), and
// `credit-snapshot` (Autumn-vs-stored balance reconciliation).
export type {
  BillingOwner,
  BillingWorkspaceSummary,
  BillingTargetUserSummary,
} from "./billing-owner";
export {
  ensureBillingCustomer,
  getExistingBillingOwnerForUser,
  resolveBillingOwnerForConversation,
  resolveBillingOwnerForUser,
} from "./billing-owner";
export type { BillingFeatureSnapshot } from "./credit-snapshot";
export { getBillingSnapshotForOwner } from "./credit-snapshot";
export {
  addWorkspaceMembers,
  adminJoinWorkspace,
  adminListAllWorkspaces,
  adminRemoveWorkspaceMember,
  cancelWorkspaceInvitation,
  createWorkspaceInvitations,
  createWorkspaceForUser,
  ensureWorkspaceForUser,
  getWorkspaceForUser,
  getWorkspaceInvitation,
  getWorkspaceMembershipForUser,
  listWorkspaceMembers,
  listWorkspacesForUser,
  renameWorkspace,
  requireActiveWorkspaceForUser,
  setActiveWorkspace,
} from "./workspace-lifecycle";

export async function getAdminBillingOverviewForUser(userId: string) {
  const target = await getExistingBillingOwnerForUser(userId);
  if (!target.owner || !target.activeWorkspace) {
    return {
      targetUser: target.targetUser,
      activeWorkspace: null,
      plan: null,
      feature: null,
      recentTopUps: [],
    };
  }

  const snapshot = await getBillingSnapshotForOwner(target.owner);
  return {
    targetUser: target.targetUser,
    activeWorkspace: target.activeWorkspace,
    plan: snapshot.plan,
    feature: snapshot.feature,
    recentTopUps: snapshot.recentTopUps,
  };
}

export async function attachPlanToOwner(args: {
  owner: BillingOwner;
  planId: BillingPlanId;
  successUrl?: string;
  customerData?: { name?: string | null; email?: string | null };
}) {
  const autumnClient = getAutumnClient();
  if (!autumnClient) {
    throw new Error("Autumn is not configured");
  }

  await ensureBillingCustomer(args.owner, args.customerData);
  const result = await autumnClient.attach({
    customer_id: args.owner.autumnCustomerId,
    product_id: args.planId,
    success_url: args.successUrl,
    customer_data: {
      name: args.customerData?.name ?? undefined,
      email: args.customerData?.email ?? undefined,
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data?.checkout_url) {
    await db
      .update(workspace)
      .set({ billingPlanId: args.planId, autumnCustomerId: args.owner.autumnCustomerId })
      .where(eq(workspace.id, args.owner.ownerId));
  }

  return result.data;
}

export async function openBillingPortalForOwner(owner: BillingOwner, returnUrl?: string) {
  const autumnClient = getAutumnClient();
  if (!autumnClient) {
    throw new Error("Autumn is not configured");
  }

  await ensureBillingCustomer(owner);
  const result = await autumnClient.customers.billingPortal(owner.autumnCustomerId, {
    return_url: returnUrl,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export async function cancelPlanForOwner(owner: BillingOwner, productId: BillingPlanId) {
  const autumnClient = getAutumnClient();
  if (!autumnClient) {
    throw new Error("Autumn is not configured");
  }

  const result = await autumnClient.cancel({
    customer_id: owner.autumnCustomerId,
    product_id: productId,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  await db.update(workspace).set({ billingPlanId: "free" }).where(eq(workspace.id, owner.ownerId));

  return result.data;
}

export async function createManualTopUp(args: {
  owner: BillingOwner;
  grantedByUserId: string;
  usdAmount: number;
}) {
  const autumnClient = getAutumnClient();
  const creditsGranted = Math.max(0, Math.floor(args.usdAmount * TOP_UP_CREDITS_PER_USD));
  const expiresAt = addMonths(new Date(), TOP_UP_EXPIRY_MONTHS);

  if (creditsGranted <= 0) {
    throw new Error("Top-up amount must be positive");
  }

  await ensureBillingCustomer(args.owner);

  if (autumnClient) {
    const result = await autumnClient.balances.create({
      customer_id: args.owner.autumnCustomerId,
      feature_id: BILLING_CREDIT_FEATURE_ID,
      granted_balance: creditsGranted,
      reset: { interval: "one_off" },
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    });
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const [topUp] = await db
    .insert(billingTopUp)
    .values({
      ownerType: "workspace",
      userId: null,
      workspaceId: args.owner.ownerId,
      grantedByUserId: args.grantedByUserId,
      usdAmount: args.usdAmount,
      creditsGranted,
      autumnCustomerId: args.owner.autumnCustomerId,
      expiresAt,
    })
    .returning();

  return topUp;
}

export async function getBillingOverviewForUser(userId: string, activeWorkspaceId?: string | null) {
  const owner = await resolveBillingOwnerForUser(userId, activeWorkspaceId);
  const recentCharges = await db.query.billingLedger.findMany({
    where:
      owner.ownerType === "workspace"
        ? eq(billingLedger.workspaceId, owner.ownerId)
        : eq(billingLedger.userId, owner.ownerId),
    orderBy: [desc(billingLedger.createdAt)],
    limit: 20,
  });
  const snapshot = await getBillingSnapshotForOwner(owner);

  return {
    owner,
    plan: snapshot.plan,
    feature: snapshot.feature,
    recentCharges,
    recentTopUps: snapshot.recentTopUps,
    workspaces: await listWorkspacesForUser(userId, owner.ownerId),
  };
}

export async function trackGenerationBilling(args: {
  generationId: string;
  conversationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  sandboxRuntimeMs: number;
}) {
  const existing = await db.query.billingLedger.findFirst({
    where: eq(billingLedger.generationId, args.generationId),
    columns: { id: true },
  });
  if (existing) {
    return existing;
  }

  const owner = await resolveBillingOwnerForConversation(args.conversationId);
  const calculation = calculateCredits({
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    sandboxRuntimeMs: args.sandboxRuntimeMs,
  });

  if (calculation.credits <= 0) {
    return null;
  }

  const autumnClient = getAutumnClient();
  let trackCode: string | null = null;
  if (autumnClient) {
    try {
      await ensureBillingCustomer(owner);
      const result = await autumnClient.track({
        customer_id: owner.autumnCustomerId,
        feature_id: BILLING_CREDIT_FEATURE_ID,
        value: calculation.credits,
      });
      trackCode = result.data?.code ?? null;
    } catch (error) {
      console.error("[Billing] Failed to track Autumn usage", error);
    }
  }

  const [ledger] = await db
    .insert(billingLedger)
    .values({
      generationId: args.generationId,
      conversationId: args.conversationId,
      ownerType: "workspace",
      userId: null,
      workspaceId: owner.ownerId,
      autumnCustomerId: owner.autumnCustomerId,
      planId: owner.planId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      sandboxRuntimeMs: args.sandboxRuntimeMs,
      creditsCharged: calculation.credits,
      autumnTrackCode: trackCode,
    })
    .returning();

  return ledger;
}
