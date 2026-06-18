import { addMonths } from "date-fns";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  BILLING_CREDIT_FEATURE_ID,
  BILLING_PLANS,
  TOP_UP_CREDITS_PER_USD,
  TOP_UP_EXPIRY_MONTHS,
  type BillingOwnerType,
  type BillingPlanId,
} from "../../lib/billing-plans";
import { db } from "@bap/db/client";
import {
  billingLedger,
  billingTopUp,
  conversation,
  coworker,
  coworkerRun,
  skill,
  user,
  workspace,
  workspaceMember,
} from "@bap/db/schema";
import { getAutumnClient } from "./autumn";
import { calculateCredits } from "./credit-calculator";
import { isSelfHostedEdition } from "../edition";
import {
  buildWorkspaceImageDataUrl,
  buildWorkspaceImageUrl,
} from "./workspace-image";

export type BillingOwner = {
  ownerType: BillingOwnerType;
  ownerId: string;
  autumnCustomerId: string;
  planId: BillingPlanId;
};

function slugifyWorkspaceName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const base = slugifyWorkspaceName(name) || "workspace";
  const candidate = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  const existing = await db.query.workspace.findFirst({
    where: eq(workspace.slug, candidate),
    columns: { id: true },
  });
  return existing ? `${candidate}-${Date.now().toString(36)}` : candidate;
}

type BillingFeatureSnapshot = {
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

export type BillingWorkspaceSummary = {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
};

export type BillingTargetUserSummary = {
  id: string;
  name: string | null;
  email: string | null;
};

export async function resolveBillingOwnerForUser(userId: string): Promise<BillingOwner> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      activeWorkspaceId: true,
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  const activeWorkspace = await ensureWorkspaceForUser(userId, dbUser.activeWorkspaceId);
  return {
    ownerType: "workspace",
    ownerId: activeWorkspace.id,
    autumnCustomerId: activeWorkspace.autumnCustomerId ?? activeWorkspace.id,
    planId: activeWorkspace.billingPlanId as BillingPlanId,
  };
}

async function getWorkspaceForUser(userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)),
    with: {
      workspace: {
        columns: {
          id: true,
          name: true,
          slug: true,
          imageStorageKey: true,
          imageMimeType: true,
          billingPlanId: true,
          autumnCustomerId: true,
          updatedAt: true,
        },
      },
    },
  });

  return membership?.workspace ?? null;
}

async function getBillingSnapshotForOwner(owner: BillingOwner) {
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

export async function getExistingBillingOwnerForUser(userId: string): Promise<{
  targetUser: BillingTargetUserSummary;
  activeWorkspace: BillingWorkspaceSummary | null;
  owner: BillingOwner | null;
}> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      activeWorkspaceId: true,
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  if (!dbUser.activeWorkspaceId) {
    return {
      targetUser: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
      },
      activeWorkspace: null,
      owner: null,
    };
  }

  const activeWorkspace = await getWorkspaceForUser(dbUser.id, dbUser.activeWorkspaceId);
  if (!activeWorkspace) {
    return {
      targetUser: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
      },
      activeWorkspace: null,
      owner: null,
    };
  }

  return {
    targetUser: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
    },
    activeWorkspace: {
      id: activeWorkspace.id,
      name: activeWorkspace.name,
      slug: activeWorkspace.slug,
      imageUrl: buildWorkspaceImageUrl(activeWorkspace),
    },
    owner: {
      ownerType: "workspace",
      ownerId: activeWorkspace.id,
      autumnCustomerId: activeWorkspace.autumnCustomerId ?? activeWorkspace.id,
      planId: activeWorkspace.billingPlanId as BillingPlanId,
    },
  };
}

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

export async function ensureWorkspaceForUser(userId: string, activeWorkspaceId?: string | null) {
  if (isSelfHostedEdition()) {
    if (activeWorkspaceId) {
      const activeWorkspace = await getWorkspaceForUser(userId, activeWorkspaceId);
      if (activeWorkspace) {
        return activeWorkspace;
      }
    }

    const existingWorkspace = await db.query.workspace.findFirst({
      columns: {
        id: true,
        name: true,
        slug: true,
        imageStorageKey: true,
        imageMimeType: true,
        billingPlanId: true,
        autumnCustomerId: true,
        createdByUserId: true,
        updatedAt: true,
      },
      orderBy: [desc(workspace.createdAt)],
    });

    if (!existingWorkspace) {
      return createWorkspaceForUser(userId, "Workspace");
    }

    const membership = await db.query.workspaceMember.findFirst({
      where: and(
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.workspaceId, existingWorkspace.id),
      ),
      columns: { id: true },
    });

    if (!membership) {
      await db.insert(workspaceMember).values({
        workspaceId: existingWorkspace.id,
        userId,
        role: "member",
      });
    }

    await db
      .update(user)
      .set({ activeWorkspaceId: existingWorkspace.id })
      .where(eq(user.id, userId));

    return existingWorkspace;
  }

  if (activeWorkspaceId) {
    const activeWorkspace = await getWorkspaceForUser(userId, activeWorkspaceId);
    if (activeWorkspace) {
      return activeWorkspace;
    }
  }

  const existingMembership = await db.query.workspaceMember.findFirst({
    where: eq(workspaceMember.userId, userId),
    with: {
      workspace: {
        columns: {
          id: true,
          name: true,
          billingPlanId: true,
          autumnCustomerId: true,
        },
      },
    },
    orderBy: [desc(workspaceMember.createdAt)],
  });

  if (existingMembership?.workspace) {
    await db
      .update(user)
      .set({ activeWorkspaceId: existingMembership.workspace.id })
      .where(eq(user.id, userId));
    return existingMembership.workspace;
  }

  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      name: true,
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  const workspaceName = `${dbUser.name}'s workspace`;
  return createWorkspaceForUser(userId, workspaceName);
}

async function backfillLegacyWorkspaceDataForUser(userId: string, workspaceId: string) {
  await db
    .update(conversation)
    .set({ workspaceId })
    .where(and(eq(conversation.userId, userId), sql`${conversation.workspaceId} is null`));

  await db
    .update(coworker)
    .set({ workspaceId })
    .where(and(eq(coworker.ownerId, userId), sql`${coworker.workspaceId} is null`));

  await db
    .update(skill)
    .set({ workspaceId, visibility: "private" })
    .where(and(eq(skill.userId, userId), sql`${skill.workspaceId} is null`));

  await db.execute(sql`
    update ${coworkerRun} as run
    set
      owner_id = coalesce(run.owner_id, wf.owner_id),
      workspace_id = coalesce(run.workspace_id, wf.workspace_id)
    from ${coworker} as wf
    where run.coworker_id = wf.id
      and wf.owner_id = ${userId}
      and (run.owner_id is null or run.workspace_id is null)
  `);
}

export async function requireActiveWorkspaceForUser(userId: string) {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { activeWorkspaceId: true },
  });
  const activeWorkspace = await ensureWorkspaceForUser(userId, dbUser?.activeWorkspaceId);
  await backfillLegacyWorkspaceDataForUser(userId, activeWorkspace.id);
  return activeWorkspace;
}

async function resolveBillingOwnerForConversation(conversationId: string): Promise<BillingOwner> {
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    columns: {
      id: true,
      userId: true,
      workspaceId: true,
    },
  });

  if (!conv || !conv.userId) {
    throw new Error("Conversation not found");
  }

  if (conv.workspaceId) {
    const org = await db.query.workspace.findFirst({
      where: eq(workspace.id, conv.workspaceId),
      columns: {
        id: true,
        billingPlanId: true,
        autumnCustomerId: true,
      },
    });

    if (org) {
      return {
        ownerType: "workspace",
        ownerId: org.id,
        autumnCustomerId: org.autumnCustomerId ?? org.id,
        planId: org.billingPlanId as BillingPlanId,
      };
    }
  }

  return resolveBillingOwnerForUser(conv.userId);
}

export async function createWorkspaceForUser(userId: string, name: string) {
  const slug = await uniqueWorkspaceSlug(name);
  const isSelfHosted = isSelfHostedEdition();
  const [created] = await db
    .insert(workspace)
    .values({
      name,
      slug: isSelfHosted ? "selfhost-workspace" : slug,
      createdByUserId: userId,
      billingPlanId: "free",
      autumnCustomerId: null,
    })
    .returning();

  await db.insert(workspaceMember).values({
    workspaceId: created.id,
    userId,
    role: "owner",
  });

  await db.update(user).set({ activeWorkspaceId: created.id }).where(eq(user.id, userId));

  return created;
}

export async function listWorkspacesForUser(userId: string) {
  if (isSelfHostedEdition()) {
    const ensured = await ensureWorkspaceForUser(userId);
    const [membership, ensuredImage] = await Promise.all([
      db.query.workspaceMember.findFirst({
        where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, ensured.id)),
        columns: { role: true },
      }),
      db.query.workspace.findFirst({
        where: eq(workspace.id, ensured.id),
        columns: { imageMimeType: true, imageStorageKey: true },
      }),
    ]);
    return [
      {
        id: ensured.id,
        name: ensured.name,
        slug: "selfhost-workspace",
        imageUrl: await buildWorkspaceImageDataUrl(ensuredImage ?? {}),
        role: membership?.role ?? "member",
        billingPlanId: ensured.billingPlanId as BillingPlanId,
        active: true,
      },
    ];
  }

  const memberships = await db.query.workspaceMember.findMany({
    where: eq(workspaceMember.userId, userId),
    with: {
      workspace: true,
    },
    orderBy: [desc(workspaceMember.createdAt)],
  });

  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { activeWorkspaceId: true },
  });

  return Promise.all(
    memberships.map(async (membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      imageUrl: await buildWorkspaceImageDataUrl(membership.workspace),
      role: membership.role,
      billingPlanId: membership.workspace.billingPlanId as BillingPlanId,
      active: membership.workspace.id === dbUser?.activeWorkspaceId,
    })),
  );
}

export async function setActiveWorkspace(userId: string, workspaceId: string | null) {
  if (isSelfHostedEdition()) {
    const ensured = await ensureWorkspaceForUser(userId);
    if (workspaceId && workspaceId !== ensured.id) {
      throw new Error("Workspace not found");
    }

    await db.update(user).set({ activeWorkspaceId: ensured.id }).where(eq(user.id, userId));
    return;
  }

  if (workspaceId) {
    const membership = await db.query.workspaceMember.findFirst({
      where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)),
      columns: { id: true },
    });

    if (!membership) {
      throw new Error("Workspace not found");
    }
  }

  await db.update(user).set({ activeWorkspaceId: workspaceId }).where(eq(user.id, userId));
}

async function ensureBillingCustomer(
  owner: BillingOwner,
  customerData?: {
    name?: string | null;
    email?: string | null;
  },
) {
  const autumnClient = getAutumnClient();
  if (!autumnClient) {
    return owner.autumnCustomerId;
  }

  try {
    await autumnClient.customers.get(owner.autumnCustomerId);
    return owner.autumnCustomerId;
  } catch {
    await autumnClient.customers.create({
      id: owner.autumnCustomerId,
      name: customerData?.name ?? undefined,
      email: customerData?.email ?? undefined,
    });
    return owner.autumnCustomerId;
  }
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

export async function getBillingOverviewForUser(userId: string) {
  const owner = await resolveBillingOwnerForUser(userId);
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
    workspaces: await listWorkspacesForUser(userId),
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

export async function getWorkspaceMembershipForUser(userId: string, workspaceId: string) {
  return db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)),
  });
}

export async function listWorkspaceMembers(workspaceId: string) {
  const members = await db.query.workspaceMember.findMany({
    where: eq(workspaceMember.workspaceId, workspaceId),
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return members.map((member) => ({
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }));
}

export async function addWorkspaceMembers(
  workspaceId: string,
  emails: string[],
  role: "admin" | "member" = "member",
) {
  const users = await db.query.user.findMany({
    where: inArray(user.email, emails),
    columns: { id: true, email: true },
  });

  await Promise.all(
    users.map((dbUser) =>
      db
        .insert(workspaceMember)
        .values({
          workspaceId,
          userId: dbUser.id,
          role,
        })
        .onConflictDoNothing(),
    ),
  );

  return users.map((item) => item.email);
}

export async function adminListAllWorkspaces() {
  const [workspaces, coworkerCounts] = await Promise.all([
    db.query.workspace.findMany({
      orderBy: [desc(workspace.createdAt)],
      columns: {
        id: true,
        name: true,
        slug: true,
        imageStorageKey: true,
        imageMimeType: true,
        billingPlanId: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        members: {
          columns: { role: true },
          with: {
            user: {
              columns: { email: true, name: true },
            },
          },
        },
      },
    }),
    db
      .select({
        workspaceId: coworker.workspaceId,
        count: sql<number>`count(*)::int`,
      })
      .from(coworker)
      .groupBy(coworker.workspaceId),
  ]);

  const countMap = new Map(
    coworkerCounts.filter((c) => c.workspaceId !== null).map((c) => [c.workspaceId!, c.count]),
  );

  return workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    imageUrl: buildWorkspaceImageUrl(ws),
    billingPlanId: ws.billingPlanId,
    createdAt: ws.createdAt,
    coworkerCount: countMap.get(ws.id) ?? 0,
    members: ws.members.map((m) => ({
      email: m.user.email,
      name: m.user.name,
      role: m.role,
    })),
  }));
}

export async function adminJoinWorkspace(userId: string, workspaceId: string) {
  const ws = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: { id: true, name: true },
  });

  if (!ws) {
    throw new Error("Workspace not found");
  }

  await db
    .insert(workspaceMember)
    .values({
      workspaceId,
      userId,
      role: "admin",
    })
    .onConflictDoNothing();

  await setActiveWorkspace(userId, workspaceId);

  return ws;
}

export async function adminRemoveWorkspaceMember(workspaceId: string, targetEmail: string) {
  const targetUser = await db.query.user.findFirst({
    where: eq(user.email, targetEmail),
    columns: { id: true, email: true },
  });

  if (!targetUser) {
    throw new Error("User not found");
  }

  await db
    .delete(workspaceMember)
    .where(
      and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetUser.id)),
    );

  return { email: targetUser.email };
}

export async function renameWorkspace(workspaceId: string, name: string) {
  const trimmedName = name.trim();

  const [updated] = await db
    .update(workspace)
    .set({
      name: trimmedName,
    })
    .where(eq(workspace.id, workspaceId))
    .returning({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    });

  if (!updated) {
    throw new Error("Workspace not found");
  }

  return updated;
}
