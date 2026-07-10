import { ensureWorkspaceForUser } from "@bap/core/server/billing/service";

export async function resolveSessionPrincipalWorkspaceId(
  userId: string,
  activeOrganizationId?: string | null,
): Promise<string> {
  const activeWorkspace = await ensureWorkspaceForUser(userId, activeOrganizationId);

  return activeWorkspace.id;
}
