import type { BapApiClient } from "@bap/client";

export async function handleWorkspaceMemberList(params: {
  client: BapApiClient;
  workspaceId: string;
}) {
  const result = await params.client.billing.members({ workspaceId: params.workspaceId });
  return { status: "completed" as const, workspaceId: params.workspaceId, ...result };
}

export async function handleWorkspaceMemberSave(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
  role: "admin" | "member";
}) {
  const current = await params.client.billing.members({ workspaceId: params.workspaceId });
  const member = current.members.find(
    (candidate) => candidate.email?.toLowerCase() === params.email.toLowerCase(),
  );
  if (member) {
    const updated = await params.client.billing.setMemberRole({
      workspaceId: params.workspaceId,
      email: params.email,
      role: params.role,
    });
    return {
      status: "completed" as const,
      workspaceId: params.workspaceId,
      access: { type: "membership" as const, ...updated },
    };
  }

  const invited = await params.client.billing.inviteMembers({
    workspaceId: params.workspaceId,
    emails: [params.email],
    role: params.role,
  });
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    access: {
      type: "invitation" as const,
      email: (Array.isArray(invited) ? invited[0] : invited.added[0]) ?? params.email,
      role: params.role,
    },
  };
}

export async function handleWorkspaceMemberRemove(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
}) {
  const removed = await params.client.billing.removeMember({
    workspaceId: params.workspaceId,
    email: params.email,
  });
  return { status: "completed" as const, workspaceId: params.workspaceId, ...removed };
}
