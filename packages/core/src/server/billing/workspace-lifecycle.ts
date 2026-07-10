import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type BillingPlanId } from "../../lib/billing-plans";
import { db } from "@bap/db/client";
import {
  conversation,
  coworker,
  coworkerRun,
  invitation,
  skill,
  user,
  workspace,
  workspaceMember,
} from "@bap/db/schema";
import { isSelfHostedEdition } from "../edition";
import {
  buildWorkspaceImageDataUrl,
  buildWorkspaceImageUrl,
} from "./workspace-image";

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

export async function getWorkspaceForUser(userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.organizationId, workspaceId)),
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
        eq(workspaceMember.organizationId, existingWorkspace.id),
      ),
      columns: { id: true },
    });

    if (!membership) {
      await db.insert(workspaceMember).values({
        organizationId: existingWorkspace.id,
        userId,
        role: "member",
      });
    }

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
          slug: true,
          imageStorageKey: true,
          imageMimeType: true,
          billingPlanId: true,
          autumnCustomerId: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [desc(workspaceMember.createdAt)],
  });

  if (existingMembership?.workspace) {
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
  const activeWorkspace = await ensureWorkspaceForUser(userId);
  await backfillLegacyWorkspaceDataForUser(userId, activeWorkspace.id);
  return activeWorkspace;
}

export async function createWorkspaceForUser(userId: string, name: string) {
  const slug = await uniqueWorkspaceSlug(name);
  const isSelfHosted = isSelfHostedEdition();
  const [created] = await db
    .insert(workspace)
    .values({
      name,
      slug: isSelfHosted ? "selfhost-workspace" : slug,
      billingPlanId: "free",
      autumnCustomerId: null,
    })
    .returning();

  await db.insert(workspaceMember).values({
    organizationId: created.id,
    userId,
    role: "owner",
  });

  return created;
}

export async function listWorkspacesForUser(userId: string, activeWorkspaceId?: string | null) {
  if (isSelfHostedEdition()) {
    const ensured = await ensureWorkspaceForUser(userId);
    const [membership, ensuredImage] = await Promise.all([
      db.query.workspaceMember.findFirst({
        where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.organizationId, ensured.id)),
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

  const resolvedActiveWorkspaceId = activeWorkspaceId ?? null;

  return Promise.all(
    memberships.map(async (membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      imageUrl: await buildWorkspaceImageDataUrl(membership.workspace),
      role: membership.role,
      billingPlanId: membership.workspace.billingPlanId as BillingPlanId,
      active: membership.workspace.id === resolvedActiveWorkspaceId,
    })),
  );
}

export async function setActiveWorkspace(userId: string, workspaceId: string | null) {
  if (isSelfHostedEdition()) {
    const ensured = await ensureWorkspaceForUser(userId);
    if (workspaceId && workspaceId !== ensured.id) {
      throw new Error("Workspace not found");
    }

    return;
  }

  if (workspaceId) {
    const membership = await db.query.workspaceMember.findFirst({
      where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.organizationId, workspaceId)),
      columns: { id: true },
    });

    if (!membership) {
      throw new Error("Workspace not found");
    }
  }

}

export async function getWorkspaceMembershipForUser(userId: string, workspaceId: string) {
  return db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.organizationId, workspaceId)),
  });
}

export async function listWorkspaceMembers(workspaceId: string) {
  const [members, invitations] = await Promise.all([
    db.query.workspaceMember.findMany({
      where: eq(workspaceMember.organizationId, workspaceId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    db.query.invitation.findMany({
      where: and(eq(invitation.organizationId, workspaceId), eq(invitation.status, "pending")),
      columns: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
      },
      orderBy: [desc(invitation.createdAt)],
    }),
  ]);

  return {
    members: members.map((member) => ({
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
    })),
    invitations: invitations.map((item) => ({
      id: item.id,
      email: item.email,
      role: item.role ?? "member",
      status: item.status,
      expiresAt: item.expiresAt,
    })),
  };
}

export async function createWorkspaceInvitations(
  workspaceId: string,
  emails: string[],
  role: "admin" | "member" = "member",
  inviterId: string,
) {
  const normalizedEmails = Array.from(
    new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  );
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 48);

  await Promise.all(
    normalizedEmails.map(async (email) => {
      await db
        .update(invitation)
        .set({ status: "canceled" })
        .where(
          and(
            eq(invitation.organizationId, workspaceId),
            eq(invitation.email, email),
            eq(invitation.status, "pending"),
          ),
        );

      await db.insert(invitation).values({
        organizationId: workspaceId,
        email,
        role,
        status: "pending",
        expiresAt,
        inviterId,
      });
    }),
  );

  return normalizedEmails;
}

export async function getWorkspaceInvitation(workspaceId: string, invitationId: string) {
  return db.query.invitation.findFirst({
    where: and(eq(invitation.id, invitationId), eq(invitation.organizationId, workspaceId)),
    columns: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
    },
  });
}

export async function cancelWorkspaceInvitation(workspaceId: string, invitationId: string) {
  const [canceled] = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, workspaceId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
    });

  return canceled ?? null;
}

export async function addWorkspaceMembers(
  workspaceId: string,
  emails: string[],
  role: "admin" | "member" = "member",
) {
  const normalizedEmails = Array.from(
    new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0)),
  );

  const users = await db.query.user.findMany({
    where: inArray(user.email, normalizedEmails),
    columns: { id: true, email: true },
  });

  const requestedUserIds = users.map((dbUser) => dbUser.id);
  const existingMemberships =
    requestedUserIds.length > 0
      ? await db.query.workspaceMember.findMany({
          where: and(
            eq(workspaceMember.organizationId, workspaceId),
            inArray(workspaceMember.userId, requestedUserIds),
          ),
          columns: { userId: true },
        })
      : [];

  const existingUserIds = new Set(existingMemberships.map((membership) => membership.userId));
  const addedUsers = users.filter((dbUser) => !existingUserIds.has(dbUser.id));
  const alreadyMembers = users
    .filter((dbUser) => existingUserIds.has(dbUser.id))
    .map((dbUser) => dbUser.email);
  const foundEmails = new Set(users.map((dbUser) => dbUser.email));
  const notFound = normalizedEmails.filter((email) => !foundEmails.has(email));

  if (addedUsers.length > 0) {
    await Promise.all(
      addedUsers.map((dbUser) =>
        db
          .insert(workspaceMember)
          .values({
            organizationId: workspaceId,
            userId: dbUser.id,
            role,
          })
          .onConflictDoNothing(),
      ),
    );
  }

  return {
    added: addedUsers.map((item) => item.email),
    alreadyMembers,
    notFound,
  };
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
      organizationId: workspaceId,
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
      and(eq(workspaceMember.organizationId, workspaceId), eq(workspaceMember.userId, targetUser.id)),
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
