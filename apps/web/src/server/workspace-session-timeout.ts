import type { Session } from "better-auth";
import { db } from "@bap/db/client";
import { session as sessionTable, workspaceMember } from "@bap/db/schema";
import { and, desc, eq, lte } from "drizzle-orm";

type WorkspaceSession = Session & {
  activeOrganizationId?: string | null;
  lastActivityAt?: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSessionIdleExpired(
  session: Pick<WorkspaceSession, "createdAt" | "lastActivityAt">,
  timeoutMinutes: number,
  now = new Date(),
): boolean {
  const lastActivityAt = asDate(session.lastActivityAt) ?? asDate(session.createdAt);
  return Boolean(
    lastActivityAt && lastActivityAt.getTime() <= now.getTime() - timeoutMinutes * 60_000,
  );
}

/**
 * Applies the active Workspace's policy only to real Better Auth browser sessions.
 * Returns false after atomically revoking an idle session.
 */
export async function enforceWorkspaceSessionIdleTimeout(
  session: WorkspaceSession,
  now = new Date(),
): Promise<boolean> {
  let membership = await db.query.workspaceMember.findFirst({
    where: session.activeOrganizationId
      ? and(
          eq(workspaceMember.userId, session.userId),
          eq(workspaceMember.organizationId, session.activeOrganizationId),
        )
      : eq(workspaceMember.userId, session.userId),
    columns: { id: true },
    with: {
      workspace: { columns: { sessionIdleTimeoutMinutes: true } },
    },
    orderBy: session.activeOrganizationId ? undefined : [desc(workspaceMember.createdAt)],
  });
  if (!membership && session.activeOrganizationId) {
    membership = await db.query.workspaceMember.findFirst({
      where: eq(workspaceMember.userId, session.userId),
      columns: { id: true },
      with: {
        workspace: { columns: { sessionIdleTimeoutMinutes: true } },
      },
      orderBy: [desc(workspaceMember.createdAt)],
    });
  }
  const timeoutMinutes = membership?.workspace.sessionIdleTimeoutMinutes;
  if (!timeoutMinutes || !isSessionIdleExpired(session, timeoutMinutes, now)) {
    return true;
  }

  const cutoff = new Date(now.getTime() - timeoutMinutes * 60_000);
  const revoked = await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.id, session.id), lte(sessionTable.lastActivityAt, cutoff)))
    .returning({ id: sessionTable.id });

  if (revoked.length > 0) {
    return false;
  }

  // Distinguish a concurrent activity update from another request revoking the same session.
  const currentSession = await db.query.session.findFirst({
    where: eq(sessionTable.id, session.id),
    columns: { lastActivityAt: true },
  });
  return Boolean(currentSession && currentSession.lastActivityAt > cutoff);
}
