import { eq } from "drizzle-orm";
import { type BillingOwnerType, type BillingPlanId } from "../../lib/billing-plans";
import { db } from "@bap/db/client";
import { conversation, user, workspaceMember, workspace } from "@bap/db/schema";
import { getAutumnClient } from "./autumn";
import { buildWorkspaceImageUrl } from "./workspace-image";
import { ensureWorkspaceForUser } from "./workspace-lifecycle";

export type BillingOwner = {
  ownerType: BillingOwnerType;
  ownerId: string;
  autumnCustomerId: string;
  planId: BillingPlanId;
};

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

export async function ensureBillingCustomer(
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

export async function resolveBillingOwnerForUser(
  userId: string,
  activeWorkspaceId?: string | null,
): Promise<BillingOwner> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  const activeWorkspace = await ensureWorkspaceForUser(userId, activeWorkspaceId);
  return {
    ownerType: "workspace",
    ownerId: activeWorkspace.id,
    autumnCustomerId: activeWorkspace.autumnCustomerId ?? activeWorkspace.id,
    planId: activeWorkspace.billingPlanId as BillingPlanId,
  };
}

export async function resolveBillingOwnerForConversation(
  conversationId: string,
): Promise<BillingOwner> {
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
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  const membership = await db.query.workspaceMember.findFirst({
    where: eq(workspaceMember.userId, dbUser.id),
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
        },
      },
    },
  });

  if (!membership?.workspace) {
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

  const activeWorkspace = membership.workspace;

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
