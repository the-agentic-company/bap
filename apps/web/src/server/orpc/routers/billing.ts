import { BILLING_PLANS, type BillingPlanId } from "@bap/core/lib/billing-plans";
import {
  addWorkspaceMembers,
  adminDeleteWorkspace,
  adminJoinWorkspace,
  adminListAllWorkspaces,
  adminRemoveWorkspaceMember,
  attachPlanToOwner,
  cancelPlanForOwner,
  cancelWorkspaceInvitation,
  createManualTopUp,
  createWorkspaceInvitations,
  createWorkspaceForUser,
  getAdminBillingOverviewForUser,
  getExistingBillingOwnerForUser,
  ensureWorkspaceForUser,
  getBillingOverviewForUser,
  getWorkspaceInvitation,
  getWorkspaceMembershipForUser,
  listWorkspaceMembers,
  openBillingPortalForOwner,
  removeWorkspaceMember,
  renameWorkspace,
  setActiveWorkspace,
  updateWorkspaceMemberRole,
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
import { auth } from "@/lib/auth";
import type { ORPCContext } from "../context";
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

function getActiveOrganizationId(session: unknown) {
  return (session as { activeOrganizationId?: string | null } | null)?.activeOrganizationId ?? null;
}

async function getDbRole(userId: string, db: typeof import("@bap/db/client").db) {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { role: true },
  });
  return dbUser?.role ?? "user";
}

async function assertPlatformAdmin(userId: string, db: typeof import("@bap/db/client").db) {
  const role = await getDbRole(userId, db);
  if (role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
  }
}

async function requireWorkspaceMembership(params: { userId: string; workspaceId: string }) {
  const membership = await getWorkspaceMembershipForUser(params.userId, params.workspaceId);
  if (!membership) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }
  return membership;
}

async function requireWorkspaceAdminMembership(params: { userId: string; workspaceId: string }) {
  const membership = await requireWorkspaceMembership(params);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Workspace admin required" });
  }
  return membership;
}

async function requireHostedMcpWorkspaceMembership(params: {
  context: ORPCContext;
  workspaceId: string;
}) {
  assertHostedMcpWorkspaceAccess(params.context, params.workspaceId);
  return requireWorkspaceMembership({
    userId: params.context.user!.id,
    workspaceId: params.workspaceId,
  });
}

async function requireHostedMcpWorkspaceAdmin(params: {
  context: ORPCContext;
  workspaceId: string;
}) {
  assertHostedMcpWorkspaceAccess(params.context, params.workspaceId);
  return requireWorkspaceAdminMembership({
    userId: params.context.user!.id,
    workspaceId: params.workspaceId,
  });
}

function filterHostedMcpOverviewWorkspaces(
  overview: Awaited<ReturnType<typeof getBillingOverviewForUser>>,
  context: ORPCContext,
) {
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
}

async function resolveRequestedOwner(params: {
  userId: string;
  db: typeof import("@bap/db/client").db;
  ownerType: "user" | "workspace";
  workspaceId?: string;
  activeWorkspaceId?: string | null;
}) {
  if (params.ownerType === "user") {
    throw new ORPCError("BAD_REQUEST", { message: "Personal billing is no longer supported" });
  }

  if (!params.workspaceId) {
    const ensuredWorkspace = await ensureWorkspaceForUser(params.userId, params.activeWorkspaceId);
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
  const overview = await getBillingOverviewForUser(
    context.user.id,
    getActiveOrganizationId(context.session) ?? context.workspaceId,
  );
  if (context.hostedMcp?.audience !== "bap" || context.hostedMcp.allowAllWorkspaces) {
    return overview;
  }

  return filterHostedMcpOverviewWorkspaces(overview, context);
});

const adminUserOverview = protectedProcedure
  .input(
    z.object({
      targetUserId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    await assertPlatformAdmin(context.user.id, context.db);

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
    if (context.authSource === "session") {
      await auth.api.setActiveOrganization({
        headers: context.headers,
        body: { organizationId: input.workspaceId },
      });
    }
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
      activeWorkspaceId: getActiveOrganizationId(context.session) ?? context.workspaceId,
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
      activeWorkspaceId: getActiveOrganizationId(context.session) ?? context.workspaceId,
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
      activeWorkspaceId: getActiveOrganizationId(context.session) ?? context.workspaceId,
    });
    await requireWorkspaceAdminMembership({
      userId: context.user.id,
      workspaceId: owner.ownerId,
    });
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
    await assertPlatformAdmin(context.user.id, context.db);

    const owner = await resolveRequestedOwner({
      userId: context.user.id,
      db: context.db,
      ownerType: "workspace",
      workspaceId: input.workspaceId,
      activeWorkspaceId: getActiveOrganizationId(context.session) ?? context.workspaceId,
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
    await assertPlatformAdmin(context.user.id, context.db);

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
    await requireHostedMcpWorkspaceAdmin({
      context,
      workspaceId: input.workspaceId,
    });

    if (context.authSource === "session") {
      return Promise.all(
        input.emails.map(async (email) => {
          const invitation = await auth.api.createInvitation({
            headers: context.headers,
            body: {
              organizationId: input.workspaceId,
              email,
              role: input.role,
            },
          });
          return invitation.email;
        }),
      );
    }
    const invited = await createWorkspaceInvitations(
      input.workspaceId,
      input.emails,
      input.role,
      context.user.id,
    );
    return invited;
  });

const cancelInvitation = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      invitationId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    await requireHostedMcpWorkspaceAdmin({
      context,
      workspaceId: input.workspaceId,
    });

    const invitation = await getWorkspaceInvitation(input.workspaceId, input.invitationId);
    if (!invitation || invitation.status !== "pending") {
      throw new ORPCError("NOT_FOUND", { message: "Invitation not found" });
    }

    if (context.authSource === "session") {
      const canceled = await auth.api.cancelInvitation({
        headers: context.headers,
        body: { invitationId: input.invitationId },
      });
      return {
        id: canceled?.id ?? input.invitationId,
        status: canceled?.status ?? "canceled",
      };
    }

    const canceled = await cancelWorkspaceInvitation(input.workspaceId, input.invitationId);
    if (!canceled) {
      throw new ORPCError("NOT_FOUND", { message: "Invitation not found" });
    }
    return {
      id: canceled.id,
      status: canceled.status,
    };
  });

const members = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const membership = await requireHostedMcpWorkspaceMembership({
      context,
      workspaceId: input.workspaceId,
    });

    const result = await listWorkspaceMembers(input.workspaceId);
    return {
      ...result,
      membershipRole: membership.role,
    };
  });

const setMemberRole = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      email: z.string().email(),
      role: z.enum(["admin", "member"]),
    }),
  )
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    await requireHostedMcpWorkspaceAdmin({ context, workspaceId: input.workspaceId });
    return updateWorkspaceMemberRole(input.workspaceId, input.email, input.role);
  });

const removeMember = protectedProcedure
  .input(z.object({ workspaceId: z.string(), email: z.string().email() }))
  .handler(async ({ input, context }) => {
    assertCloudWorkspaceManagementEnabled();
    await requireHostedMcpWorkspaceAdmin({ context, workspaceId: input.workspaceId });
    return removeWorkspaceMember(input.workspaceId, input.email);
  });

const rename = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      name: z.string().trim().min(2).max(80),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireHostedMcpWorkspaceAdmin({
      context,
      workspaceId: input.workspaceId,
    });

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
    await requireHostedMcpWorkspaceMembership({
      context,
      workspaceId: input.workspaceId,
    });

    return updateWorkspaceImage(input);
  });

const removeImage = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireHostedMcpWorkspaceMembership({
      context,
      workspaceId: input.workspaceId,
    });

    return removeWorkspaceImage(input.workspaceId);
  });

const adminWorkspaces = protectedProcedure.handler(async ({ context }) => {
  assertBillingEnabled();
  await assertPlatformAdmin(context.user.id, context.db);
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
    await assertPlatformAdmin(context.user.id, context.db);
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
    await assertPlatformAdmin(context.user.id, context.db);
    const added = await addWorkspaceMembers(input.workspaceId, input.emails, "member");
    return added;
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
    await assertPlatformAdmin(context.user.id, context.db);
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
    await assertPlatformAdmin(context.user.id, context.db);
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
    await assertPlatformAdmin(context.user.id, context.db);
    return adminRemoveWorkspaceMember(input.workspaceId, input.email);
  });

const adminDeleteWorkspaceEndpoint = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    assertBillingEnabled();
    await assertPlatformAdmin(context.user.id, context.db);
    return adminDeleteWorkspace(input.workspaceId);
  });

export const billingRouter = {
  overview,
  adminUserOverview,
  adminWorkspaces,
  adminJoinWorkspace: adminJoinWorkspaceEndpoint,
  adminAddWorkspaceMembers,
  adminRemoveWorkspaceMember: adminRemoveWorkspaceMemberEndpoint,
  adminDeleteWorkspace: adminDeleteWorkspaceEndpoint,
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
  cancelInvitation,
  members,
  setMemberRole,
  removeMember,
  rename,
  updateImage,
  removeImage,
};
