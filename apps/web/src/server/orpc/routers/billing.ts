import { BILLING_PLANS, type BillingPlanId } from "@bap/core/lib/billing-plans";
import {
  addWorkspaceMembers,
  adminJoinWorkspace,
  adminListAllWorkspaces,
  adminRemoveWorkspaceMember,
  attachPlanToOwner,
  cancelPlanForOwner,
  createManualTopUp,
  createWorkspaceForUser,
  getAdminBillingOverviewForUser,
  getExistingBillingOwnerForUser,
  ensureWorkspaceForUser,
  getBillingOverviewForUser,
  getWorkspaceMembershipForUser,
  listWorkspaceMembers,
  openBillingPortalForOwner,
  renameWorkspace,
  setActiveWorkspace,
} from "@bap/core/server/billing/service";
import {
  removeWorkspaceImage,
  updateWorkspaceImage,
} from "@bap/core/server/billing/workspace-image";
import { isSelfHostedEdition } from "@bap/core/server/edition";
import { user, workspace } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import {
  assertHostedMcpAllWorkspaceAccess,
  assertHostedMcpWorkspaceAccess,
} from "../hosted-mcp-workspace-access";

function assertBillingEnabled() {
  if (isSelfHostedEdition()) {
    throw new ORPCError("FORBIDDEN", {
      message: "Billing is not available in self-hosted edition",
    });
  }
}

function assertCloudWorkspaceManagementEnabled() {
  if (isSelfHostedEdition()) {
    throw new ORPCError("FORBIDDEN", {
      message: "This workspace action is not available in self-hosted edition",
    });
  }
}

async function getDbRole(userId: string, db: typeof import("@bap/db/client").db) {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { role: true },
  });
  return dbUser?.role ?? "user";
}

async function resolveRequestedOwner(params: {
  userId: string;
  db: typeof import("@bap/db/client").db;
  ownerType: "user" | "workspace";
  workspaceId?: string;
}) {
  if (params.ownerType === "user") {
    throw new ORPCError("BAD_REQUEST", { message: "Personal billing is no longer supported" });
  }

  if (!params.workspaceId) {
    const dbUser = await params.db.query.user.findFirst({
      where: eq(user.id, params.userId),
      columns: { activeWorkspaceId: true },
    });
    const ensuredWorkspace = await ensureWorkspaceForUser(params.userId, dbUser?.activeWorkspaceId);
    return {
      ownerType: "workspace" as const,
      ownerId: ensuredWorkspace.id,
      autumnCustomerId: ensuredWorkspace.autumnCustomerId ?? ensuredWorkspace.id,
      planId: ensuredWorkspace.billingPlanId as BillingPlanId,
    };
  }

  const membership = await getWorkspaceMembershipForUser(params.userId, params.workspaceId);
  if (!membership) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  const dbWorkspace = await params.db.query.workspace.findFirst({
    where: eq(workspace.id, params.workspaceId),
    columns: { id: true, autumnCustomerId: true, billingPlanId: true },
  });
  if (!dbWorkspace) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  return {
    ownerType: "workspace" as const,
    ownerId: dbWorkspace.id,
    autumnCustomerId: dbWorkspace.autumnCustomerId ?? dbWorkspace.id,
    planId: dbWorkspace.billingPlanId as BillingPlanId,
  };
}

const overview = protectedProcedure.handler(async ({ context }) => {
  const overview = await getBillingOverviewForUser(context.user.id);
  if (context.hostedMcp?.audience !== "bap" || context.hostedMcp.allowAllWorkspaces) {
    return overview;
  }

  const workspaces = overview.workspaces.filter((workspace) =>
    context.hostedMcp?.allowedWorkspaceIds.includes(workspace.id),
  );
  const activeWorkspaceId =
    workspaces.find((workspace) => workspace.id === context.workspaceId)?.id ??
    workspaces.find((workspace) => workspace.active)?.id ??
    workspaces[0]?.id ??
    overview.owner.ownerId;

  return {
    ...overview,
    owner: {
      ...overview.owner,
      ownerId: activeWorkspaceId,
    },
    workspaces: workspaces.map((workspace) =>
      Object.assign({}, workspace, {
        active: workspace.id === activeWorkspaceId,
      }),
    ),
  };
});

const adminUserOverview = protectedProcedure
  .input(
    z.object({
      targetUserId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required for manual top-ups" });
    }

    try {
      return await getAdminBillingOverviewForUser(input.targetUserId);
    } catch (error) {
      if (error instanceof Error && error.message === "User not found") {
        throw new ORPCError("NOT_FOUND", { message: "User not found" });
      }
      throw error;
    }
  });

const createWorkspace = protectedProcedure
  .input(
    z.object({
      name: z.string().trim().min(2).max(80),
    }),
  )
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    assertHostedMcpAllWorkspaceAccess(context);
    const created = await createWorkspaceForUser(context.user.id, input.name);
    return {
      id: created.id,
      name: created.name,
      billingPlanId: created.billingPlanId,
    };
  });

const switchWorkspace = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    await setActiveWorkspace(context.user.id, input.workspaceId);
    return { success: true };
  });

const attachPlan = protectedProcedure
  .input(
    z.object({
      ownerType: z.enum(["user", "workspace"]),
      workspaceId: z.string().optional(),
      planId: z.enum(["free", "pro", "business", "enterprise"]),
      successUrl: z.string().url().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const owner = await resolveRequestedOwner({
      userId: context.user.id,
      db: context.db,
      ownerType: "workspace",
      workspaceId: input.workspaceId,
    });
    const plan = BILLING_PLANS[input.planId];
    if (plan.ownerType !== owner.ownerType) {
      throw new ORPCError("BAD_REQUEST", { message: "Plan does not match billing owner type" });
    }

    const result = await attachPlanToOwner({
      owner,
      planId: input.planId,
      successUrl: input.successUrl,
      customerData: {
        name: context.user.name,
        email: context.user.email,
      },
    });

    return {
      checkoutUrl: result?.checkout_url ?? null,
      customerId: result?.customer_id ?? owner.autumnCustomerId,
      planId: input.planId,
    };
  });

const openPortal = protectedProcedure
  .input(
    z.object({
      ownerType: z.enum(["user", "workspace"]),
      workspaceId: z.string().optional(),
      returnUrl: z.string().url().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const owner = await resolveRequestedOwner({
      userId: context.user.id,
      db: context.db,
      ownerType: "workspace",
      workspaceId: input.workspaceId,
    });
    const result = await openBillingPortalForOwner(owner, input.returnUrl);
    return { url: result.url };
  });

const cancelPlan = protectedProcedure
  .input(
    z.object({
      ownerType: z.enum(["user", "workspace"]),
      workspaceId: z.string().optional(),
      productId: z.enum(["pro", "business", "enterprise"]),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const owner = await resolveRequestedOwner({
      userId: context.user.id,
      db: context.db,
      ownerType: "workspace",
      workspaceId: input.workspaceId,
    });
    const membership = await getWorkspaceMembershipForUser(context.user.id, owner.ownerId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new ORPCError("FORBIDDEN", { message: "Workspace admin required" });
    }
    await cancelPlanForOwner(owner, input.productId);
    return { success: true };
  });

const manualTopUp = protectedProcedure
  .input(
    z.object({
      ownerType: z.enum(["user", "workspace"]),
      workspaceId: z.string().optional(),
      usdAmount: z.number().positive(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required for manual top-ups" });
    }

    const owner = await resolveRequestedOwner({
      userId: context.user.id,
      db: context.db,
      ownerType: "workspace",
      workspaceId: input.workspaceId,
    });
    const result = await createManualTopUp({
      owner,
      grantedByUserId: context.user.id,
      usdAmount: input.usdAmount,
    });
    return {
      id: result.id,
      creditsGranted: result.creditsGranted,
      expiresAt: result.expiresAt,
    };
  });

const adminManualTopUp = protectedProcedure
  .input(
    z.object({
      targetUserId: z.string(),
      usdAmount: z.number().positive(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required for manual top-ups" });
    }

    let target;
    try {
      target = await getExistingBillingOwnerForUser(input.targetUserId);
    } catch (error) {
      if (error instanceof Error && error.message === "User not found") {
        throw new ORPCError("NOT_FOUND", { message: "User not found" });
      }
      throw error;
    }

    if (!target.owner) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Selected user does not have an active workspace",
      });
    }

    const result = await createManualTopUp({
      owner: target.owner,
      grantedByUserId: context.user.id,
      usdAmount: input.usdAmount,
    });
    return {
      id: result.id,
      creditsGranted: result.creditsGranted,
      expiresAt: result.expiresAt,
    };
  });

const inviteMembers = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      emails: z.array(z.string().email()).min(1).max(20),
      role: z.enum(["admin", "member"]).default("member"),
    }),
  )
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    const membership = await getWorkspaceMembershipForUser(context.user.id, input.workspaceId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new ORPCError("FORBIDDEN", { message: "Workspace admin required" });
    }
    return await addWorkspaceMembers(input.workspaceId, input.emails, input.role);
  });

const members = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    const membership = await getWorkspaceMembershipForUser(context.user.id, input.workspaceId);
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }

    return {
      members: await listWorkspaceMembers(input.workspaceId),
      membershipRole: membership.role,
    };
  });

const rename = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      name: z.string().trim().min(2).max(80),
    }),
  )
  .handler(async ({ input, context }) => {
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    const membership = await getWorkspaceMembershipForUser(context.user.id, input.workspaceId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new ORPCError("FORBIDDEN", { message: "Workspace admin required" });
    }

    return renameWorkspace(input.workspaceId, input.name);
  });

const updateImage = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      contentBase64: z.string().min(1),
      mimeType: z.enum(["image/gif", "image/jpeg", "image/png", "image/webp"]),
    }),
  )
  .handler(async ({ input, context }) => {
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    const membership = await getWorkspaceMembershipForUser(context.user.id, input.workspaceId);
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }

    return updateWorkspaceImage(input);
  });

const removeImage = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertHostedMcpWorkspaceAccess(context, input.workspaceId);
    const membership = await getWorkspaceMembershipForUser(context.user.id, input.workspaceId);
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }

    return removeWorkspaceImage(input.workspaceId);
  });

const adminWorkspaces = protectedProcedure.handler(async ({ context }) => {
  assertBillingEnabled();
  const role = await getDbRole(context.user.id, context.db);
  if (role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
  }
  return adminListAllWorkspaces();
});

const adminJoinWorkspaceEndpoint = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
    }
    return adminJoinWorkspace(context.user.id, input.workspaceId);
  });

const adminAddWorkspaceMembers = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      emails: z.array(z.string().email()).min(1).max(20),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
    }
    return await addWorkspaceMembers(input.workspaceId, input.emails, "member");
  });

const adminCreateWorkspace = protectedProcedure
  .input(
    z.object({
      name: z.string().trim().min(2).max(80),
      ownerEmail: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
    }
    const owner = await context.db.query.user.findFirst({
      where: eq(user.email, input.ownerEmail),
      columns: { id: true },
    });
    if (!owner) {
      throw new ORPCError("NOT_FOUND", { message: `No user found with email ${input.ownerEmail}` });
    }
    const created = await createWorkspaceForUser(owner.id, input.name);
    return { id: created.id, name: created.name };
  });

const adminRenameWorkspace = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      name: z.string().trim().min(2).max(80),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
    }
    return renameWorkspace(input.workspaceId, input.name);
  });

const adminRemoveWorkspaceMemberEndpoint = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    const role = await getDbRole(context.user.id, context.db);
    if (role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
    }
    return adminRemoveWorkspaceMember(input.workspaceId, input.email);
  });

export const billingRouter = {
  overview,
  adminUserOverview,
  adminWorkspaces,
  adminJoinWorkspace: adminJoinWorkspaceEndpoint,
  adminAddWorkspaceMembers,
  adminRemoveWorkspaceMember: adminRemoveWorkspaceMemberEndpoint,
  adminCreateWorkspace,
  adminRenameWorkspace,
  createWorkspace,
  switchWorkspace,
  attachPlan,
  openPortal,
  cancelPlan,
  manualTopUp,
  adminManualTopUp,
  inviteMembers,
  members,
  rename,
  updateImage,
  removeImage,
};
